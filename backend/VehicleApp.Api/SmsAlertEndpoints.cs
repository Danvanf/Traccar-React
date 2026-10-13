using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;

public static class SmsAlertEndpoints
{
    private static readonly string[] SupportedEvents = ["maximum_speed", "hard_braking", "hard_acceleration", "long_idle"];

    public static void MapSmsAlertEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/user/sms-alerts").RequireAuthorization();

        group.MapGet("/preferences", async (NpgsqlDataSource dataSource, SmsDeliveryService sms, HttpContext context, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                select coalesce(p.phone, ''), p.verified_at, coalesce(p.enabled, false),
                       coalesce(p.event_types, '{}'::text[]), coalesce(p.vehicle_ids, '{}'::uuid[]),
                       coalesce(p.daily_limit, 5), p.stopped_at
                from app_users u left join sms_alert_preferences p on p.user_id = u.id
                where u.username = @username and u.active
                """, connection);
            command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken)) return Results.NotFound();
            return Results.Ok(new
            {
                phone = reader.GetString(0),
                verified = !reader.IsDBNull(1),
                enabled = reader.GetBoolean(2),
                eventTypes = reader.GetFieldValue<string[]>(3),
                vehicleIds = reader.GetFieldValue<Guid[]>(4),
                dailyLimit = reader.GetInt32(5),
                stopped = !reader.IsDBNull(6),
                supportedEvents = SupportedEvents,
                automaticAlertsReady = (await sms.GetStatusAsync(cancellationToken)).AutomaticAlertsReady,
            });
        });

        group.MapPut("/preferences", async (SmsAlertPreferenceRequest request, NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            var phone = request.Phone?.Trim() ?? string.Empty;
            if (!Regex.IsMatch(phone, @"^\+[1-9][0-9]{7,14}$"))
                return Results.BadRequest(new { error = "Enter a phone number in E.164 format, such as +15551234567." });
            if (request.DailyLimit is < 1 or > 25)
                return Results.BadRequest(new { error = "Daily limit must be between 1 and 25." });
            var eventTypes = (request.EventTypes ?? []).Distinct(StringComparer.Ordinal).ToArray();
            if (eventTypes.Except(SupportedEvents, StringComparer.Ordinal).Any())
                return Results.BadRequest(new { error = "Unsupported event type." });
            var vehicleIds = (request.VehicleIds ?? []).Distinct().ToArray();
            if (vehicleIds.Length > 50) return Results.BadRequest(new { error = "Too many vehicle selections." });

            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using (var access = new NpgsqlCommand("""
                select count(*) from vehicles v
                where v.id = any(@vehicleIds) and (
                    @isAdmin
                    or exists (select 1 from app_user_vehicle_access a join app_users u on u.id = a.user_id
                               where a.vehicle_id = v.id and u.username = @username and u.active)
                    or exists (select 1 from app_group_vehicle_access a
                               join app_group_memberships m on m.group_id = a.group_id
                               join app_users u on u.id = m.user_id
                               where a.vehicle_id = v.id and u.username = @username and u.active)
                )
                """, connection, transaction))
            {
                access.Parameters.AddWithValue("vehicleIds", vehicleIds);
                access.Parameters.AddWithValue("isAdmin", context.User.IsInRole("admin"));
                access.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
                if (Convert.ToInt64(await access.ExecuteScalarAsync(cancellationToken)) != vehicleIds.Length)
                    return Results.BadRequest(new { error = "One or more selected vehicles are unavailable." });
            }

            await using (var stopped = new NpgsqlCommand("""
                select stopped_at is not null from sms_alert_preferences p
                join app_users u on u.id = p.user_id
                where u.username = @username and p.phone = @phone and u.active
                """, connection, transaction))
            {
                stopped.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
                stopped.Parameters.AddWithValue("phone", phone);
                if (request.Enabled && (bool?)await stopped.ExecuteScalarAsync(cancellationToken) == true)
                    return Results.Conflict(new { error = "This number texted STOP. Text START to the Vehicle App number before enabling alerts again." });
            }

            await using var command = new NpgsqlCommand("""
                insert into sms_alert_preferences
                    (user_id, phone, enabled, event_types, vehicle_ids, daily_limit)
                select id, @phone, @enabled, @eventTypes, @vehicleIds, @dailyLimit
                from app_users where username = @username and active
                on conflict (user_id) do update set
                    verified_at = case when sms_alert_preferences.phone = excluded.phone
                                       then sms_alert_preferences.verified_at else null end,
                    stopped_at = case when sms_alert_preferences.phone = excluded.phone
                                      then sms_alert_preferences.stopped_at else null end,
                    phone = excluded.phone,
                    enabled = excluded.enabled,
                    event_types = excluded.event_types,
                    vehicle_ids = excluded.vehicle_ids,
                    daily_limit = excluded.daily_limit,
                    updated_at = now()
                returning verified_at is not null
                """, connection, transaction);
            command.Parameters.AddWithValue("phone", phone);
            command.Parameters.AddWithValue("enabled", request.Enabled);
            command.Parameters.AddWithValue("eventTypes", eventTypes);
            command.Parameters.AddWithValue("vehicleIds", vehicleIds);
            command.Parameters.AddWithValue("dailyLimit", request.DailyLimit);
            command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
            var verified = await command.ExecuteScalarAsync(cancellationToken);
            if (verified is null) return Results.NotFound();
            await using (var cancel = new NpgsqlCommand("""
                update sms_alert_outbox o set status = 'cancelled', last_error = 'SMS alert settings changed before delivery.'
                from app_users u join sms_alert_preferences p on p.user_id = u.id
                where o.user_id = u.id and u.username = @username and u.active and o.status = 'queued'
                  and (not p.enabled or p.verified_at is null or p.stopped_at is not null
                       or o.recipient_phone <> p.phone or not (o.event_type = any(p.event_types))
                       or (cardinality(p.vehicle_ids) > 0 and not (o.vehicle_id = any(p.vehicle_ids))))
                """, connection, transaction))
            {
                cancel.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
                await cancel.ExecuteNonQueryAsync(cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new { saved = true, verified = (bool)verified });
        });

        group.MapPost("/request-verification", async (SmsDeliveryService sms, NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            var status = await sms.GetStatusAsync(cancellationToken);
            if (!status.AutomaticAlertsReady)
                return Results.Problem("Automatic SMS verification requires a configured Twilio provider and authenticated HTTPS webhooks.", statusCode: StatusCodes.Status503ServiceUnavailable);
            var userName = context.User.Identity?.Name ?? string.Empty;
            var code = RandomNumberGenerator.GetInt32(0, 100_000_000).ToString("D8");
            var salt = RandomNumberGenerator.GetBytes(16);
            var hash = Rfc2898DeriveBytes.Pbkdf2(code, salt, 100_000, HashAlgorithmName.SHA256, 32);
            string? phone;

            await using (var connection = await dataSource.OpenConnectionAsync(cancellationToken))
            await using (var transaction = await connection.BeginTransactionAsync(cancellationToken))
            {
                await using (var userLock = new NpgsqlCommand("select id from app_users where username = @username and active for update", connection, transaction))
                {
                    userLock.Parameters.AddWithValue("username", userName);
                    var userId = await userLock.ExecuteScalarAsync(cancellationToken);
                    if (userId is null) return Results.NotFound();
                }
                await using (var preference = new NpgsqlCommand("""
                    select p.phone from sms_alert_preferences p join app_users u on u.id = p.user_id
                    where u.username = @username and u.active and p.enabled and p.verified_at is null and p.stopped_at is null
                    """, connection, transaction))
                {
                    preference.Parameters.AddWithValue("username", userName);
                    phone = await preference.ExecuteScalarAsync(cancellationToken) as string;
                }
                if (phone is null) return Results.Conflict(new { error = "Save a phone number and enable SMS alerts before requesting verification." });

                await using (var limit = new NpgsqlCommand("""
                    select requested_at, requests_today, request_day from sms_alert_verification
                    where user_id = (select id from app_users where username = @username) for update
                    """, connection, transaction))
                {
                    limit.Parameters.AddWithValue("username", userName);
                    await using var reader = await limit.ExecuteReaderAsync(cancellationToken);
                    if (await reader.ReadAsync(cancellationToken))
                    {
                        var requestedAt = reader.GetFieldValue<DateTimeOffset>(0);
                        var count = reader.GetInt32(1);
                        var requestDay = reader.GetDateTime(2).Date;
                        if (requestedAt > DateTimeOffset.UtcNow.AddMinutes(-1))
                            return Results.Problem("Wait one minute before requesting another code.", statusCode: StatusCodes.Status429TooManyRequests);
                        if (requestDay == DateTime.UtcNow.Date && count >= 5)
                            return Results.Problem("The daily verification-code limit was reached.", statusCode: StatusCodes.Status429TooManyRequests);
                    }
                }

                await using var saveCode = new NpgsqlCommand("""
                    insert into sms_alert_verification (user_id, phone, code_salt, code_hash, expires_at, attempts, requested_at, request_day, requests_today)
                    select id, @phone, @salt, @hash, now() + interval '10 minutes', 0, now(), (now() at time zone 'utc')::date, 1
                    from app_users where username = @username
                    on conflict (user_id) do update set
                        phone = excluded.phone, code_salt = excluded.code_salt, code_hash = excluded.code_hash,
                        expires_at = excluded.expires_at, attempts = 0, requested_at = now(),
                        requests_today = case when sms_alert_verification.request_day = (now() at time zone 'utc')::date
                                              then sms_alert_verification.requests_today + 1 else 1 end,
                        request_day = (now() at time zone 'utc')::date
                    """, connection, transaction);
                saveCode.Parameters.AddWithValue("username", userName);
                saveCode.Parameters.AddWithValue("phone", phone);
                saveCode.Parameters.AddWithValue("salt", Convert.ToBase64String(salt));
                saveCode.Parameters.AddWithValue("hash", Convert.ToBase64String(hash));
                await saveCode.ExecuteNonQueryAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }

            var result = await sms.SendAsync(phone, $"Vehicle App verification code: {code}. Msg & data rates may apply. Reply STOP to opt out.", cancellationToken);
            return result.Accepted
                ? Results.Ok(new { sent = true })
                : Results.Problem(result.Error, statusCode: StatusCodes.Status502BadGateway);
        }).RequireRateLimiting("smsVerification");

        group.MapPost("/verify", async (SmsAlertVerificationRequest request, NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (!Regex.IsMatch(request.Code?.Trim() ?? string.Empty, @"^\d{8}$"))
                return Results.BadRequest(new { error = "Enter the eight-digit verification code." });
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            Guid userId;
            await using (var user = new NpgsqlCommand("select id from app_users where username = @username and active for update", connection, transaction))
            {
                user.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
                var value = await user.ExecuteScalarAsync(cancellationToken);
                if (value is not Guid id) return Results.NotFound();
                userId = id;
            }
            string phone, saltText, hashText;
            int attempts;
            DateTimeOffset expiresAt;
            await using (var read = new NpgsqlCommand("select phone, code_salt, code_hash, expires_at, attempts from sms_alert_verification where user_id = @userId for update", connection, transaction))
            {
                read.Parameters.AddWithValue("userId", userId);
                await using var reader = await read.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken)) return Results.BadRequest(new { error = "Request a verification code first." });
                phone = reader.GetString(0);
                saltText = reader.GetString(1);
                hashText = reader.GetString(2);
                expiresAt = reader.GetFieldValue<DateTimeOffset>(3);
                attempts = reader.GetInt32(4);
            }
            if (attempts >= 5 || expiresAt <= DateTimeOffset.UtcNow)
                return Results.BadRequest(new { error = "The verification code expired or was entered too many times." });
            var candidate = Rfc2898DeriveBytes.Pbkdf2(request.Code!.Trim(), Convert.FromBase64String(saltText), 100_000, HashAlgorithmName.SHA256, 32);
            var matches = CryptographicOperations.FixedTimeEquals(candidate, Convert.FromBase64String(hashText));
            if (!matches)
            {
                await using var attempt = new NpgsqlCommand("update sms_alert_verification set attempts = attempts + 1 where user_id = @userId", connection, transaction);
                attempt.Parameters.AddWithValue("userId", userId);
                await attempt.ExecuteNonQueryAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return Results.BadRequest(new { error = "Verification code did not match." });
            }
            await using (var verify = new NpgsqlCommand("update sms_alert_preferences set verified_at = now(), updated_at = now() where user_id = @userId and phone = @phone and enabled and stopped_at is null", connection, transaction))
            {
                verify.Parameters.AddWithValue("userId", userId);
                verify.Parameters.AddWithValue("phone", phone);
                if (await verify.ExecuteNonQueryAsync(cancellationToken) != 1)
                    return Results.Conflict(new { error = "Phone settings changed or SMS alerts were turned off. Save settings and verify again." });
            }
            await using (var clear = new NpgsqlCommand("delete from sms_alert_verification where user_id = @userId", connection, transaction))
            {
                clear.Parameters.AddWithValue("userId", userId);
                await clear.ExecuteNonQueryAsync(cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new { verified = true });
        });

        group.MapGet("/history", async (NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                select o.id, o.status, o.delivery_status, o.created_at, o.accepted_at,
                       o.last_error, o.provider_error_code, o.event_type, coalesce(v.display_name, 'Vehicle')
                from sms_alert_outbox o
                join app_users u on u.id = o.user_id
                left join vehicles v on v.id = o.vehicle_id
                where u.username = @username and u.active
                order by o.created_at desc limit 30
                """, connection);
            command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var rows = new List<object>();
            while (await reader.ReadAsync(cancellationToken))
                rows.Add(new
                {
                    id = reader.GetGuid(0), status = reader.GetString(1), deliveryStatus = reader.GetString(2),
                    createdAt = reader.GetFieldValue<DateTimeOffset>(3),
                    acceptedAt = reader.IsDBNull(4) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(4),
                    reason = reader.IsDBNull(5) ? null : reader.GetString(5),
                    providerErrorCode = reader.IsDBNull(6) ? (int?)null : reader.GetInt32(6),
                    eventType = reader.GetString(7), vehicleName = reader.GetString(8),
                });
            return Results.Ok(rows);
        });
    }
}

public sealed record SmsAlertPreferenceRequest(string? Phone, bool Enabled, IReadOnlyList<string>? EventTypes, IReadOnlyList<Guid>? VehicleIds, int DailyLimit);
public sealed record SmsAlertVerificationRequest(string? Code);

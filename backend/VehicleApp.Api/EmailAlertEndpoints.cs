using System.Net.Mail;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;

public static class EmailAlertEndpoints
{
    private static readonly string[] SupportedEvents = ["maximum_speed", "hard_braking", "hard_acceleration", "long_idle"];

    public static void MapEmailAlertEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/user/email-alerts").RequireAuthorization();

        group.MapGet("/preferences", async (NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                select coalesce(p.email, u.email, ''), p.verified_at,
                       coalesce(p.enabled, false), coalesce(p.event_types, '{}'::text[]),
                       coalesce(p.vehicle_ids, '{}'::uuid[]), coalesce(p.daily_limit, 10),
                       p.quiet_start_minute, p.quiet_end_minute,
                       coalesce(p.quiet_delivery_mode, 'suppress'), p.time_zone_id
                from app_users u left join email_alert_preferences p on p.user_id = u.id
                where u.username = @username and u.active
                """, connection);
            command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken)) return Results.NotFound();
            return Results.Ok(new
            {
                email = reader.GetString(0),
                verified = !reader.IsDBNull(1),
                enabled = reader.GetBoolean(2),
                eventTypes = reader.GetFieldValue<string[]>(3),
                vehicleIds = reader.GetFieldValue<Guid[]>(4),
                dailyLimit = reader.GetInt32(5),
                quietStartMinute = reader.IsDBNull(6) ? (int?)null : reader.GetInt32(6),
                quietEndMinute = reader.IsDBNull(7) ? (int?)null : reader.GetInt32(7),
                quietDeliveryMode = reader.GetString(8),
                timeZoneId = reader.IsDBNull(9) ? null : reader.GetString(9),
                supportedEvents = SupportedEvents,
            });
        });

        group.MapPut("/preferences", async (EmailAlertPreferenceRequest request, NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            var email = request.Email?.Trim() ?? string.Empty;
            if (email.Length > 320 || !MailAddress.TryCreate(email, out var parsed) || parsed.Address != email)
                return Results.BadRequest(new { error = "A valid alert email address is required." });
            if (request.DailyLimit is < 1 or > 50)
                return Results.BadRequest(new { error = "Daily limit must be between 1 and 50." });
            if (request.QuietStartMinute.HasValue != request.QuietEndMinute.HasValue
                || request.QuietStartMinute is < 0 or > 1439
                || request.QuietEndMinute is < 0 or > 1439
                || (request.QuietStartMinute.HasValue && request.QuietStartMinute == request.QuietEndMinute))
                return Results.BadRequest(new { error = "Quiet hours need distinct start and end times." });
            var timeZoneId = string.IsNullOrWhiteSpace(request.TimeZoneId) ? "UTC" : request.TimeZoneId.Trim();
            if (timeZoneId.Length > 100)
                return Results.BadRequest(new { error = "Time zone is too long." });
            try { TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
            catch (TimeZoneNotFoundException) { return Results.BadRequest(new { error = "Unknown time zone." }); }
            catch (InvalidTimeZoneException) { return Results.BadRequest(new { error = "Invalid time zone." }); }
            var eventTypes = (request.EventTypes ?? []).Distinct(StringComparer.Ordinal).ToArray();
            if (eventTypes.Except(SupportedEvents, StringComparer.Ordinal).Any())
                return Results.BadRequest(new { error = "Unsupported event type." });
            var vehicleIds = (request.VehicleIds ?? []).Distinct().ToArray();
            var quietDeliveryMode = string.IsNullOrWhiteSpace(request.QuietDeliveryMode) ? "suppress" : request.QuietDeliveryMode.Trim().ToLowerInvariant();
            if (quietDeliveryMode is not ("suppress" or "digest"))
                return Results.BadRequest(new { error = "Quiet-hours delivery must be suppress or digest." });
            if (vehicleIds.Length > 50)
                return Results.BadRequest(new { error = "Too many vehicle selections." });

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

            await using var command = new NpgsqlCommand("""
                insert into email_alert_preferences
                    (user_id, email, enabled, event_types, vehicle_ids, daily_limit,
                     quiet_start_minute, quiet_end_minute, quiet_delivery_mode, time_zone_id)
                select id, @email, @enabled, @eventTypes, @vehicleIds, @dailyLimit,
                       @quietStart, @quietEnd, @quietDeliveryMode, @timeZoneId
                from app_users where username = @username and active
                on conflict (user_id) do update set
                    email = excluded.email,
                    verified_at = case when email_alert_preferences.email = excluded.email
                                       then email_alert_preferences.verified_at else null end,
                    enabled = excluded.enabled,
                    event_types = excluded.event_types,
                    vehicle_ids = excluded.vehicle_ids,
                    daily_limit = excluded.daily_limit,
                    quiet_start_minute = excluded.quiet_start_minute,
                    quiet_end_minute = excluded.quiet_end_minute,
                    quiet_delivery_mode = excluded.quiet_delivery_mode,
                    time_zone_id = excluded.time_zone_id,
                    updated_at = now()
                returning verified_at is not null
                """, connection, transaction);
            command.Parameters.AddWithValue("email", email);
            command.Parameters.AddWithValue("enabled", request.Enabled);
            command.Parameters.AddWithValue("eventTypes", eventTypes);
            command.Parameters.AddWithValue("vehicleIds", vehicleIds);
            command.Parameters.AddWithValue("dailyLimit", request.DailyLimit);
            command.Parameters.Add("quietStart", NpgsqlDbType.Integer).Value = (object?)request.QuietStartMinute ?? DBNull.Value;
            command.Parameters.Add("quietEnd", NpgsqlDbType.Integer).Value = (object?)request.QuietEndMinute ?? DBNull.Value;
            command.Parameters.AddWithValue("quietDeliveryMode", quietDeliveryMode);
            command.Parameters.AddWithValue("timeZoneId", timeZoneId);
            command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
            var verifiedValue = await command.ExecuteScalarAsync(cancellationToken);
            if (verifiedValue is null) return Results.NotFound();

            await using var cancel = new NpgsqlCommand("""
                update email_alert_outbox o set status = 'cancelled'
                from app_users u join email_alert_preferences p on p.user_id = u.id
                where o.user_id = u.id and u.username = @username
                  and o.status in ('queued', 'sending')
                  and (not p.enabled or p.verified_at is null or o.recipient_email <> p.email)
                """, connection, transaction);
            cancel.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
            await cancel.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new { saved = true, verified = (bool)verifiedValue });
        });

        group.MapPost("/request-verification", async (NpgsqlDataSource dataSource, EmailDeliveryService sender, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (!(await sender.GetStatusAsync(cancellationToken)).Ready)
                return Results.Problem("Email provider is disabled or incomplete.", statusCode: StatusCodes.Status503ServiceUnavailable);

            var code = RandomNumberGenerator.GetInt32(0, 100_000_000).ToString("D8");
            var salt = RandomNumberGenerator.GetBytes(16);
            var hash = Rfc2898DeriveBytes.Pbkdf2(code, salt, 100_000, HashAlgorithmName.SHA256, 32);
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                insert into email_alert_verification (user_id, email, code_salt, code_hash, expires_at, attempts)
                select p.user_id, p.email, @salt, @hash, now() + interval '15 minutes', 0
                from email_alert_preferences p join app_users u on u.id = p.user_id
                where u.username = @username and u.active and p.verified_at is null
                on conflict (user_id) do update set
                    email = excluded.email, code_salt = excluded.code_salt,
                    code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0
                returning email
                """, connection);
            command.Parameters.AddWithValue("salt", Convert.ToBase64String(salt));
            command.Parameters.AddWithValue("hash", Convert.ToBase64String(hash));
            command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
            var email = await command.ExecuteScalarAsync(cancellationToken) as string;
            if (email is null) return Results.NotFound();
            string? senderUserId = null;
            if ((await sender.GetStatusAsync(cancellationToken)).Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase))
            {
                await using var senderQuery = new NpgsqlCommand("select default_sender_user_id from vehicle_app_email_settings where id = 1", connection);
                senderUserId = await senderQuery.ExecuteScalarAsync(cancellationToken) as string;
                if (string.IsNullOrWhiteSpace(senderUserId))
                    return Results.Problem("Set the default Graph sender mailbox in Settings > Email Alerts.", statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            var result = await sender.SendAsync(email, "Vehicle App email verification", $"Your Vehicle App email alert verification code is {code}. It expires in 15 minutes.", cancellationToken, senderUserId: senderUserId);
            if (!result.Accepted)
                return Results.Problem(result.Error, statusCode: StatusCodes.Status502BadGateway);
            return Results.Ok(new { accepted = true, expiresInMinutes = 15 });
        }).RequireRateLimiting("emailTest");

        group.MapPost("/verify", async (EmailAlertVerificationRequest request, NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (request.Code is null || !Regex.IsMatch(request.Code, "^[0-9]{8}$"))
                return Results.BadRequest(new { error = "Enter the eight-digit code." });
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                select v.user_id, v.code_salt, v.code_hash, v.expires_at, v.attempts, v.email
                from email_alert_verification v join app_users u on u.id = v.user_id
                where u.username = @username and u.active
                for update of v
                """, connection, transaction);
            command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
            Guid userId;
            string saltValue, hashValue, email;
            DateTimeOffset expiresAt;
            int attempts;
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                if (!await reader.ReadAsync(cancellationToken)) return Results.BadRequest(new { error = "Request a new verification code." });
                userId = reader.GetGuid(0);
                saltValue = reader.GetString(1);
                hashValue = reader.GetString(2);
                expiresAt = reader.GetFieldValue<DateTimeOffset>(3);
                attempts = reader.GetInt32(4);
                email = reader.GetString(5);
            }
            if (expiresAt <= DateTimeOffset.UtcNow || attempts >= 5)
                return Results.BadRequest(new { error = "Verification code expired. Request a new code." });
            var computed = Rfc2898DeriveBytes.Pbkdf2(request.Code, Convert.FromBase64String(saltValue), 100_000, HashAlgorithmName.SHA256, 32);
            if (!CryptographicOperations.FixedTimeEquals(computed, Convert.FromBase64String(hashValue)))
            {
                await using var failed = new NpgsqlCommand("update email_alert_verification set attempts = attempts + 1 where user_id = @userId", connection, transaction);
                failed.Parameters.AddWithValue("userId", userId);
                await failed.ExecuteNonQueryAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return Results.BadRequest(new { error = "Verification code was not accepted." });
            }
            await using var verify = new NpgsqlCommand("""
                update email_alert_preferences set verified_at = now(), updated_at = now()
                where user_id = @userId and email = @email
                """, connection, transaction);
            verify.Parameters.AddWithValue("userId", userId);
            verify.Parameters.AddWithValue("email", email);
            var updated = await verify.ExecuteNonQueryAsync(cancellationToken);
            await using var delete = new NpgsqlCommand("delete from email_alert_verification where user_id = @userId", connection, transaction);
            delete.Parameters.AddWithValue("userId", userId);
            await delete.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return updated == 1 ? Results.Ok(new { verified = true }) : Results.BadRequest(new { error = "Alert email changed. Request a new code." });
        }).RequireRateLimiting("emailTest");

        group.MapGet("/history", async (NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                select o.id, o.status, o.attempts, o.created_at, o.accepted_at,
                       o.last_error, o.event_type, coalesce(v.display_name, 'Vehicle'),
                       o.delivery_status, o.delivery_updated_at,
                       (o.status = 'failed' and lower(o.last_provider) = 'graph'
                        and ((o.last_error = 'Graph send result is uncertain. Check Sent Items before retrying.'
                              and o.provider_batch_id is null)
                             or (o.last_error = 'Graph digest send result is uncertain. Check Sent Items before retrying.'
                                 and o.provider_batch_id is not null
                                 and o.id = (select b.id from email_alert_outbox b
                                             where b.provider_batch_id = o.provider_batch_id
                                             order by b.occurred_at, b.created_at limit 1)))
                        and o.created_at >= now() - interval '6 hours')
                from email_alert_outbox o
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
                    id = reader.GetGuid(0),
                    status = reader.GetString(1),
                    attempts = reader.GetInt32(2),
                    createdAt = reader.GetFieldValue<DateTimeOffset>(3),
                    acceptedAt = reader.IsDBNull(4) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(4),
                    reason = reader.IsDBNull(5) ? null : reader.GetString(5),
                    eventType = reader.GetString(6),
                    vehicleName = reader.GetString(7),
                    deliveryStatus = reader.GetString(8),
                    deliveryUpdatedAt = reader.IsDBNull(9) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(9),
                    canRetryAfterReview = reader.GetBoolean(10),
                });
            return Results.Ok(rows);
        });
    }
}

public sealed record EmailAlertPreferenceRequest(string? Email, bool Enabled, IReadOnlyList<string>? EventTypes, IReadOnlyList<Guid>? VehicleIds, int DailyLimit, int? QuietStartMinute, int? QuietEndMinute, string? TimeZoneId, string? QuietDeliveryMode);
public sealed record EmailAlertVerificationRequest(string? Code);

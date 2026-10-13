using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Npgsql;
using NpgsqlTypes;

public sealed class EmailAlertWorker(
    NpgsqlDataSource dataSource,
    EmailDeliveryService sender,
    ILogger<EmailAlertWorker> logger) : BackgroundService
{
    private DateTimeOffset _lastCleanupAt = DateTimeOffset.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (DateTimeOffset.UtcNow - _lastCleanupAt >= TimeSpan.FromHours(1))
                {
                    await CleanupAsync(stoppingToken);
                    _lastCleanupAt = DateTimeOffset.UtcNow;
                }
                var providerStatus = await sender.GetStatusAsync(stoppingToken);
                for (var processed = 0; processed < 10; processed++)
                {
                    var claimed = await ClaimAsync(providerStatus.Provider, stoppingToken);
                    if (claimed is not null)
                    {
                        await DeliverAsync(claimed, stoppingToken);
                        continue;
                    }
                    var digest = await ClaimDigestAsync(providerStatus.Provider, stoppingToken);
                    if (digest is null) break;
                    await DeliverDigestAsync(digest, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Email alert delivery cycle failed.");
            }

            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
        }
    }

    private async Task CleanupAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            delete from email_alert_outbox
            where status in ('accepted', 'failed', 'cancelled')
              and created_at < now() - interval '90 days'
            """, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
        await using var providerEvents = new NpgsqlCommand("delete from email_alert_provider_events where received_at < now() - interval '90 days'", connection);
        await providerEvents.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<ClaimedEmail?> ClaimAsync(string provider, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using (var interruptedDigest = new NpgsqlCommand("""
            update email_alert_outbox set status = 'failed', last_error = 'Digest send was interrupted. Review delivery before retrying.'
            where status = 'sending' and last_error = 'digest-batch' and next_attempt_at <= now()
            """, connection))
            await interruptedDigest.ExecuteNonQueryAsync(cancellationToken);
        await using (var uncertain = new NpgsqlCommand("""
            update email_alert_outbox
            set status = 'failed', last_error = 'Graph send result is uncertain. Check Sent Items before retrying.'
            where status = 'sending' and lower(last_provider) = 'graph' and next_attempt_at <= now()
            """, connection))
            await uncertain.ExecuteNonQueryAsync(cancellationToken);
        await using (var legacyUncertain = new NpgsqlCommand("""
            update email_alert_outbox
            set status = 'failed', last_error = 'Earlier send result is uncertain. Review delivery before retrying.'
            where status = 'sending' and last_provider is null and next_attempt_at <= now()
            """, connection))
            await legacyUncertain.ExecuteNonQueryAsync(cancellationToken);
        await using (var changedProvider = new NpgsqlCommand("""
            update email_alert_outbox
            set status = 'failed', last_error = 'Email provider changed during retry. Review delivery before retrying.'
            where status in ('queued', 'digest_pending') and provider_account_id is null
              and last_provider is not null and lower(last_provider) <> lower(@provider)
            """, connection))
        {
            changedProvider.Parameters.AddWithValue("provider", provider);
            await changedProvider.ExecuteNonQueryAsync(cancellationToken);
        }
        await using (var expire = new NpgsqlCommand("""
            update email_alert_outbox set status = 'cancelled', last_error = 'Alert expired before delivery.'
            where ((status in ('queued', 'sending') and created_at < now() - interval '6 hours')
                   or (status = 'digest_pending' and created_at < now() - interval '48 hours')
                   or (status = 'sending' and attempts >= 5 and next_attempt_at <= now()))
            """, connection))
            await expire.ExecuteNonQueryAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            update email_alert_outbox set status = 'sending', attempts = attempts + 1,
                last_provider = coalesce((select provider from provider_accounts where id = email_alert_outbox.provider_account_id), @provider),
                next_attempt_at = now() + interval '5 minutes'
            where id = (
                select id from email_alert_outbox
                where (status = 'queued' or (status = 'sending' and lower(last_provider) <> 'graph' and last_error is distinct from 'digest-batch'))
                  and next_attempt_at <= now() and attempts < 5
                order by next_attempt_at, created_at
                for update skip locked limit 1
            )
            returning id, user_id, recipient_email, attempts, provider_account_id
            """, connection);
        command.Parameters.AddWithValue("provider", provider);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new ClaimedEmail(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetInt32(3), reader.IsDBNull(4) ? null : reader.GetGuid(4))
            : null;
    }

    private async Task DeferToDigestAsync(Guid id, DateTimeOffset dueAt, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            update email_alert_outbox set status = 'digest_pending', attempts = greatest(attempts - 1, 0),
                next_attempt_at = @dueAt, last_error = null
            where id = @id and status = 'sending'
            """, connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("dueAt", dueAt);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<ClaimedDigest?> ClaimDigestAsync(string provider, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var expire = new NpgsqlCommand("""
            update email_alert_outbox set status = 'failed', last_error = 'Digest delivery attempts were exhausted.'
            where status = 'digest_pending' and attempts >= 5 and next_attempt_at <= now()
            """, connection, transaction))
            await expire.ExecuteNonQueryAsync(cancellationToken);

        var userId = Guid.Empty;
        Guid? existingBatchId = null;
        string recipient = string.Empty, senderUserId = string.Empty;
        Guid? providerAccountId = null;
        var dueAt = DateTimeOffset.MinValue;
        var hasGroup = false;
        await using (var group = new NpgsqlCommand("""
            select o.user_id, o.recipient_email, o.next_attempt_at,
                   case when o.sender_user_id is not null then nullif(o.sender_user_id, '')
                        else coalesce(nullif(vs.sender_user_id, ''), nullif(es.default_sender_user_id, '')) end,
                   o.provider_batch_id, o.provider_account_id
            from email_alert_outbox o
            join vehicles v on v.id = o.vehicle_id
            cross join vehicle_app_email_settings es
            left join vehicle_email_senders vs on vs.vehicle_id = o.vehicle_id
            where o.status = 'digest_pending' and o.next_attempt_at <= now()
            order by o.next_attempt_at, o.created_at
            for update of o skip locked limit 1
            """, connection, transaction))
        {
            await using var reader = await group.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                hasGroup = true;
                userId = reader.GetGuid(0);
                recipient = reader.GetString(1);
                dueAt = reader.GetFieldValue<DateTimeOffset>(2);
                senderUserId = reader.IsDBNull(3) ? string.Empty : reader.GetString(3);
                existingBatchId = reader.IsDBNull(4) ? null : reader.GetGuid(4);
                providerAccountId = reader.IsDBNull(5) ? null : reader.GetGuid(5);
            }
        }
        if (!hasGroup)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var ids = new List<Guid>();
        await using (var rows = new NpgsqlCommand("""
            select o.id
            from email_alert_outbox o
            join vehicles v on v.id = o.vehicle_id
            cross join vehicle_app_email_settings es
            left join vehicle_email_senders vs on vs.vehicle_id = o.vehicle_id
            where o.status = 'digest_pending' and o.next_attempt_at = @dueAt
              and o.user_id = @userId and o.recipient_email = @recipient
              and ((@batchId is null and o.provider_batch_id is null) or o.provider_batch_id = @batchId)
              and o.provider_account_id is not distinct from @providerAccountId
              and (case when o.sender_user_id is not null then nullif(o.sender_user_id, '')
                        else coalesce(nullif(vs.sender_user_id, ''), nullif(es.default_sender_user_id, '')) end) is not distinct from @sender
            order by o.occurred_at, o.created_at
            for update of o skip locked
            """, connection, transaction))
        {
            rows.Parameters.AddWithValue("dueAt", dueAt);
            rows.Parameters.AddWithValue("userId", userId);
            rows.Parameters.AddWithValue("recipient", recipient);
            rows.Parameters.Add("batchId", NpgsqlDbType.Uuid).Value = (object?)existingBatchId ?? DBNull.Value;
            rows.Parameters.Add("providerAccountId", NpgsqlDbType.Uuid).Value = (object?)providerAccountId ?? DBNull.Value;
            rows.Parameters.Add("sender", NpgsqlDbType.Text).Value = senderUserId.Length == 0 ? DBNull.Value : senderUserId;
            await using var reader = await rows.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetGuid(0));
        }
        if (ids.Count == 0)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var maxAttempts = 0;
        var batchId = Guid.NewGuid();
        await using (var claim = new NpgsqlCommand("""
            update email_alert_outbox set status = 'sending', attempts = attempts + 1,
                last_provider = coalesce((select provider from provider_accounts where id = email_alert_outbox.provider_account_id), @provider),
                last_error = 'digest-batch', next_attempt_at = now() + interval '5 minutes',
                provider_batch_id = @batchId
            where id = any(@ids) and status = 'digest_pending'
            returning attempts
            """, connection, transaction))
        {
            claim.Parameters.AddWithValue("provider", provider);
            claim.Parameters.AddWithValue("batchId", batchId);
            claim.Parameters.AddWithValue("ids", ids.ToArray());
            await using var reader = await claim.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) maxAttempts = Math.Max(maxAttempts, reader.GetInt32(0));
        }
        await transaction.CommitAsync(cancellationToken);
        return new ClaimedDigest(ids, batchId, userId, recipient, senderUserId.Length == 0 ? null : senderUserId, maxAttempts, providerAccountId);
    }

    private async Task DeliverDigestAsync(ClaimedDigest claim, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var details = new NpgsqlCommand("""
            select o.id, e.event_type, e.occurred_at, e.measured_value, e.unit,
                   coalesce(v.display_name, 'Vehicle'), p.daily_limit,
                   p.quiet_start_minute, p.quiet_end_minute, p.quiet_delivery_mode, p.time_zone_id
            from email_alert_outbox o
            join trip_events e on e.id = o.event_id
            join vehicles v on v.id = e.vehicle_id
            join app_users u on u.id = o.user_id
            join email_alert_preferences p on p.user_id = u.id
            where o.id = any(@ids) and o.status = 'sending'
              and o.user_id = @userId and o.recipient_email = p.email
              and u.active and p.enabled and p.verified_at is not null
              and e.event_type = any(p.event_types)
              and (cardinality(p.vehicle_ids) = 0 or e.vehicle_id = any(p.vehicle_ids))
              and (u.role = 'admin'
                   or exists (select 1 from app_user_vehicle_access a where a.user_id = u.id and a.vehicle_id = e.vehicle_id)
                   or exists (select 1 from app_group_memberships m
                              join app_group_vehicle_access a on a.group_id = m.group_id
                              where m.user_id = u.id and a.vehicle_id = e.vehicle_id))
            order by e.occurred_at
            """, connection);
        details.Parameters.AddWithValue("ids", claim.Ids.ToArray());
        details.Parameters.AddWithValue("userId", claim.UserId);
        var events = new List<DigestEvent>();
        await using (var reader = await details.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
                events.Add(new DigestEvent(
                    reader.GetGuid(0), reader.GetString(1), reader.GetFieldValue<DateTimeOffset>(2),
                    reader.IsDBNull(3) ? null : reader.GetDouble(3), reader.IsDBNull(4) ? null : reader.GetString(4),
                    reader.GetString(5), reader.GetInt32(6),
                    reader.IsDBNull(7) ? null : reader.GetInt32(7), reader.IsDBNull(8) ? null : reader.GetInt32(8),
                    reader.GetString(9), reader.GetString(10)));
        }

        var eventIds = events.Select(item => item.Id).ToHashSet();
        var cancelledIds = claim.Ids.Where(id => !eventIds.Contains(id)).ToArray();
        if (cancelledIds.Length > 0)
            await UpdateDigestRowsAsync(connection, cancelledIds, "cancelled", "Alert or recipient is no longer eligible.", null, null, cancellationToken);
        if (events.Count == 0) return;

        var first = events[0];
        if (first.QuietDeliveryMode != "digest" || !first.QuietStartMinute.HasValue || !first.QuietEndMinute.HasValue)
        {
            await UpdateDigestRowsAsync(connection, events.Select(item => item.Id).ToArray(), "cancelled", "Quiet-hours digest settings changed before delivery.", null, null, cancellationToken);
            return;
        }

        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(first.TimeZoneId); }
        catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            await UpdateDigestRowsAsync(connection, events.Select(item => item.Id).ToArray(), "cancelled", "Quiet-hours time zone is unavailable.", null, null, cancellationToken);
            return;
        }
        var now = DateTimeOffset.UtcNow;
        var localNow = TimeZoneInfo.ConvertTime(now, zone);
        if (IsQuiet(localNow, first.QuietStartMinute.Value, first.QuietEndMinute.Value))
        {
            var dueAt = NextQuietEnd(localNow, zone, first.QuietStartMinute.Value, first.QuietEndMinute.Value);
            await UpdateDigestRowsAsync(connection, events.Select(item => item.Id).ToArray(), "digest_pending", null, dueAt, null, cancellationToken);
            return;
        }

        var utcDay = now.UtcDateTime.Date;
        await using var count = new NpgsqlCommand("""
            select coalesce(sum(delivery_units) filter (where user_id = @userId), 0), coalesce(sum(delivery_units), 0)
            from email_alert_outbox
            where accepted_at >= @dayStart and accepted_at < @dayEnd
            """, connection);
        count.Parameters.AddWithValue("userId", claim.UserId);
        count.Parameters.AddWithValue("dayStart", utcDay);
        count.Parameters.AddWithValue("dayEnd", utcDay.AddDays(1));
        long userSentToday, totalSentToday;
        await using (var countReader = await count.ExecuteReaderAsync(cancellationToken))
        {
            await countReader.ReadAsync(cancellationToken);
            userSentToday = countReader.GetInt64(0);
            totalSentToday = countReader.GetInt64(1);
        }
        if (userSentToday >= first.DailyLimit || totalSentToday >= sender.GetDailyLimit())
        {
            await UpdateDigestRowsAsync(connection, events.Select(item => item.Id).ToArray(), "cancelled", "Daily email limit reached.", null, null, cancellationToken);
            return;
        }

        var body = new StringBuilder($"Vehicle App quiet-hours digest ({events.Count} events)");
        foreach (var item in events)
        {
            var value = item.MeasuredValue.HasValue
                ? $" — {item.MeasuredValue.Value.ToString("0.##", CultureInfo.InvariantCulture)} {item.Unit}".TrimEnd()
                : string.Empty;
            body.AppendLine().Append($"• {item.VehicleName}: {item.EventType.Replace('_', ' ')} at {item.OccurredAt.UtcDateTime:u}{value}");
        }

        var stableKeyMaterial = string.Join(":", claim.Ids.Order().Select(id => id.ToString("N")));
        var idempotencyKey = "digest-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(stableKeyMaterial))).ToLowerInvariant();
        var accountStatus = await GetStatusAsync(claim.ProviderAccountId, cancellationToken);
        if (!accountStatus.Ready)
        {
            var reason = "Selected email account is unavailable: " + string.Join(", ", accountStatus.MissingSettings);
            await UpdateDigestRowsAsync(connection, events.Select(item => item.Id).ToArray(), "failed", reason, null, null, cancellationToken);
            return;
        }
        var result = await sender.SendAsync(claim.RecipientEmail, $"Vehicle App: {events.Count} quiet-hours alerts", body.ToString(), cancellationToken, idempotencyKey, claim.SenderUserId, claim.ProviderAccountId);
        if (result.Accepted)
        {
            await using var accepted = new NpgsqlCommand("""
                update email_alert_outbox set status = 'accepted', accepted_at = now(),
                    provider_status_code = @statusCode, last_error = null,
                    provider_message_id = @providerMessageId,
                    delivery_units = case when id = @firstId then 1 else 0 end
                where id = any(@ids) and status = 'sending'
                """, connection);
            accepted.Parameters.AddWithValue("statusCode", (object?)result.ProviderStatusCode ?? DBNull.Value);
            accepted.Parameters.AddWithValue("providerMessageId", (object?)result.ProviderMessageId ?? DBNull.Value);
            accepted.Parameters.AddWithValue("firstId", events[0].Id);
            accepted.Parameters.AddWithValue("ids", events.Select(item => item.Id).ToArray());
            await accepted.ExecuteNonQueryAsync(cancellationToken);
            await ApplyStoredProviderReceiptAsync(connection, (await GetStatusAsync(claim.ProviderAccountId, cancellationToken)).Provider, result.ProviderMessageId, cancellationToken);
            return;
        }

        var graphMayHaveSent = (await GetStatusAsync(claim.ProviderAccountId, cancellationToken)).Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase)
            && (result.Stage is "connection" or "response"
                || (result.Stage == "Graph sendMail" && result.ProviderStatusCode is null or >= 500));
        var retryable = !graphMayHaveSent && (result.ProviderStatusCode is null or 429 or >= 500);
        var delay = result.ProviderStatusCode == 429 ? TimeSpan.FromMinutes(30) : TimeSpan.FromMinutes(5);
        var nextStatus = retryable && claim.Attempts < 5 ? "digest_pending" : "failed";
        await UpdateDigestRowsAsync(connection, events.Select(item => item.Id).ToArray(), nextStatus,
            graphMayHaveSent ? "Graph digest send result is uncertain. Check Sent Items before retrying." : result.Error ?? "Provider request failed.",
            nextStatus == "digest_pending" ? now.Add(delay) : null, result.ProviderStatusCode, cancellationToken);
    }

    private static async Task UpdateDigestRowsAsync(NpgsqlConnection connection, Guid[] ids, string status, string? error, DateTimeOffset? nextAttempt, int? providerStatusCode, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("""
            update email_alert_outbox set status = @status, last_error = @error,
                next_attempt_at = coalesce(@nextAttempt, next_attempt_at),
                provider_status_code = coalesce(@statusCode, provider_status_code)
            where id = any(@ids) and status = 'sending'
            """, connection);
        command.Parameters.AddWithValue("status", status);
        command.Parameters.Add("error", NpgsqlDbType.Text).Value = (object?)error ?? DBNull.Value;
        command.Parameters.Add("nextAttempt", NpgsqlDbType.TimestampTz).Value = (object?)nextAttempt ?? DBNull.Value;
        command.Parameters.Add("statusCode", NpgsqlDbType.Integer).Value = (object?)providerStatusCode ?? DBNull.Value;
        command.Parameters.AddWithValue("ids", ids);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task DeliverAsync(ClaimedEmail claim, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var details = new NpgsqlCommand("""
            select e.event_type, e.occurred_at, e.measured_value, e.unit,
                   coalesce(v.display_name, 'Vehicle'), p.daily_limit,
                   p.quiet_start_minute, p.quiet_end_minute, p.time_zone_id, p.quiet_delivery_mode,
                   case when o.sender_user_id is not null then nullif(o.sender_user_id, '')
                        else coalesce(nullif(vs.sender_user_id, ''), nullif(es.default_sender_user_id, '')) end
            from email_alert_outbox o
            join trip_events e on e.id = o.event_id
            join vehicles v on v.id = e.vehicle_id
            cross join vehicle_app_email_settings es
            left join vehicle_email_senders vs on vs.vehicle_id = e.vehicle_id
            join app_users u on u.id = o.user_id
            join email_alert_preferences p on p.user_id = u.id
            where o.id = @id and o.status = 'sending' and o.recipient_email = p.email
              and u.active and p.enabled and p.verified_at is not null
              and e.event_type = any(p.event_types)
              and (cardinality(p.vehicle_ids) = 0 or e.vehicle_id = any(p.vehicle_ids))
              and (u.role = 'admin'
                   or exists (select 1 from app_user_vehicle_access a where a.user_id = u.id and a.vehicle_id = e.vehicle_id)
                   or exists (select 1 from app_group_memberships m
                              join app_group_vehicle_access a on a.group_id = m.group_id
                              where m.user_id = u.id and a.vehicle_id = e.vehicle_id))
            """, connection);
        details.Parameters.AddWithValue("id", claim.Id);
        string eventType, vehicleName;
        DateTimeOffset occurredAt;
        double? measuredValue;
        string? unit;
        int dailyLimit;
        int? quietStartMinute, quietEndMinute;
        string timeZoneId, quietDeliveryMode;
        string? senderUserId;
        await using (var reader = await details.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                await CancelAsync(claim.Id, "Alert or recipient is no longer eligible.", cancellationToken);
                return;
            }
            eventType = reader.GetString(0);
            occurredAt = reader.GetFieldValue<DateTimeOffset>(1);
            measuredValue = reader.IsDBNull(2) ? null : reader.GetDouble(2);
            unit = reader.IsDBNull(3) ? null : reader.GetString(3);
            vehicleName = reader.GetString(4);
            dailyLimit = reader.GetInt32(5);
            quietStartMinute = reader.IsDBNull(6) ? null : reader.GetInt32(6);
            quietEndMinute = reader.IsDBNull(7) ? null : reader.GetInt32(7);
            timeZoneId = reader.GetString(8);
            quietDeliveryMode = reader.GetString(9);
            senderUserId = reader.IsDBNull(10) ? null : reader.GetString(10);
        }

        if (quietStartMinute.HasValue && quietEndMinute.HasValue)
        {
            TimeZoneInfo zone;
            try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
            catch (TimeZoneNotFoundException)
            {
                await CancelAsync(claim.Id, "Quiet-hours time zone is unavailable.", cancellationToken);
                return;
            }
            catch (InvalidTimeZoneException)
            {
                await CancelAsync(claim.Id, "Quiet-hours time zone is invalid.", cancellationToken);
                return;
            }
            var occurredLocal = TimeZoneInfo.ConvertTime(occurredAt, zone);
            var localNow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone);
            var occurredDuringQuiet = IsQuiet(occurredLocal, quietStartMinute.Value, quietEndMinute.Value);
            var currentlyQuiet = IsQuiet(localNow, quietStartMinute.Value, quietEndMinute.Value);
            if (occurredDuringQuiet || currentlyQuiet)
            {
                if (quietDeliveryMode == "digest")
                {
                    var dueAt = currentlyQuiet
                        ? NextQuietEnd(localNow, zone, quietStartMinute.Value, quietEndMinute.Value)
                        : NextQuietEnd(occurredLocal, zone, quietStartMinute.Value, quietEndMinute.Value);
                    await DeferToDigestAsync(claim.Id, dueAt, cancellationToken);
                }
                else
                    await CancelAsync(claim.Id, "Suppressed by quiet hours.", cancellationToken);
                return;
            }
        }

        var utcDay = DateTime.UtcNow.Date;
        await using var count = new NpgsqlCommand("""
            select coalesce(sum(delivery_units) filter (where user_id = @userId), 0), coalesce(sum(delivery_units), 0)
            from email_alert_outbox
            where accepted_at >= @dayStart and accepted_at < @dayEnd
            """, connection);
        count.Parameters.AddWithValue("userId", claim.UserId);
        count.Parameters.AddWithValue("dayStart", utcDay);
        count.Parameters.AddWithValue("dayEnd", utcDay.AddDays(1));
        long userSentToday, totalSentToday;
        await using (var countReader = await count.ExecuteReaderAsync(cancellationToken))
        {
            await countReader.ReadAsync(cancellationToken);
            userSentToday = countReader.GetInt64(0);
            totalSentToday = countReader.GetInt64(1);
        }
        if (userSentToday >= dailyLimit || totalSentToday >= sender.GetDailyLimit())
        {
            await CancelAsync(claim.Id, "Daily email limit reached.", cancellationToken);
            return;
        }

        var label = eventType.Replace('_', ' ');
        var measurement = measuredValue.HasValue
            ? $"Measured value: {measuredValue.Value.ToString("0.##", CultureInfo.InvariantCulture)} {unit}".TrimEnd() + Environment.NewLine
            : string.Empty;
        var body = $"Vehicle: {vehicleName}{Environment.NewLine}Event: {label}{Environment.NewLine}Time: {occurredAt.UtcDateTime:u}{Environment.NewLine}{measurement}";
        var accountStatus = await GetStatusAsync(claim.ProviderAccountId, cancellationToken);
        if (!accountStatus.Ready)
        {
            await using var unavailable = new NpgsqlCommand("update email_alert_outbox set status = 'failed', last_error = @error where id = @id and status = 'sending'", connection);
            unavailable.Parameters.AddWithValue("id", claim.Id);
            unavailable.Parameters.AddWithValue("error", "Selected email account is unavailable: " + string.Join(", ", accountStatus.MissingSettings));
            await unavailable.ExecuteNonQueryAsync(cancellationToken);
            return;
        }
        var result = await sender.SendAsync(claim.RecipientEmail, $"Vehicle App: {label}", body, cancellationToken, claim.Id.ToString("N"), senderUserId, claim.ProviderAccountId);
        if (result.Accepted)
        {
            await using var accepted = new NpgsqlCommand("""
                update email_alert_outbox set status = 'accepted', accepted_at = now(),
                    provider_status_code = @statusCode, last_error = null,
                    provider_message_id = @providerMessageId
                where id = @id and status = 'sending'
                """, connection);
            accepted.Parameters.AddWithValue("id", claim.Id);
            accepted.Parameters.AddWithValue("statusCode", (object?)result.ProviderStatusCode ?? DBNull.Value);
            accepted.Parameters.AddWithValue("providerMessageId", (object?)result.ProviderMessageId ?? DBNull.Value);
            await accepted.ExecuteNonQueryAsync(cancellationToken);
            await ApplyStoredProviderReceiptAsync(connection, (await GetStatusAsync(claim.ProviderAccountId, cancellationToken)).Provider, result.ProviderMessageId, cancellationToken);
            return;
        }

        var graphMayHaveSent = (await GetStatusAsync(claim.ProviderAccountId, cancellationToken)).Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase)
            && (result.Stage is "connection" or "response"
                || (result.Stage == "Graph sendMail" && result.ProviderStatusCode is null or >= 500));
        var retryable = !graphMayHaveSent && (result.ProviderStatusCode is null or 429 or >= 500);
        var delay = result.ProviderStatusCode == 429
            ? TimeSpan.FromMinutes(30)
            : TimeSpan.FromMinutes(Math.Pow(2, claim.Attempts - 1));
        await using var failed = new NpgsqlCommand("""
            update email_alert_outbox set
                status = @status, next_attempt_at = @nextAttempt,
                provider_status_code = @statusCode, last_error = @error
            where id = @id and status = 'sending'
            """, connection);
        failed.Parameters.AddWithValue("id", claim.Id);
        failed.Parameters.AddWithValue("status", retryable && claim.Attempts < 5 ? "queued" : "failed");
        failed.Parameters.AddWithValue("nextAttempt", DateTime.UtcNow.Add(delay));
        failed.Parameters.AddWithValue("statusCode", (object?)result.ProviderStatusCode ?? DBNull.Value);
        failed.Parameters.AddWithValue("error", graphMayHaveSent
            ? "Graph send result is uncertain. Check Sent Items before retrying."
            : result.Error ?? "Provider request failed.");
        await failed.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ApplyStoredProviderReceiptAsync(NpgsqlConnection connection, string provider, string? providerMessageId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(providerMessageId)) return;
        await using var command = new NpgsqlCommand("""
            update email_alert_outbox o set
                delivery_status = e.delivery_status,
                delivery_updated_at = coalesce(e.provider_event_at, e.received_at)
            from lateral (
                select delivery_status, provider_event_at, received_at
                from email_alert_provider_events
                where lower(provider) = lower(@provider) and provider_message_id = @messageId
                order by provider_event_at desc nulls last, received_at desc
                limit 1
            ) e
            where lower(o.last_provider) = lower(@provider) and o.provider_message_id = @messageId
            """, connection);
        command.Parameters.AddWithValue("provider", provider);
        command.Parameters.AddWithValue("messageId", providerMessageId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task CancelAsync(Guid id, string reason, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("update email_alert_outbox set status = 'cancelled', last_error = @reason where id = @id and status = 'sending'", connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("reason", reason);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static bool IsQuiet(DateTimeOffset localTime, int startMinute, int endMinute)
    {
        var minute = localTime.Hour * 60 + localTime.Minute;
        return startMinute < endMinute
            ? minute >= startMinute && minute < endMinute
            : minute >= startMinute || minute < endMinute;
    }

    private static DateTimeOffset NextQuietEnd(DateTimeOffset localNow, TimeZoneInfo zone, int startMinute, int endMinute)
    {
        var localDate = DateTime.SpecifyKind(localNow.DateTime.Date, DateTimeKind.Unspecified);
        var minute = localNow.Hour * 60 + localNow.Minute;
        if (startMinute >= endMinute && minute >= startMinute)
            localDate = localDate.AddDays(1);
        var end = localDate.AddMinutes(endMinute);
        while (zone.IsInvalidTime(end)) end = end.AddMinutes(1);
        var utc = TimeZoneInfo.ConvertTimeToUtc(end, zone);
        return new DateTimeOffset(utc, TimeSpan.Zero);
    }

    private Task<EmailConfigurationStatus> GetStatusAsync(Guid? accountId, CancellationToken cancellationToken) =>
        accountId.HasValue ? sender.GetStatusForAccountAsync(accountId.Value, cancellationToken) : sender.GetStatusAsync(cancellationToken);

    private sealed record ClaimedEmail(Guid Id, Guid UserId, string RecipientEmail, int Attempts, Guid? ProviderAccountId);
    private sealed record ClaimedDigest(List<Guid> Ids, Guid BatchId, Guid UserId, string RecipientEmail, string? SenderUserId, int Attempts, Guid? ProviderAccountId);
    private sealed record DigestEvent(Guid Id, string EventType, DateTimeOffset OccurredAt, double? MeasuredValue, string? Unit, string VehicleName, int DailyLimit, int? QuietStartMinute, int? QuietEndMinute, string QuietDeliveryMode, string TimeZoneId);
}

using System.Globalization;
using Npgsql;

public sealed class SmsAlertWorker(
    NpgsqlDataSource dataSource,
    SmsDeliveryService sender,
    ILogger<SmsAlertWorker> logger) : BackgroundService
{
    private DateTimeOffset _lastCleanup = DateTimeOffset.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (DateTimeOffset.UtcNow - _lastCleanup > TimeSpan.FromHours(1))
                {
                    await CleanupAsync(stoppingToken);
                    _lastCleanup = DateTimeOffset.UtcNow;
                }
                var status = await sender.GetStatusAsync(stoppingToken);
                for (var count = 0; count < 10; count++)
                {
                    var claim = await ClaimAsync(status.Provider, stoppingToken);
                    if (claim is null) break;
                    await DeliverAsync(claim, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "SMS alert delivery cycle failed.");
            }
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
        }
    }

    private async Task CleanupAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            delete from sms_alert_outbox
            where status in ('accepted', 'failed', 'cancelled') and created_at < now() - interval '90 days';
            delete from sms_alert_inbound_events where received_at < now() - interval '90 days';
            delete from sms_alert_status_events where received_at < now() - interval '90 days';
            delete from sms_alert_verification where expires_at < now() - interval '1 day';
            """, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<SmsAlertClaim?> ClaimAsync(string fallbackProvider, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using (var interrupted = new NpgsqlCommand("""
            update sms_alert_outbox set status = 'failed',
                last_error = 'Twilio send result is uncertain after an interrupted request. Review the provider log before taking action.'
            where status = 'sending' and next_attempt_at <= now()
            """, connection))
            await interrupted.ExecuteNonQueryAsync(cancellationToken);
        await using (var expired = new NpgsqlCommand("""
            update sms_alert_outbox set status = 'cancelled', last_error = 'Alert expired before delivery.'
            where status = 'queued' and created_at < now() - interval '6 hours'
            """, connection))
            await expired.ExecuteNonQueryAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            update sms_alert_outbox set status = 'sending', attempts = attempts + 1,
                last_provider = lower(coalesce((select provider from provider_accounts where id = sms_alert_outbox.provider_account_id), @provider)),
                next_attempt_at = now() + interval '3 minutes'
            where id = (
                select id from sms_alert_outbox
                where status = 'queued' and next_attempt_at <= now() and attempts < 3
                order by next_attempt_at, created_at
                for update skip locked limit 1
            )
            returning id, user_id, attempts, provider_account_id
            """, connection);
        command.Parameters.AddWithValue("provider", fallbackProvider);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new SmsAlertClaim(reader.GetGuid(0), reader.GetGuid(1), reader.GetInt32(2), reader.IsDBNull(3) ? null : reader.GetGuid(3))
            : null;
    }

    private async Task DeliverAsync(SmsAlertClaim claim, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var details = new NpgsqlCommand("""
            select o.recipient_phone, e.event_type, e.occurred_at, e.measured_value, e.unit,
                   coalesce(v.display_name, 'Vehicle'), p.daily_limit
            from sms_alert_outbox o
            join trip_events e on e.id = o.event_id
            join vehicles v on v.id = e.vehicle_id
            join app_users u on u.id = o.user_id
            join sms_alert_preferences p on p.user_id = u.id
            where o.id = @id and o.status = 'sending'
              and p.enabled and p.verified_at is not null and p.stopped_at is null
              and p.phone = o.recipient_phone and u.active
              and e.event_type = any(p.event_types)
              and (cardinality(p.vehicle_ids) = 0 or e.vehicle_id = any(p.vehicle_ids))
              and (u.role = 'admin'
                   or exists (select 1 from app_user_vehicle_access a where a.user_id = u.id and a.vehicle_id = e.vehicle_id)
                   or exists (select 1 from app_group_memberships m
                              join app_group_vehicle_access a on a.group_id = m.group_id
                              where m.user_id = u.id and a.vehicle_id = e.vehicle_id))
            """, connection);
        details.Parameters.AddWithValue("id", claim.Id);
        string phone = string.Empty, eventType = string.Empty, unit = string.Empty, vehicleName = string.Empty;
        DateTimeOffset occurredAt = default;
        double? measuredValue = null;
        var dailyLimit = 5;
        await using (var reader = await details.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                phone = reader.GetString(0);
                eventType = reader.GetString(1);
                occurredAt = reader.GetFieldValue<DateTimeOffset>(2);
                measuredValue = reader.IsDBNull(3) ? null : reader.GetDouble(3);
                unit = reader.IsDBNull(4) ? string.Empty : reader.GetString(4);
                vehicleName = reader.GetString(5);
                dailyLimit = reader.GetInt32(6);
            }
        }
        if (string.IsNullOrEmpty(phone))
        {
            await UpdateAsync(connection, claim.Id, "cancelled", "Recipient or event is no longer eligible.", null, null, null, cancellationToken);
            return;
        }

        var accountStatus = claim.ProviderAccountId.HasValue
            ? await sender.GetStatusForAccountAsync(claim.ProviderAccountId.Value, cancellationToken)
            : await sender.GetStatusAsync(cancellationToken);
        if (!accountStatus.AutomaticAlertsReady)
        {
            var reason = accountStatus.AutomaticAlertsMissingSettings.Count > 0
                ? string.Join(", ", accountStatus.AutomaticAlertsMissingSettings)
                : string.Join(", ", accountStatus.MissingSettings);
            await UpdateAsync(connection, claim.Id, "failed", "Selected SMS account is unavailable for automatic alerts: " + reason, null, null, null, cancellationToken);
            return;
        }

        var today = DateTime.UtcNow.Date;
        await using (var count = new NpgsqlCommand("""
            select count(*) filter (where user_id = @userId), count(*)
            from sms_alert_outbox
            where accepted_at >= @dayStart and accepted_at < @dayEnd
            """, connection))
        {
            count.Parameters.AddWithValue("userId", claim.UserId);
            count.Parameters.AddWithValue("dayStart", today);
            count.Parameters.AddWithValue("dayEnd", today.AddDays(1));
            await using var reader = await count.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            if (reader.GetInt64(0) >= dailyLimit || reader.GetInt64(1) >= sender.GetAlertDailyLimit())
            {
                await reader.CloseAsync();
                await UpdateAsync(connection, claim.Id, "cancelled", "Daily SMS alert limit reached.", null, null, null, cancellationToken);
                return;
            }
        }

        var label = eventType.Replace('_', ' ');
        var value = measuredValue.HasValue
            ? $" {measuredValue.Value.ToString("0.##", CultureInfo.InvariantCulture)} {unit}".TrimEnd()
            : string.Empty;
        var body = $"{vehicleName}: {label}{value}. {occurredAt.UtcDateTime:u}. Reply STOP to opt out.";
        if (body.Length > 320) body = body[..317] + "...";
        var result = await sender.SendAsync(phone, body, cancellationToken,
            await sender.GetTwilioStatusCallbackUrlAsync(cancellationToken, claim.ProviderAccountId), claim.ProviderAccountId);
        if (result.Accepted)
        {
            await UpdateAsync(connection, claim.Id, "accepted", null, result.ProviderStatusCode,
                result.ProviderMessageId, result.InitialStatus ?? "queued", cancellationToken);
            await ApplyStoredStatusAsync(connection, result.ProviderMessageId, cancellationToken);
            return;
        }

        var retryable = result.ProviderStatusCode == 429;
        var nextAttempt = retryable ? DateTimeOffset.UtcNow.AddMinutes(15) : (DateTimeOffset?)null;
        var nextStatus = retryable && claim.Attempts < 3 ? "queued" : "failed";
        var error = result.ProviderStatusCode is null
            ? "Twilio send result is uncertain. Review the provider log before taking action."
            : result.Error ?? "Twilio rejected the alert.";
        await UpdateAsync(connection, claim.Id, nextStatus, error, result.ProviderStatusCode, null, null, cancellationToken, nextAttempt);
    }

    private static async Task ApplyStoredStatusAsync(NpgsqlConnection connection, string? messageSid, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(messageSid)) return;
        await using var command = new NpgsqlCommand("""
            update sms_alert_outbox set delivery_status = e.delivery_status,
                provider_error_code = coalesce(e.provider_error_code, sms_alert_outbox.provider_error_code)
            from (
                select delivery_status, provider_error_code from sms_alert_status_events
                where message_sid = @sid
                order by case delivery_status
                    when 'delivered' then 4 when 'undelivered' then 3 when 'failed' then 3
                    when 'sent' then 2 else 1 end desc, received_at desc
                limit 1
            ) e
            where provider_message_id = @sid and last_provider = 'twilio'
            """, connection);
        command.Parameters.AddWithValue("sid", messageSid);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task UpdateAsync(NpgsqlConnection connection, Guid id, string status, string? error,
        int? providerStatusCode, string? messageId, string? deliveryStatus, CancellationToken cancellationToken,
        DateTimeOffset? nextAttempt = null)
    {
        await using var command = new NpgsqlCommand("""
            update sms_alert_outbox set status = @status, last_error = @error,
                provider_status_code = @statusCode, provider_message_id = @messageId,
                delivery_status = coalesce(@deliveryStatus, delivery_status),
                accepted_at = case when @status = 'accepted' then now() else accepted_at end,
                next_attempt_at = coalesce(@nextAttempt, next_attempt_at)
            where id = @id and status = 'sending'
            """, connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("status", status);
        command.Parameters.AddWithValue("error", (object?)error ?? DBNull.Value);
        command.Parameters.AddWithValue("statusCode", (object?)providerStatusCode ?? DBNull.Value);
        command.Parameters.AddWithValue("messageId", (object?)messageId ?? DBNull.Value);
        command.Parameters.AddWithValue("deliveryStatus", (object?)deliveryStatus ?? DBNull.Value);
        command.Parameters.AddWithValue("nextAttempt", (object?)nextAttempt ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private sealed record SmsAlertClaim(Guid Id, Guid UserId, int Attempts, Guid? ProviderAccountId);
}

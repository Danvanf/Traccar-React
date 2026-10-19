using System.Net.Mail;
using Npgsql;
using NpgsqlTypes;

public static class EmailDeliveryEndpoints
{
    public static void MapEmailDeliveryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/admin/email/status", async (EmailDeliveryService email, NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            var status = await email.GetStatusAsync(cancellationToken);
            var sender = await GetDefaultSenderAsync(dataSource, cancellationToken);
            var missing = status.MissingSettings.ToList();
            if (status.Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(sender))
                missing.Add("Sender mailbox (set in Email Alerts settings)");
            return Results.Ok(new { status.Provider, ready = status.Ready && missing.Count == 0, missingSettings = missing, defaultSenderUserId = sender, configurationSource = status.Source });
        })
            .RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/email/settings", async (NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
                Results.Ok(new { defaultSenderUserId = await GetDefaultSenderAsync(dataSource, cancellationToken) }))
            .RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPut("/api/admin/email/settings", async (EmailSenderSettingsRequest request, NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            var sender = request.SenderUserId?.Trim() ?? string.Empty;
            if (!ValidSender(sender)) return Results.BadRequest(new { error = "Enter a valid sender mailbox address, or leave it blank to clear the default." });
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("update traccar_scope_api_email_settings set default_sender_user_id = @sender, updated_at = now() where id = 1", connection);
            command.Parameters.AddWithValue("sender", sender);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.Ok(new { saved = true, defaultSenderUserId = sender });
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/email/vehicles/{vehicleId:guid}/sender", async (Guid vehicleId, NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("select sender_user_id from vehicle_email_senders where vehicle_id = @vehicleId", connection);
            command.Parameters.AddWithValue("vehicleId", vehicleId);
            return Results.Ok(new { senderUserId = await command.ExecuteScalarAsync(cancellationToken) as string });
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPut("/api/admin/email/vehicles/{vehicleId:guid}/sender", async (Guid vehicleId, EmailSenderSettingsRequest request, NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            var sender = request.SenderUserId?.Trim() ?? string.Empty;
            if (!ValidSender(sender)) return Results.BadRequest(new { error = "Enter a valid sender mailbox address, or leave it blank to use the default." });
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand(sender.Length == 0
                ? "delete from vehicle_email_senders where vehicle_id = @vehicleId"
                : "insert into vehicle_email_senders (vehicle_id, sender_user_id, updated_at) values (@vehicleId, @sender, now()) on conflict (vehicle_id) do update set sender_user_id = excluded.sender_user_id, updated_at = now()", connection);
            command.Parameters.AddWithValue("vehicleId", vehicleId);
            if (sender.Length > 0) command.Parameters.AddWithValue("sender", sender);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.Ok(new { saved = true, senderUserId = sender.Length == 0 ? null : sender });
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPost("/api/admin/email/provider-accounts/{accountId:guid}/check", async (Guid accountId, EmailDeliveryService email, CancellationToken cancellationToken) =>
            Results.Ok(await email.CheckConnectionAsync(accountId, cancellationToken)))
            .RequireAuthorization(policy => policy.RequireRole("admin"))
            .RequireRateLimiting("emailTest");

        app.MapPost("/api/admin/email/history/{outboxId:guid}/retry-uncertain", async (Guid outboxId, EmailUncertainRetryRequest request, EmailDeliveryService email, NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (!request.ConfirmSentItemsChecked)
                return Results.BadRequest(new { error = "Confirm that you checked the sender's Sent Items before retrying." });
            var status = await email.GetStatusAsync(cancellationToken);
            if (!status.Ready || !status.Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase))
                return Results.Conflict(new { error = "The configured provider must still be Microsoft Graph before retrying this alert." });

            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            string? priorReason;
            Guid? batchId;
            await using (var check = new NpgsqlCommand("""
                select provider_batch_id, last_error from email_alert_outbox
                where id = @id and status = 'failed' and lower(last_provider) = 'graph'
                  and last_error in (
                    'Graph send result is uncertain. Check Sent Items before retrying.',
                    'Graph digest send result is uncertain. Check Sent Items before retrying.')
                  and created_at >= now() - interval '6 hours'
                """, connection, transaction))
            {
                check.Parameters.AddWithValue("id", outboxId);
                await using var reader = await check.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    batchId = reader.IsDBNull(0) ? null : reader.GetGuid(0);
                    priorReason = reader.GetString(1);
                }
                else
                {
                    batchId = null;
                    priorReason = null;
                }
            }
            if (priorReason is null) return Results.NotFound(new { error = "This alert is not eligible for a reviewed retry." });

            var lockedIds = new List<Guid>();
            await using (var lockRows = new NpgsqlCommand("""
                select id from email_alert_outbox
                where status = 'failed' and lower(last_provider) = 'graph'
                  and last_error = @reason and created_at >= now() - interval '6 hours'
                  and ((@batchId is null and id = @id and provider_batch_id is null)
                       or (@batchId is not null and provider_batch_id = @batchId))
                order by id for update
                """, connection, transaction))
            {
                lockRows.Parameters.AddWithValue("id", outboxId);
                lockRows.Parameters.AddWithValue("reason", priorReason);
                lockRows.Parameters.Add("batchId", NpgsqlDbType.Uuid).Value = (object?)batchId ?? DBNull.Value;
                await using var reader = await lockRows.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken)) lockedIds.Add(reader.GetGuid(0));
            }
            if (!lockedIds.Contains(outboxId)) return Results.NotFound(new { error = "This alert is not eligible for a reviewed retry." });

            await using (var audit = new NpgsqlCommand("""
                insert into email_alert_manual_retries (outbox_id, administrator, prior_reason, provider_batch_id)
                select id, @administrator, last_error, provider_batch_id
                from email_alert_outbox
                where status = 'failed' and lower(last_provider) = 'graph'
                  and last_error = @reason
                  and created_at >= now() - interval '6 hours'
                  and ((@batchId is null and id = @id and provider_batch_id is null)
                       or (@batchId is not null and provider_batch_id = @batchId))
                """, connection, transaction))
            {
                audit.Parameters.AddWithValue("id", outboxId);
                audit.Parameters.AddWithValue("administrator", context.User.Identity?.Name ?? "unknown");
                audit.Parameters.AddWithValue("reason", priorReason);
                audit.Parameters.Add("batchId", NpgsqlDbType.Uuid).Value = (object?)batchId ?? DBNull.Value;
                await audit.ExecuteNonQueryAsync(cancellationToken);
            }
            await using (var retry = new NpgsqlCommand("""
                update email_alert_outbox set status = @status, attempts = 0,
                    next_attempt_at = now(), last_error = null, provider_status_code = null,
                    provider_message_id = null, delivery_status = 'pending', delivery_updated_at = null,
                    accepted_at = null, delivery_units = 1
                where status = 'failed' and lower(last_provider) = 'graph'
                  and last_error = @reason
                  and created_at >= now() - interval '6 hours'
                  and ((@batchId is null and id = @id and provider_batch_id is null)
                       or (@batchId is not null and provider_batch_id = @batchId))
                """, connection, transaction))
            {
                retry.Parameters.AddWithValue("id", outboxId);
                retry.Parameters.AddWithValue("status", batchId.HasValue ? "digest_pending" : "queued");
                retry.Parameters.AddWithValue("reason", priorReason);
                retry.Parameters.Add("batchId", NpgsqlDbType.Uuid).Value = (object?)batchId ?? DBNull.Value;
                await retry.ExecuteNonQueryAsync(cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new { queued = true });
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPost("/api/admin/email/test-send", async (EmailTestSendRequest request, EmailDeliveryService email, NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            var recipient = request.To?.Trim();
            if (!request.ConfirmSend)
                return Results.BadRequest(new { error = "Set confirmSend to true to send a real email." });
            if (string.IsNullOrWhiteSpace(recipient) || recipient.Length > 320
                || !MailAddress.TryCreate(recipient, out var parsed) || parsed.Address != recipient)
                return Results.BadRequest(new { error = "A valid recipient email address is required." });

            var subject = string.IsNullOrWhiteSpace(request.Subject) ? "Traccar Scope API email test" : request.Subject.Trim();
            var body = string.IsNullOrWhiteSpace(request.Body) ? "This is a test message from Traccar Scope API." : request.Body.Trim();
            if (subject.Length > 200 || body.Length > 4000)
                return Results.BadRequest(new { error = "Subject or body is too long." });

            var status = await email.GetStatusAsync(cancellationToken);
            if (!status.Ready)
                return Results.Problem("Email provider is disabled or incomplete.", statusCode: StatusCodes.Status503ServiceUnavailable);

            var sender = await GetDefaultSenderAsync(dataSource, cancellationToken);
            if (status.Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(sender))
                return Results.Problem("Set the default Graph sender mailbox in Settings > Email Alerts.", statusCode: StatusCodes.Status503ServiceUnavailable);
            var result = await email.SendAsync(recipient, subject, body, cancellationToken, senderUserId: sender);
            return result.Accepted
                ? Results.Ok(new { accepted = true, provider = status.Provider, providerStatusCode = result.ProviderStatusCode })
                : Results.Problem(result.Error, statusCode: StatusCodes.Status502BadGateway,
                    extensions: new Dictionary<string, object?>
                    {
                        ["provider"] = status.Provider,
                        ["stage"] = result.Stage,
                        ["providerStatusCode"] = result.ProviderStatusCode,
                    });
        })
            .RequireAuthorization(policy => policy.RequireRole("admin"))
            .RequireRateLimiting("emailTest");
    }

    private static async Task<string?> GetDefaultSenderAsync(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select default_sender_user_id from traccar_scope_api_email_settings where id = 1", connection);
        return (await command.ExecuteScalarAsync(cancellationToken) as string)?.Trim();
    }

    private static bool ValidSender(string sender) => sender.Length <= 320
        && (sender.Length == 0 || (MailAddress.TryCreate(sender, out var parsed) && parsed.Address == sender));
}

public sealed record EmailTestSendRequest(string? To, string? Subject, string? Body, bool ConfirmSend);
public sealed record EmailSenderSettingsRequest(string? SenderUserId);
public sealed record EmailUncertainRetryRequest(bool ConfirmSentItemsChecked);

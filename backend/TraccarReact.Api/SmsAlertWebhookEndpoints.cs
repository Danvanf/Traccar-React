using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Npgsql;

public static class SmsAlertWebhookEndpoints
{
    private const int MaxFormFields = 100;

    public static void MapSmsAlertWebhookEndpoints(this WebApplication app)
    {
        app.MapPost("/api/sms/webhooks/twilio/inbound", (HttpRequest request, SmsDeliveryService sms, NpgsqlDataSource dataSource, CancellationToken token) => InboundAsync(request, null, sms, dataSource, token)).AllowAnonymous();
        app.MapPost("/api/sms/webhooks/twilio/status", (HttpRequest request, SmsDeliveryService sms, NpgsqlDataSource dataSource, CancellationToken token) => StatusAsync(request, null, sms, dataSource, token)).AllowAnonymous();
        app.MapPost("/api/sms/webhooks/twilio/{accountId:guid}/inbound", (HttpRequest request, Guid accountId, SmsDeliveryService sms, NpgsqlDataSource dataSource, CancellationToken token) => InboundAsync(request, accountId, sms, dataSource, token)).AllowAnonymous();
        app.MapPost("/api/sms/webhooks/twilio/{accountId:guid}/status", (HttpRequest request, Guid accountId, SmsDeliveryService sms, NpgsqlDataSource dataSource, CancellationToken token) => StatusAsync(request, accountId, sms, dataSource, token)).AllowAnonymous();
    }

    private static async Task<IResult> InboundAsync(HttpRequest request, Guid? accountId, SmsDeliveryService sms, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (!await sms.AuthenticateWebhookAsync(request.Headers.Authorization.ToString(), accountId, cancellationToken)) return Results.Unauthorized();
        if (!request.HasFormContentType) return Results.BadRequest();
        var form = await request.ReadFormAsync(cancellationToken);
        if (form.Count > MaxFormFields) return Results.BadRequest();
        var messageSid = form["MessageSid"].ToString();
        var from = form["From"].ToString();
        var to = form["To"].ToString();
        var optOutType = form["OptOutType"].ToString().Trim().ToUpperInvariant();
        if (messageSid.Length is < 1 or > 100 || !Regex.IsMatch(from, @"^\+[1-9][0-9]{7,14}$")
            || !Regex.IsMatch(to, @"^\+[1-9][0-9]{7,14}$")) return Results.BadRequest();
        if (optOutType is not ("STOP" or "START" or "HELP")) return TwimlOk();

        if (!await sms.IsTwilioDestinationAsync(to, accountId, cancellationToken)) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var record = new NpgsqlCommand("""
            insert into sms_alert_inbound_events (message_sid, sender_phone, destination_phone, opt_out_type)
            values (@sid, @from, @to, @type) on conflict (message_sid) do nothing
            returning message_sid
            """, connection, transaction))
        {
            record.Parameters.AddWithValue("sid", messageSid);
            record.Parameters.AddWithValue("from", from);
            record.Parameters.AddWithValue("to", to);
            record.Parameters.AddWithValue("type", optOutType);
            if (await record.ExecuteScalarAsync(cancellationToken) is not null)
            {
                if (optOutType == "STOP")
                {
                    await using var stop = new NpgsqlCommand("update sms_alert_preferences set enabled = false, stopped_at = now(), updated_at = now() where phone = @phone", connection, transaction);
                    stop.Parameters.AddWithValue("phone", from);
                    await stop.ExecuteNonQueryAsync(cancellationToken);
                    await using var cancel = new NpgsqlCommand("update sms_alert_outbox set status = 'cancelled', last_error = 'Recipient opted out before delivery.' where recipient_phone = @phone and status = 'queued'", connection, transaction);
                    cancel.Parameters.AddWithValue("phone", from);
                    await cancel.ExecuteNonQueryAsync(cancellationToken);
                }
                else if (optOutType == "START")
                {
                    await using var start = new NpgsqlCommand("update sms_alert_preferences set stopped_at = null, updated_at = now() where phone = @phone", connection, transaction);
                    start.Parameters.AddWithValue("phone", from);
                    await start.ExecuteNonQueryAsync(cancellationToken);
                }
            }
        }
        await transaction.CommitAsync(cancellationToken);
        return TwimlOk();
    }

    private static async Task<IResult> StatusAsync(HttpRequest request, Guid? accountId, SmsDeliveryService sms, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (!await sms.AuthenticateWebhookAsync(request.Headers.Authorization.ToString(), accountId, cancellationToken)) return Results.Unauthorized();
        if (!request.HasFormContentType) return Results.BadRequest();
        var form = await request.ReadFormAsync(cancellationToken);
        if (form.Count > MaxFormFields) return Results.BadRequest();
        var messageSid = form["MessageSid"].ToString();
        var messageStatus = form["MessageStatus"].ToString().Trim().ToLowerInvariant();
        if (messageSid.Length is < 1 or > 100) return Results.BadRequest();
        var deliveryStatus = messageStatus switch
        {
            "queued" or "accepted" or "scheduled" => "queued",
            "sending" => "queued",
            "sent" => "sent",
            "delivered" => "delivered",
            "undelivered" => "undelivered",
            "failed" or "canceled" or "cancelled" => "failed",
            _ => null,
        };
        if (deliveryStatus is null) return Results.Ok();
        int? errorCode = int.TryParse(form["ErrorCode"].ToString(), NumberStyles.None, CultureInfo.InvariantCulture, out var code) ? code : null;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using (var insert = new NpgsqlCommand("""
            insert into sms_alert_status_events (message_sid, delivery_status, provider_error_code)
            values (@sid, @deliveryStatus, @errorCode)
            on conflict (message_sid, delivery_status) do nothing
            """, connection))
        {
            insert.Parameters.AddWithValue("sid", messageSid);
            insert.Parameters.AddWithValue("deliveryStatus", deliveryStatus);
            insert.Parameters.AddWithValue("errorCode", (object?)errorCode ?? DBNull.Value);
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }
        await using var command = new NpgsqlCommand("""
            update sms_alert_outbox set
                delivery_status = e.delivery_status,
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
              and sms_alert_outbox.delivery_status not in ('delivered', 'undelivered', 'failed')
            """, connection);
        command.Parameters.AddWithValue("sid", messageSid);
        await command.ExecuteNonQueryAsync(cancellationToken);
        return Results.Ok();
    }

    private static IResult TwimlOk() => Results.Content("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>", "application/xml", Encoding.UTF8);
}

using System.Text.RegularExpressions;
using Npgsql;

public static class SmsDeliveryEndpoints
{
    public static void MapSmsDeliveryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/admin/sms/status", async (SmsDeliveryService sms, CancellationToken cancellationToken) => Results.Ok(await sms.GetStatusAsync(cancellationToken)))
            .RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/sms/check-connection", async (SmsDeliveryService sms, CancellationToken cancellationToken) =>
                Results.Ok(await sms.CheckTwilioConnectionAsync(cancellationToken)))
            .RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/sms/accounts/{accountId:guid}/check-connection", async (Guid accountId, SmsDeliveryService sms, CancellationToken cancellationToken) =>
                Results.Ok(await sms.CheckTwilioConnectionAsync(cancellationToken, accountId)))
            .RequireAuthorization(policy => policy.RequireRole("admin"));

        if (app.Environment.IsDevelopment())
        {
            app.MapPost("/api/admin/sms/twilio-magic-test", async (
                TwilioMagicTestRequest request,
                SmsDeliveryService sms,
                CancellationToken cancellationToken) =>
                Results.Ok(await sms.SendTwilioMagicTestAsync(request.From?.Trim() ?? string.Empty,
                    request.To?.Trim() ?? string.Empty, cancellationToken)))
                .RequireAuthorization(policy => policy.RequireRole("admin"))
                .RequireRateLimiting("smsMagicTest");
        }

        app.MapPost("/api/admin/sms/test-send", async (
            SmsTestSendRequest request,
            SmsDeliveryService sms,
            NpgsqlDataSource dataSource,
            CancellationToken cancellationToken) =>
        {
            if (!request.ConfirmSend || !request.RecipientConsentConfirmed)
                return Results.BadRequest(new { error = "Confirm the real send and recipient consent before texting." });
            var to = request.To?.Trim() ?? string.Empty;
            if (!Regex.IsMatch(to, @"^\+[1-9][0-9]{7,14}$"))
                return Results.BadRequest(new { error = "Enter a phone number in E.164 format, such as +15551234567." });
            var status = await sms.GetStatusAsync(cancellationToken);
            if (!status.Ready)
                return Results.Problem("SMS provider is disabled or incomplete.", statusCode: StatusCodes.Status503ServiceUnavailable);

            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using (var gate = new NpgsqlCommand("select pg_advisory_xact_lock(724104, 1)", connection, transaction))
                await gate.ExecuteNonQueryAsync(cancellationToken);
            await using (var count = new NpgsqlCommand("""
                select count(*) from sms_test_sends
                where accepted and created_at >= @dayStart and created_at < @dayEnd
                """, connection, transaction))
            {
                var todayUtc = DateTime.UtcNow.Date;
                count.Parameters.AddWithValue("dayStart", todayUtc);
                count.Parameters.AddWithValue("dayEnd", todayUtc.AddDays(1));
                if (Convert.ToInt64(await count.ExecuteScalarAsync(cancellationToken)) >= status.DailyLimit)
                    return Results.Problem("The installation-wide SMS test limit has been reached for today.", statusCode: StatusCodes.Status429TooManyRequests);
            }

            const string message = "Traccar Scope API SMS test. This is a message requested by your system administrator.";
            var result = await sms.SendAsync(to, message, cancellationToken);
            await using var audit = new NpgsqlCommand("""
                insert into sms_test_sends (provider, accepted, provider_status_code)
                values (@provider, @accepted, @statusCode)
                """, connection, transaction);
            audit.Parameters.AddWithValue("provider", status.Provider);
            audit.Parameters.AddWithValue("accepted", result.Accepted);
            audit.Parameters.AddWithValue("statusCode", (object?)result.ProviderStatusCode ?? DBNull.Value);
            await audit.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return result.Accepted
                ? Results.Ok(new { accepted = true, provider = status.Provider, providerStatusCode = result.ProviderStatusCode })
                : Results.Problem(result.Error, statusCode: StatusCodes.Status502BadGateway);
        })
            .RequireAuthorization(policy => policy.RequireRole("admin"))
            .RequireRateLimiting("smsTest");
    }
}

public sealed record SmsTestSendRequest(string? To, bool ConfirmSend, bool RecipientConsentConfirmed);
public sealed record TwilioMagicTestRequest(string? From, string? To);

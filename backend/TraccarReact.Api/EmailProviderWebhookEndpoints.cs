using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;

public static class EmailProviderWebhookEndpoints
{
    private const int MaxBodyBytes = 256 * 1024;
    private static readonly TimeSpan ResendTolerance = TimeSpan.FromMinutes(5);

    public static void MapEmailProviderWebhookEndpoints(this WebApplication app)
    {
        app.MapPost("/api/email/webhooks/resend", (HttpRequest request, IConfiguration config, NpgsqlDataSource data, ProviderAccountStore store, CancellationToken token) => ReceiveResendAsync(request, null, config, data, store, token)).AllowAnonymous();
        app.MapPost("/api/email/webhooks/resend/{accountId:guid}", (HttpRequest request, Guid accountId, IConfiguration config, NpgsqlDataSource data, ProviderAccountStore store, CancellationToken token) => ReceiveResendAsync(request, accountId, config, data, store, token)).AllowAnonymous();
        app.MapPost("/api/email/webhooks/brevo", (HttpRequest request, IConfiguration config, NpgsqlDataSource data, ProviderAccountStore store, CancellationToken token) => ReceiveBrevoAsync(request, null, config, data, store, token)).AllowAnonymous();
        app.MapPost("/api/email/webhooks/brevo/{accountId:guid}", (HttpRequest request, Guid accountId, IConfiguration config, NpgsqlDataSource data, ProviderAccountStore store, CancellationToken token) => ReceiveBrevoAsync(request, accountId, config, data, store, token)).AllowAnonymous();
    }

    private static async Task<IResult> ReceiveResendAsync(HttpRequest request, Guid? accountId, IConfiguration configuration, NpgsqlDataSource dataSource, ProviderAccountStore accounts, CancellationToken cancellationToken)
    {
        var secret = await GetWebhookSecretAsync("Resend", "WebhookSecret", accountId, configuration, accounts, cancellationToken);
        if (string.IsNullOrWhiteSpace(secret)) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        var body = await ReadBodyAsync(request, cancellationToken);
        if (body is null) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        if (!VerifyResendSignature(request, body, secret)) return Results.Unauthorized();

        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            var eventId = request.Headers["svix-id"].ToString();
            var eventType = GetString(root, "type");
            var data = root.TryGetProperty("data", out var payload) ? payload : default;
            var messageId = GetString(data, "email_id");
            var status = MapResendStatus(eventType);
            if (status is null) return Results.Ok(new { received = true, ignored = true });
            if (string.IsNullOrWhiteSpace(eventId) || string.IsNullOrWhiteSpace(messageId)) return Results.BadRequest();
            var eventAt = ParseDate(GetString(root, "created_at"));
            await PersistEventAsync(dataSource, "resend", eventId, messageId, eventType!, status, eventAt, cancellationToken);
            return Results.Ok(new { received = true });
        }
        catch (JsonException)
        {
            return Results.BadRequest();
        }
    }

    private static async Task<IResult> ReceiveBrevoAsync(HttpRequest request, Guid? accountId, IConfiguration configuration, NpgsqlDataSource dataSource, ProviderAccountStore accounts, CancellationToken cancellationToken)
    {
        var secret = await GetWebhookSecretAsync("Brevo", "WebhookToken", accountId, configuration, accounts, cancellationToken);
        if (string.IsNullOrWhiteSpace(secret)) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        if (!HasBearerToken(request, secret)) return Results.Unauthorized();
        var body = await ReadBodyAsync(request, cancellationToken);
        if (body is null) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            var events = root.ValueKind == JsonValueKind.Array ? root.EnumerateArray().ToArray() : [root];
            foreach (var item in events)
            {
                var eventType = GetString(item, "event")?.Trim();
                var messageId = GetString(item, "message-id")?.Trim();
                var status = MapBrevoStatus(eventType);
                if (status is null) continue;
                if (string.IsNullOrWhiteSpace(messageId)) return Results.BadRequest();
                var eventAt = ParseUnixTime(item, "ts_event") ?? ParseUnixTime(item, "ts_epoch");
                var eventKeyText = $"{messageId}\n{eventType}\n{eventAt?.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture) ?? GetString(item, "ts")}";
                var eventId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(eventKeyText))).ToLowerInvariant();
                await PersistEventAsync(dataSource, "brevo", eventId, messageId, eventType!, status, eventAt, cancellationToken);
            }
            return Results.Ok(new { received = true, count = events.Length });
        }
        catch (JsonException)
        {
            return Results.BadRequest();
        }
    }

    private static async Task<string?> GetWebhookSecretAsync(string provider, string secretName, Guid? accountId, IConfiguration configuration, ProviderAccountStore accounts, CancellationToken cancellationToken)
    {
        if (accountId.HasValue)
        {
            var account = await accounts.GetByIdAsync(accountId.Value, cancellationToken);
            return account is not null && account.Channel == "email" && account.Provider.Equals(provider, StringComparison.OrdinalIgnoreCase)
                ? account.Secrets.GetValueOrDefault(secretName)
                : null;
        }
        return configuration[$"TraccarReactApi:Email:{provider}:{secretName}"];
    }

    private static async Task PersistEventAsync(NpgsqlDataSource dataSource, string provider, string eventId, string messageId, string eventType, string deliveryStatus, DateTimeOffset? eventAt, CancellationToken cancellationToken)
    {
        if (eventId.Length > 512 || messageId.Length > 1024 || eventType.Length > 100)
            throw new JsonException("Provider event fields exceed allowed lengths.");
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using (var insert = new NpgsqlCommand("""
            insert into email_alert_provider_events
                (provider, provider_event_id, provider_message_id, event_type, delivery_status, provider_event_at)
            values (@provider, @eventId, @messageId, @eventType, @deliveryStatus, @eventAt)
            on conflict (provider, provider_event_id) do nothing
            """, connection))
        {
            insert.Parameters.AddWithValue("provider", provider);
            insert.Parameters.AddWithValue("eventId", eventId);
            insert.Parameters.AddWithValue("messageId", messageId);
            insert.Parameters.AddWithValue("eventType", eventType);
            insert.Parameters.AddWithValue("deliveryStatus", deliveryStatus);
            insert.Parameters.AddWithValue("eventAt", (object?)eventAt ?? DBNull.Value);
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var update = new NpgsqlCommand("""
            update email_alert_outbox o set
                delivery_status = e.delivery_status,
                delivery_updated_at = coalesce(e.provider_event_at, e.received_at)
            from (
                select distinct on (provider_message_id) provider_message_id, delivery_status, provider_event_at, received_at
                from email_alert_provider_events
                where provider = @provider and provider_message_id = @messageId
                order by provider_message_id, provider_event_at desc nulls last, received_at desc
            ) e
            where lower(o.last_provider) = @provider
              and o.provider_message_id = e.provider_message_id
              and o.status = 'accepted'
            """, connection);
        update.Parameters.AddWithValue("provider", provider);
        update.Parameters.AddWithValue("messageId", messageId);
        await update.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<byte[]?> ReadBodyAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (request.ContentLength > MaxBodyBytes) return null;
        using var stream = new MemoryStream();
        var buffer = new byte[8192];
        int read;
        while ((read = await request.Body.ReadAsync(buffer, cancellationToken)) > 0)
        {
            if (stream.Length + read > MaxBodyBytes) return null;
            stream.Write(buffer, 0, read);
        }
        return stream.ToArray();
    }

    private static bool VerifyResendSignature(HttpRequest request, byte[] body, string secret)
    {
        var id = request.Headers["svix-id"].ToString();
        var timestampText = request.Headers["svix-timestamp"].ToString();
        var signatures = request.Headers["svix-signature"].ToString();
        if (string.IsNullOrWhiteSpace(id) || !long.TryParse(timestampText, NumberStyles.None, CultureInfo.InvariantCulture, out var timestamp)) return false;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (timestamp < now - (long)ResendTolerance.TotalSeconds || timestamp > now + (long)ResendTolerance.TotalSeconds) return false;
        var encodedSecret = secret.StartsWith("whsec_", StringComparison.Ordinal) ? secret[6..] : secret;
        byte[] key;
        try { key = Convert.FromBase64String(encodedSecret); }
        catch (FormatException) { return false; }
        var prefix = Encoding.UTF8.GetBytes($"{id}.{timestampText}.");
        var signedContent = new byte[prefix.Length + body.Length];
        Buffer.BlockCopy(prefix, 0, signedContent, 0, prefix.Length);
        Buffer.BlockCopy(body, 0, signedContent, prefix.Length, body.Length);
        var expected = HMACSHA256.HashData(key, signedContent);
        foreach (var part in signatures.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var pieces = part.Split(',', 2);
            if (pieces.Length != 2 || pieces[0] != "v1") continue;
            try
            {
                var provided = Convert.FromBase64String(pieces[1]);
                if (provided.Length == expected.Length && CryptographicOperations.FixedTimeEquals(provided, expected)) return true;
            }
            catch (FormatException) { }
        }
        return false;
    }

    private static bool HasBearerToken(HttpRequest request, string secret)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return false;
        var provided = Encoding.UTF8.GetBytes(authorization[7..]);
        var expected = Encoding.UTF8.GetBytes(secret);
        return provided.Length == expected.Length && CryptographicOperations.FixedTimeEquals(provided, expected);
    }

    private static string? GetString(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static DateTimeOffset? ParseDate(string? value) => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) ? parsed : null;

    private static DateTimeOffset? ParseUnixTime(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value) || !value.TryGetInt64(out var timestamp)) return null;
        try { return name == "ts_epoch" ? DateTimeOffset.FromUnixTimeMilliseconds(timestamp) : DateTimeOffset.FromUnixTimeSeconds(timestamp); }
        catch (ArgumentOutOfRangeException) { return null; }
    }

    private static string? MapResendStatus(string? eventType) => eventType switch
    {
        "email.delivered" => "delivered",
        "email.delivery_delayed" => "delayed",
        "email.bounced" => "bounced",
        "email.complained" => "complained",
        "email.failed" => "failed",
        "email.suppressed" => "suppressed",
        _ => null,
    };

    private static string? MapBrevoStatus(string? eventType) => eventType?.Replace("_", "", StringComparison.Ordinal).Replace("-", "", StringComparison.Ordinal).ToLowerInvariant() switch
    {
        "delivered" => "delivered",
        "deferred" => "delayed",
        "softbounce" or "hardbounce" or "invalid" => "bounced",
        "spam" => "complained",
        "blocked" or "error" => "failed",
        "unsubscribed" => "suppressed",
        _ => null,
    };
}

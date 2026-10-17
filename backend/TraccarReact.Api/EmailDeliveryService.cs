using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

public sealed class EmailDeliveryService(IHttpClientFactory httpClientFactory, IConfiguration configuration, ProviderAccountStore providerAccounts)
{
    private const string Section = "TraccarReactApi:Email";

    public int GetDailyLimit() => int.TryParse(configuration[$"{Section}:DailyLimit"], out var limit)
        ? Math.Clamp(limit, 1, 10_000)
        : 75;

    public async Task<EmailConfigurationStatus> GetStatusAsync(CancellationToken cancellationToken)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken);
        return GetStatus(resolved);
    }

    public async Task<EmailConfigurationStatus> GetStatusForAccountAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken, accountId);
        return GetStatus(resolved);
    }

    public async Task<EmailConnectionCheckResult> CheckConnectionAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken, accountId);
        var status = GetStatus(resolved);
        if (!status.Ready) return new(false, string.Join(" ", status.MissingSettings));
        if (!resolved.Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase))
            return new(false, "Connection checks are currently available for Microsoft Graph accounts.");

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post,
                $"https://login.microsoftonline.com/{Uri.EscapeDataString(resolved.Get("TenantId"))}/oauth2/v2.0/token")
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["client_id"] = resolved.Get("ClientId"),
                    ["client_secret"] = resolved.Secret("ClientSecret"),
                    ["scope"] = "https://graph.microsoft.com/.default",
                    ["grant_type"] = "client_credentials",
                }),
            };
            using var response = await httpClientFactory.CreateClient(nameof(EmailDeliveryService)).SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return new(false, $"Microsoft Entra rejected the credentials (HTTP {(int)response.StatusCode}). Check the tenant, client ID, secret, and secret expiry.");
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            return document.RootElement.TryGetProperty("access_token", out var token) && !string.IsNullOrWhiteSpace(token.GetString())
                ? new(true, "Credentials authenticated with Microsoft Entra. This check does not verify Graph Mail.Send permission or the sender mailbox; use Send Test Email for that check.")
                : new(false, "Microsoft Entra returned no access token.");
        }
        catch (HttpRequestException)
        {
            return new(false, "Could not connect to Microsoft Entra.");
        }
        catch (JsonException)
        {
            return new(false, "Microsoft Entra returned an invalid response.");
        }
    }

    private static EmailConfigurationStatus GetStatus(EmailProviderConfiguration resolved)
    {
        var provider = resolved.Provider;
        if (!resolved.Enabled)
            return new EmailConfigurationStatus(provider, false, [resolved.Error ?? "Selected provider account is disabled."], resolved.Source);
        if (resolved.Error is not null)
            return new EmailConfigurationStatus(provider, false, [resolved.Error], resolved.Source);
        var requiredKeys = provider.ToLowerInvariant() switch
        {
            "graph" => new[] { "TenantId", "ClientId", "ClientSecret" },
            "resend" => new[] { "From", "ApiKey" },
            "brevo" => new[] { "FromEmail", "ApiKey" },
            _ => Array.Empty<string>(),
        };
        var missing = requiredKeys
            .Where(key => string.IsNullOrWhiteSpace(resolved.GetValueOrSecret(key)))
            .ToArray();
        var supported = provider.Equals("Graph", StringComparison.OrdinalIgnoreCase)
            || provider.Equals("Resend", StringComparison.OrdinalIgnoreCase)
            || provider.Equals("Brevo", StringComparison.OrdinalIgnoreCase);
        return new EmailConfigurationStatus(provider, resolved.Enabled && supported && missing.Length == 0, missing, resolved.Source);
    }

    public async Task<EmailDeliveryResult> SendAsync(string to, string subject, string body, CancellationToken cancellationToken, string? idempotencyKey = null, string? senderUserId = null, Guid? providerAccountId = null, IReadOnlyList<EmailAttachment>? attachments = null)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken, providerAccountId);
        var status = GetStatus(resolved);
        if (!status.Ready)
            return new EmailDeliveryResult(false, null, "Email provider is disabled or incomplete.");

        try
        {
            return status.Provider.ToLowerInvariant() switch
            {
                "graph" => string.IsNullOrWhiteSpace(senderUserId)
                    ? new EmailDeliveryResult(false, null, "A Graph sender mailbox is not configured.", "Graph settings")
                    : await SendGraphAsync(to, subject, body, senderUserId.Trim(), resolved, cancellationToken, attachments),
                "resend" => await SendResendAsync(to, subject, body, idempotencyKey, resolved, cancellationToken, attachments),
                "brevo" => await SendBrevoAsync(to, subject, body, idempotencyKey, resolved, cancellationToken, attachments),
                _ => new EmailDeliveryResult(false, null, "Unsupported email provider."),
            };
        }
        catch (HttpRequestException)
        {
            return new EmailDeliveryResult(false, null, "Email provider connection failed.", "connection");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new EmailDeliveryResult(false, null, "Email provider timed out.", "connection");
        }
        catch (JsonException)
        {
            return new EmailDeliveryResult(false, null, "Email provider returned an invalid response.", "response");
        }
    }

    private async Task<EmailProviderConfiguration> ResolveConfigurationAsync(CancellationToken cancellationToken, Guid? providerAccountId = null)
    {
        var account = providerAccountId.HasValue
            ? await providerAccounts.GetByIdAsync(providerAccountId.Value, cancellationToken)
            : await providerAccounts.GetDefaultAsync("email", cancellationToken);
        if (account is not null)
            return new EmailProviderConfiguration(account.Provider, account.Enabled, "database", account.Settings,
                account.Secrets, account.ConfigurationError);
        if (providerAccountId.HasValue)
            return new EmailProviderConfiguration("Unavailable", false, "database", new(), new(),
                "The email provider account assigned to this queued alert is unavailable. Select or restore that account before retrying.");

        var environmentValues = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["TenantId"] = configuration[$"{Section}:Graph:TenantId"],
            ["ClientId"] = configuration[$"{Section}:Graph:ClientId"],
            ["ClientSecret"] = configuration[$"{Section}:Graph:ClientSecret"],
            ["From"] = configuration[$"{Section}:Resend:From"],
            ["FromEmail"] = configuration[$"{Section}:Brevo:FromEmail"],
            ["FromName"] = configuration[$"{Section}:Brevo:FromName"],
        };
        var provider = configuration[$"{Section}:Provider"]?.Trim() ?? "Disabled";
        var environmentSecrets = provider.ToLowerInvariant() switch
        {
            "graph" => new Dictionary<string, string>(StringComparer.Ordinal) { ["ClientSecret"] = configuration[$"{Section}:Graph:ClientSecret"] ?? "" },
            "resend" => new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["ApiKey"] = configuration[$"{Section}:Resend:ApiKey"] ?? "",
                ["WebhookSecret"] = configuration[$"{Section}:Resend:WebhookSecret"] ?? "",
            },
            "brevo" => new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["ApiKey"] = configuration[$"{Section}:Brevo:ApiKey"] ?? "",
                ["WebhookToken"] = configuration[$"{Section}:Brevo:WebhookToken"] ?? "",
            },
            _ => new Dictionary<string, string>(StringComparer.Ordinal),
        };
        return new EmailProviderConfiguration(provider, true, "environment", environmentValues, environmentSecrets, null);
    }

    private async Task<EmailDeliveryResult> SendGraphAsync(string to, string subject, string body, string senderUserId, EmailProviderConfiguration resolved, CancellationToken cancellationToken, IReadOnlyList<EmailAttachment>? attachments)
    {
        var tenantId = resolved.Get("TenantId");
        var clientId = resolved.Get("ClientId");
        var clientSecret = resolved.Secret("ClientSecret");
        var client = httpClientFactory.CreateClient(nameof(EmailDeliveryService));

        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post,
            $"https://login.microsoftonline.com/{Uri.EscapeDataString(tenantId)}/oauth2/v2.0/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = clientId,
                ["client_secret"] = clientSecret,
                ["scope"] = "https://graph.microsoft.com/.default",
                ["grant_type"] = "client_credentials",
            }),
        };
        using var tokenResponse = await client.SendAsync(tokenRequest, cancellationToken);
        if (!tokenResponse.IsSuccessStatusCode)
            return Failure(tokenResponse, "Graph token");
        using var tokenJson = JsonDocument.Parse(await tokenResponse.Content.ReadAsStringAsync(cancellationToken));
        if (!tokenJson.RootElement.TryGetProperty("access_token", out var tokenElement)
            || string.IsNullOrWhiteSpace(tokenElement.GetString()))
            return new EmailDeliveryResult(false, null, "Microsoft Graph token response was invalid.", "Graph token");

        using var sendRequest = new HttpRequestMessage(HttpMethod.Post,
            $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(senderUserId)}/sendMail");
        sendRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenElement.GetString());
        var message = new Dictionary<string, object>
        {
            ["subject"] = subject,
            ["body"] = new { contentType = "Text", content = body },
            ["toRecipients"] = new[] { new { emailAddress = new { address = to } } },
        };
        if (attachments is { Count: > 0 })
            message["attachments"] = attachments.Select(attachment => new Dictionary<string, string>
            {
                ["@odata.type"] = "#microsoft.graph.fileAttachment",
                ["name"] = attachment.FileName,
                ["contentType"] = attachment.ContentType,
                ["contentBytes"] = Convert.ToBase64String(attachment.Content),
            }).ToArray();
        sendRequest.Content = JsonContent.Create(new { message });
        using var sendResponse = await client.SendAsync(sendRequest, cancellationToken);
        return sendResponse.IsSuccessStatusCode
            ? new EmailDeliveryResult(true, (int)sendResponse.StatusCode, null, "Graph sendMail")
            : Failure(sendResponse, "Graph sendMail");
    }

    private async Task<EmailDeliveryResult> SendResendAsync(string to, string subject, string body, string? idempotencyKey, EmailProviderConfiguration resolved, CancellationToken cancellationToken, IReadOnlyList<EmailAttachment>? attachments)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", resolved.Secret("ApiKey"));
        if (!string.IsNullOrWhiteSpace(idempotencyKey)) request.Headers.Add("Idempotency-Key", idempotencyKey);
        var payload = new Dictionary<string, object>
        {
            ["from"] = resolved.Get("From"),
            ["to"] = new[] { to },
            ["subject"] = subject,
            ["text"] = body,
        };
        if (attachments is { Count: > 0 })
            payload["attachments"] = attachments.Select(attachment => new Dictionary<string, string>
            {
                ["filename"] = attachment.FileName,
                ["content"] = Convert.ToBase64String(attachment.Content),
                ["content_type"] = attachment.ContentType,
            }).ToArray();
        request.Content = JsonContent.Create(payload);
        using var response = await httpClientFactory.CreateClient(nameof(EmailDeliveryService)).SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) return Failure(response, "Resend send");
        var messageId = await ReadMessageIdAsync(response, "id", cancellationToken);
        return new EmailDeliveryResult(true, (int)response.StatusCode, null, "Resend send", messageId);
    }

    private async Task<EmailDeliveryResult> SendBrevoAsync(string to, string subject, string body, string? idempotencyKey, EmailProviderConfiguration resolved, CancellationToken cancellationToken, IReadOnlyList<EmailAttachment>? attachments)
    {
        var sender = new Dictionary<string, string> { ["email"] = resolved.Get("FromEmail") };
        var fromName = resolved.Get("FromName");
        if (!string.IsNullOrWhiteSpace(fromName)) sender["name"] = fromName;
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.brevo.com/v3/smtp/email");
        request.Headers.Add("api-key", resolved.Secret("ApiKey"));
        var payload = new Dictionary<string, object>
        {
            ["sender"] = sender,
            ["to"] = new[] { new { email = to } },
            ["subject"] = subject,
            ["textContent"] = body,
        };
        if (!string.IsNullOrWhiteSpace(idempotencyKey))
            payload["headers"] = new Dictionary<string, string> { ["Idempotency-Key"] = idempotencyKey };
        if (attachments is { Count: > 0 })
            payload["attachment"] = attachments.Select(attachment => new Dictionary<string, string>
            {
                ["name"] = attachment.FileName,
                ["content"] = Convert.ToBase64String(attachment.Content),
            }).ToArray();
        request.Content = JsonContent.Create(payload);
        using var response = await httpClientFactory.CreateClient(nameof(EmailDeliveryService)).SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) return Failure(response, "Brevo send");
        var messageId = await ReadMessageIdAsync(response, "messageId", cancellationToken);
        return new EmailDeliveryResult(true, (int)response.StatusCode, null, "Brevo send", messageId);
    }

    private static async Task<string?> ReadMessageIdAsync(HttpResponseMessage response, string propertyName, CancellationToken cancellationToken)
    {
        try
        {
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            return json.RootElement.TryGetProperty(propertyName, out var value) ? value.GetString() : null;
        }
        catch (JsonException)
        {
            // Provider acceptance is authoritative; a missing/unreadable ID only disables delivery receipts.
            return null;
        }
    }

    private static EmailDeliveryResult Failure(HttpResponseMessage response, string stage) =>
        new(false, (int)response.StatusCode,
            $"{stage} failed (HTTP {(int)response.StatusCode}). Check provider credentials, permissions, and sender setup.", stage);
}

public sealed record EmailConfigurationStatus(string Provider, bool Ready, IReadOnlyList<string> MissingSettings, string Source = "environment");
public sealed record EmailConnectionCheckResult(bool Success, string Message);
public sealed record EmailDeliveryResult(bool Accepted, int? ProviderStatusCode, string? Error, string? Stage = null, string? ProviderMessageId = null);
public sealed record EmailAttachment(string FileName, string ContentType, byte[] Content);

public sealed record EmailProviderConfiguration(string Provider, bool Enabled, string Source,
    Dictionary<string, string?> Settings, Dictionary<string, string> Secrets, string? Error)
{
    public string Get(string key) => Settings.TryGetValue(key, out var value) ? value?.Trim() ?? "" : "";
    public string Secret(string key) => Secrets.TryGetValue(key, out var value) ? value.Trim() : "";
    public string GetValueOrSecret(string key) => Secrets.ContainsKey(key) ? Secret(key) : Get(key);
}

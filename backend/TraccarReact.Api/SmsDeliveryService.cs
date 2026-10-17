using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public sealed class SmsDeliveryService(IHttpClientFactory httpClientFactory, IConfiguration configuration, ProviderAccountStore providerAccounts)
{
    private const string Section = "TraccarReactApi:Sms";

    public int GetDailyLimit() => int.TryParse(configuration[$"{Section}:DailyLimit"], out var limit)
        ? Math.Clamp(limit, 1, 50)
        : 1;

    public int GetAlertDailyLimit() => int.TryParse(configuration[$"{Section}:AlertDailyLimit"], out var limit)
        ? Math.Clamp(limit, 1, 500)
        : 25;

    public async Task<SmsConfigurationStatus> GetStatusAsync(CancellationToken cancellationToken)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken);
        return GetStatus(resolved);
    }

    public async Task<SmsConfigurationStatus> GetStatusForAccountAsync(Guid accountId, CancellationToken cancellationToken) =>
        GetStatus(await ResolveConfigurationAsync(cancellationToken, accountId));

    private SmsConfigurationStatus GetStatus(SmsProviderConfiguration resolved)
    {
        var provider = resolved.Provider;
        var required = provider.ToLowerInvariant() switch
        {
            "textbelt" => new[] { "ApiKey" },
            "twilio" => new[] { "AccountSid", "ApiKeySid", "ApiKeySecret", "FromNumber" },
            _ => Array.Empty<string>(),
        };
        var missing = required.Where(key => string.IsNullOrWhiteSpace(resolved.GetValue(key))).ToList();
        var supported = provider.Equals("Textbelt", StringComparison.OrdinalIgnoreCase)
            || provider.Equals("Twilio", StringComparison.OrdinalIgnoreCase);
        var automaticMissing = new List<string>();
        if (!provider.Equals("Twilio", StringComparison.OrdinalIgnoreCase)) automaticMissing.Add("Twilio provider");
        var webhookBaseConfigured = !string.IsNullOrWhiteSpace(resolved.Get("WebhookBaseUrl"));
        if (!webhookBaseConfigured) automaticMissing.Add("Twilio:WebhookBaseUrl");
        if (string.IsNullOrWhiteSpace(resolved.Get("WebhookUsername"))) automaticMissing.Add("Twilio:WebhookUsername");
        if (string.IsNullOrWhiteSpace(resolved.Secret("WebhookPassword"))) automaticMissing.Add("Twilio:WebhookPassword");
        if (webhookBaseConfigured && !TryGetWebhookBase(resolved, out _)) automaticMissing.Add("Twilio:WebhookBaseUrl (must be HTTPS)");
        if (!resolved.Enabled)
        {
            missing.Add("Selected provider account is disabled");
            automaticMissing.Add("Selected provider account is disabled");
        }
        if (resolved.ConfigurationError is not null)
        {
            missing = [resolved.ConfigurationError];
            automaticMissing.Add(resolved.ConfigurationError);
        }
        return new SmsConfigurationStatus(provider, resolved.Enabled && resolved.ConfigurationError is null && supported && missing.Count == 0, missing, GetDailyLimit(),
            resolved.Enabled && resolved.ConfigurationError is null && provider.Equals("Twilio", StringComparison.OrdinalIgnoreCase) && missing.Count == 0 && automaticMissing.Count == 0,
            automaticMissing.Distinct(StringComparer.Ordinal).ToArray(), resolved.Source);
    }

    public async Task<bool> AuthenticateWebhookAsync(string? authorizationHeader, Guid? accountId, CancellationToken cancellationToken)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken, accountId, environmentOnly: !accountId.HasValue);
        if (!resolved.Provider.Equals("Twilio", StringComparison.OrdinalIgnoreCase)) return false;
        var expectedUser = resolved.Get("WebhookUsername");
        var expectedPassword = resolved.Secret("WebhookPassword");
        if (expectedUser.Length == 0 || expectedPassword.Length == 0 || string.IsNullOrWhiteSpace(authorizationHeader)
            || !authorizationHeader.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase)) return false;
        try
        {
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(authorizationHeader[6..]));
            var separator = decoded.IndexOf(':');
            if (separator < 0) return false;
            var user = Encoding.UTF8.GetBytes(expectedUser);
            var password = Encoding.UTF8.GetBytes(expectedPassword);
            var suppliedUser = Encoding.UTF8.GetBytes(decoded[..separator]);
            var suppliedPassword = Encoding.UTF8.GetBytes(decoded[(separator + 1)..]);
            return user.Length == suppliedUser.Length && password.Length == suppliedPassword.Length
                && CryptographicOperations.FixedTimeEquals(user, suppliedUser)
                && CryptographicOperations.FixedTimeEquals(password, suppliedPassword);
        }
        catch (FormatException) { return false; }
    }

    public async Task<bool> IsTwilioDestinationAsync(string to, Guid? accountId, CancellationToken cancellationToken)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken, accountId, environmentOnly: !accountId.HasValue);
        return resolved.Provider.Equals("Twilio", StringComparison.OrdinalIgnoreCase)
            && string.Equals(resolved.Get("FromNumber"), to, StringComparison.Ordinal);
    }

    private async Task<SmsProviderConfiguration> ResolveConfigurationAsync(CancellationToken cancellationToken, Guid? accountId = null, bool environmentOnly = false)
    {
        var account = environmentOnly ? null : accountId.HasValue
            ? await providerAccounts.GetByIdAsync(accountId.Value, cancellationToken)
            : await providerAccounts.GetDefaultAsync("sms", cancellationToken);
        if (account is not null)
            return new SmsProviderConfiguration(account.Id, account.Provider, account.Enabled, account.Settings, account.Secrets, account.ConfigurationError, "database");
        if (accountId.HasValue)
            return new SmsProviderConfiguration(accountId, "Unavailable", false, new(), new(), "The SMS provider account assigned to this queued alert is unavailable.", "database");

        var provider = configuration[$"{Section}:Provider"]?.Trim() ?? "Disabled";
        var settings = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["AccountSid"] = configuration[$"{Section}:Twilio:AccountSid"],
            ["ApiKeySid"] = configuration[$"{Section}:Twilio:ApiKeySid"],
            ["FromNumber"] = configuration[$"{Section}:Twilio:FromNumber"],
            ["WebhookBaseUrl"] = configuration[$"{Section}:Twilio:WebhookBaseUrl"],
            ["WebhookUsername"] = configuration[$"{Section}:Twilio:WebhookUsername"],
            ["TestAccountSid"] = configuration[$"{Section}:Twilio:TestAccountSid"],
        };
        var secrets = provider.ToLowerInvariant() switch
        {
            "twilio" => new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["ApiKeySecret"] = configuration[$"{Section}:Twilio:ApiKeySecret"] ?? "",
                ["WebhookPassword"] = configuration[$"{Section}:Twilio:WebhookPassword"] ?? "",
                ["TestAuthToken"] = configuration[$"{Section}:Twilio:TestAuthToken"] ?? "",
            },
            "textbelt" => new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["ApiKey"] = configuration[$"{Section}:Textbelt:ApiKey"] ?? "" },
            _ => new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase),
        };
        return new SmsProviderConfiguration(null, provider, true, settings, secrets, null);
    }

    public async Task<TwilioConnectionCheck> CheckTwilioConnectionAsync(CancellationToken cancellationToken, Guid? accountId = null)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken, accountId);
        var status = GetStatus(resolved);
        if (!status.Provider.Equals("Twilio", StringComparison.OrdinalIgnoreCase) || !status.Ready)
            return new TwilioConnectionCheck(false, null, null, "Twilio is not selected or its required settings are incomplete.");

        var accountSid = resolved.Get("AccountSid");
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"https://api.twilio.com/2010-04-01/Accounts/{Uri.EscapeDataString(accountSid)}.json");
        var credentials = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{resolved.Get("ApiKeySid")}:{resolved.Secret("ApiKeySecret")}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);

        try
        {
            using var response = await httpClientFactory.CreateClient(nameof(SmsDeliveryService)).SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return new TwilioConnectionCheck(false, (int)response.StatusCode, null,
                    response.StatusCode == System.Net.HttpStatusCode.Unauthorized
                        ? "Twilio rejected the API key credentials."
                        : response.StatusCode == System.Net.HttpStatusCode.Forbidden
                            ? "Twilio authenticated the request but denied account access; check API key permissions."
                            : "Twilio account check failed.");

            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var accountStatus = json.RootElement.TryGetProperty("status", out var value) ? value.GetString() : null;
            return new TwilioConnectionCheck(true, (int)response.StatusCode, accountStatus, null);
        }
        catch (HttpRequestException)
        {
            return new TwilioConnectionCheck(false, null, null, "Could not connect to Twilio.");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new TwilioConnectionCheck(false, null, null, "Twilio account check timed out.");
        }
        catch (JsonException)
        {
            return new TwilioConnectionCheck(false, null, null, "Twilio returned an invalid account response.");
        }
    }

    public async Task<string?> GetTwilioStatusCallbackUrlAsync(CancellationToken cancellationToken, Guid? accountId = null) =>
        BuildTwilioWebhookUrl("status", await ResolveConfigurationAsync(cancellationToken, accountId));
    public async Task<string?> GetTwilioInboundWebhookUrlAsync(CancellationToken cancellationToken, Guid? accountId = null) =>
        BuildTwilioWebhookUrl("inbound", await ResolveConfigurationAsync(cancellationToken, accountId));

    public async Task<TwilioMagicTestResult> SendTwilioMagicTestAsync(string from, string to, CancellationToken cancellationToken, Guid? accountId = null)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken, accountId);
        var testAccountSid = resolved.Get("TestAccountSid");
        var testAuthToken = resolved.Secret("TestAuthToken");
        if (string.IsNullOrWhiteSpace(testAccountSid) || string.IsNullOrWhiteSpace(testAuthToken))
            return new TwilioMagicTestResult(false, null, null, null, null, "Twilio test credentials are not configured.");

        var allowedFrom = new HashSet<string>(StringComparer.Ordinal)
        {
            "+15005550001", "+15005550006", "+15005550007", "+15005550008",
        };
        var allowedTo = new HashSet<string>(StringComparer.Ordinal)
        {
            "+15005550001", "+15005550002", "+15005550003", "+15005550004", "+15005550006", "+15005550009",
            "+5571981265131",
        };
        if (!allowedFrom.Contains(from) || !allowedTo.Contains(to))
            return new TwilioMagicTestResult(false, null, null, null, null, "Use only documented Twilio SMS magic numbers for From and To.");

        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://api.twilio.com/2010-04-01/Accounts/{Uri.EscapeDataString(testAccountSid)}/Messages.json")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["To"] = to,
                ["From"] = from,
                ["Body"] = "Traccar React API Twilio magic-number API test.",
            }),
        };
        var credentials = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{testAccountSid}:{testAuthToken}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);

        try
        {
            using var response = await httpClientFactory.CreateClient(nameof(SmsDeliveryService)).SendAsync(request, cancellationToken);
            var payload = await response.Content.ReadAsStringAsync(cancellationToken);
            using var json = JsonDocument.Parse(payload);
            var root = json.RootElement;
            int? errorCode = root.TryGetProperty("code", out var code) && code.TryGetInt32(out var parsedCode) ? parsedCode : null;
            var message = root.TryGetProperty("message", out var messageValue) && messageValue.ValueKind == JsonValueKind.String
                ? messageValue.GetString() : null;
            var sid = root.TryGetProperty("sid", out var sidValue) && sidValue.ValueKind == JsonValueKind.String
                ? sidValue.GetString() : null;
            var status = root.TryGetProperty("status", out var statusValue) && statusValue.ValueKind == JsonValueKind.String
                ? statusValue.GetString() : null;
            return new TwilioMagicTestResult(response.IsSuccessStatusCode, (int)response.StatusCode, errorCode, sid, status, message);
        }
        catch (HttpRequestException)
        {
            return new TwilioMagicTestResult(false, null, null, null, null, "Could not connect to Twilio.");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new TwilioMagicTestResult(false, null, null, null, null, "Twilio magic-number test timed out.");
        }
        catch (JsonException)
        {
            return new TwilioMagicTestResult(false, null, null, null, null, "Twilio returned an invalid test response.");
        }
    }

    public async Task<SmsDeliveryResult> SendAsync(string to, string body, CancellationToken cancellationToken, string? statusCallbackUrl = null, Guid? providerAccountId = null)
    {
        var resolved = await ResolveConfigurationAsync(cancellationToken, providerAccountId);
        var status = GetStatus(resolved);
        if (!status.Ready || resolved.ConfigurationError is not null) return new SmsDeliveryResult(false, null, resolved.ConfigurationError ?? "SMS provider is disabled or incomplete.");
        try
        {
            return status.Provider.Equals("Textbelt", StringComparison.OrdinalIgnoreCase)
                ? await SendTextbeltAsync(to, body, cancellationToken, resolved)
                : await SendTwilioAsync(to, body, cancellationToken, statusCallbackUrl, resolved);
        }
        catch (HttpRequestException)
        {
            return new SmsDeliveryResult(false, null, "SMS provider connection failed.");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new SmsDeliveryResult(false, null, "SMS provider timed out.");
        }
        catch (JsonException)
        {
            return new SmsDeliveryResult(false, null, "SMS provider returned an invalid response.");
        }
    }

    private async Task<SmsDeliveryResult> SendTextbeltAsync(string to, string body, CancellationToken cancellationToken, SmsProviderConfiguration resolved)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://textbelt.com/text")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["phone"] = to,
                ["message"] = body,
                ["key"] = resolved.Secret("ApiKey"),
            }),
        };
        using var response = await httpClientFactory.CreateClient(nameof(SmsDeliveryService)).SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
            return new SmsDeliveryResult(false, (int)response.StatusCode, $"Textbelt rejected the request (HTTP {(int)response.StatusCode}).");
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        if (json.RootElement.TryGetProperty("success", out var success) && success.ValueKind == JsonValueKind.True)
            return new SmsDeliveryResult(true, (int)response.StatusCode, null);
        var quotaExceeded = json.RootElement.TryGetProperty("quotaRemaining", out var quota)
            && quota.ValueKind == JsonValueKind.Number && quota.GetInt32() == 0;
        return new SmsDeliveryResult(false, (int)response.StatusCode,
            quotaExceeded ? "Textbelt quota is exhausted." : "Textbelt did not accept the message. Check the key and recipient.");
    }

    private async Task<SmsDeliveryResult> SendTwilioAsync(string to, string body, CancellationToken cancellationToken, string? statusCallbackUrl, SmsProviderConfiguration resolved)
    {
        var accountSid = resolved.Get("AccountSid");
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://api.twilio.com/2010-04-01/Accounts/{Uri.EscapeDataString(accountSid)}/Messages.json");
        var credentials = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{resolved.Get("ApiKeySid")}:{resolved.Secret("ApiKeySecret")}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        var form = new Dictionary<string, string>
        {
            ["To"] = to,
            ["From"] = resolved.Get("FromNumber"),
            ["Body"] = body,
        };
        if (!string.IsNullOrWhiteSpace(statusCallbackUrl)) form["StatusCallback"] = statusCallbackUrl;
        request.Content = new FormUrlEncodedContent(form);
        using var response = await httpClientFactory.CreateClient(nameof(SmsDeliveryService)).SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
            return new SmsDeliveryResult(false, (int)response.StatusCode,
                $"Twilio rejected the request (HTTP {(int)response.StatusCode}). Check account setup and messaging registration.");
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var messageSid = json.RootElement.TryGetProperty("sid", out var sid) ? sid.GetString() : null;
        var messageStatus = json.RootElement.TryGetProperty("status", out var status) ? status.GetString() : "queued";
        return new SmsDeliveryResult(true, (int)response.StatusCode, null, messageSid, messageStatus);
    }

    private string? BuildTwilioWebhookUrl(string endpoint, SmsProviderConfiguration resolved)
    {
        if (!TryGetWebhookBase(resolved, out var baseUri)) return null;
        var builder = new UriBuilder(baseUri)
        {
            Path = $"{baseUri.AbsolutePath.TrimEnd('/')}/api/sms/webhooks/twilio/{(resolved.Id.HasValue ? $"{resolved.Id.Value:D}/" : string.Empty)}{endpoint}",
            UserName = resolved.Get("WebhookUsername"),
            Password = resolved.Secret("WebhookPassword"),
        };
        return builder.Uri.AbsoluteUri;
    }

    private static bool TryGetWebhookBase(SmsProviderConfiguration resolved, out Uri baseUri)
    {
        var value = resolved.Get("WebhookBaseUrl");
        if (Uri.TryCreate(value, UriKind.Absolute, out var parsed) && parsed.Scheme == Uri.UriSchemeHttps)
        {
            baseUri = parsed;
            return true;
        }
        baseUri = new Uri("https://invalid.local");
        return false;
    }

}

public sealed record SmsConfigurationStatus(string Provider, bool Ready, IReadOnlyList<string> MissingSettings, int DailyLimit, bool AutomaticAlertsReady, IReadOnlyList<string> AutomaticAlertsMissingSettings, string ConfigurationSource = "environment");
public sealed record SmsDeliveryResult(bool Accepted, int? ProviderStatusCode, string? Error, string? ProviderMessageId = null, string? InitialStatus = null);
public sealed record TwilioConnectionCheck(bool Authenticated, int? HttpStatusCode, string? AccountStatus, string? Error);
public sealed record TwilioMagicTestResult(bool Accepted, int? HttpStatusCode, int? TwilioErrorCode, string? MessageSid, string? MessageStatus, string? Message);

public sealed record SmsProviderConfiguration(Guid? Id, string Provider, bool Enabled, Dictionary<string, string?> Settings,
    Dictionary<string, string> Secrets, string? ConfigurationError, string Source = "environment")
{
    public string Get(string key) => Settings.TryGetValue(key, out var value) ? value?.Trim() ?? "" : "";
    public string Secret(string key) => Secrets.TryGetValue(key, out var value) ? value.Trim() : "";
    public string GetValue(string key) => Secrets.ContainsKey(key) ? Secret(key) : Get(key);
}

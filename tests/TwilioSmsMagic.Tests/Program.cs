global using Microsoft.Extensions.Configuration;
using System.Net;
using System.Net.Http.Headers;

var testAccountSid = "AC_TEST_ACCOUNT";
var testAuthToken = "TEST_AUTH_TOKEN";
var handler = new MagicNumberResponseHandler();
var accounts = new ProviderAccountStore
{
    DefaultAccount = new ResolvedProviderAccount(Guid.NewGuid(), "sms", "Twilio", "Test Twilio", true,
        new() { ["TestAccountSid"] = testAccountSid }, 1,
        new() { ["TestAuthToken"] = testAuthToken }, null),
};
var service = new SmsDeliveryService(new SingleClientFactory(handler), new ConfigurationBuilder().Build(), accounts);

var validTo = "+5571981265131";
var cases = new (string Name, string From, string To, int ExpectedHttp, int? ExpectedErrorCode)[]
{
    ("valid From", "+15005550006", validTo, 201, null),
    ("invalid From", "+15005550001", validTo, 400, 21212),
    ("From not owned / not SMS capable", "+15005550007", validTo, 400, 21606),
    ("From queue full", "+15005550008", validTo, 400, 21611),
    ("invalid To", "+15005550006", "+15005550001", 400, 21211),
    ("unroutable To", "+15005550006", "+15005550002", 400, 21612),
    ("international permission To", "+15005550006", "+15005550003", 400, 21408),
    ("blocked To", "+15005550006", "+15005550004", 400, 21610),
    ("To cannot receive SMS", "+15005550006", "+15005550009", 400, 21614),
};

var passed = 0;
foreach (var test in cases)
{
    handler.NextCase = test;
    var result = await service.SendTwilioMagicTestAsync(test.From, test.To, CancellationToken.None);
    var request = handler.LastRequest ?? throw new Exception($"FAIL {test.Name}: no HTTP request was captured.");
    var auth = request.Authorization?.Parameter is { } parameter
        ? System.Text.Encoding.ASCII.GetString(Convert.FromBase64String(parameter))
        : null;
    var requestValid = request.Method == HttpMethod.Post
        && request.Uri == $"https://api.twilio.com/2010-04-01/Accounts/{testAccountSid}/Messages.json"
        && auth == $"{testAccountSid}:{testAuthToken}"
        && request.Form.Contains($"To={Uri.EscapeDataString(test.To)}", StringComparison.Ordinal)
        && request.Form.Contains($"From={Uri.EscapeDataString(test.From)}", StringComparison.Ordinal)
        && request.Form.Contains("Body=Traccar+Scope+API+Twilio+magic-number+API+test.", StringComparison.Ordinal);
    var resultValid = result.Accepted == (test.ExpectedHttp == 201)
        && result.HttpStatusCode == test.ExpectedHttp
        && result.TwilioErrorCode == test.ExpectedErrorCode
        && (test.ExpectedErrorCode is not null || result.MessageSid == "SM_TEST_MESSAGE");

    if (!requestValid || !resultValid)
        throw new Exception($"FAIL {test.Name}: outgoing request or mapped response did not match expectations.");

    Console.WriteLine($"PASS {test.Name}: mocked Twilio HTTP {result.HttpStatusCode}, error {result.TwilioErrorCode}");
    passed++;
}

var requestsBeforeRejectedInput = handler.RequestCount;
var rejected = await service.SendTwilioMagicTestAsync("+14155550100", validTo, CancellationToken.None);
if (rejected.HttpStatusCode is not null || handler.RequestCount != requestsBeforeRejectedInput)
    throw new Exception("FAIL rejects non-magic inputs before contacting Twilio.");
Console.WriteLine("PASS rejects non-magic inputs before contacting Twilio");
passed++;

// Retired environment configuration must never activate sending or webhook authentication.
var retired = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
{
    ["TraccarScopeApi:Sms:Provider"] = "Twilio",
    ["TraccarScopeApi:Sms:Twilio:AccountSid"] = "OLD_ACCOUNT",
    ["TraccarScopeApi:Sms:Twilio:ApiKeySid"] = "OLD_KEY",
    ["TraccarScopeApi:Sms:Twilio:ApiKeySecret"] = "OLD_SECRET",
    ["TraccarScopeApi:Sms:Twilio:FromNumber"] = "+15005550006",
    ["TraccarScopeApi:Sms:Twilio:TestAccountSid"] = "OLD_TEST",
    ["TraccarScopeApi:Sms:Twilio:TestAuthToken"] = "OLD_TOKEN",
    ["TraccarScopeApi:Sms:Twilio:WebhookUsername"] = "old",
    ["TraccarScopeApi:Sms:Twilio:WebhookPassword"] = "old",
    ["TraccarScopeApi:Email:Provider"] = "Graph",
    ["TraccarScopeApi:Email:Graph:TenantId"] = "OLD_TENANT",
    ["TraccarScopeApi:Email:Graph:ClientId"] = "OLD_CLIENT",
    ["TraccarScopeApi:Email:Graph:ClientSecret"] = "OLD_SECRET",
    ["TraccarScopeApi:Email:DailyLimit"] = "123",
    ["TraccarScopeApi:Sms:DailyLimit"] = "2",
    ["TraccarScopeApi:Sms:AlertDailyLimit"] = "30",
}).Build();
var emptyAccounts = new ProviderAccountStore();
var sms = new SmsDeliveryService(new SingleClientFactory(handler), retired, emptyAccounts);
var email = new EmailDeliveryService(new SingleClientFactory(handler), retired, emptyAccounts);
var requestsBeforeFallbackChecks = handler.RequestCount;
if ((await sms.GetStatusAsync(CancellationToken.None)).Ready
    || (await email.GetStatusAsync(CancellationToken.None)).Ready
    || (await sms.SendTwilioMagicTestAsync("+15005550006", validTo, CancellationToken.None)).Accepted
    || (await email.SendAsync("test@example.com", "Test", "Test", CancellationToken.None, senderUserId: "test@example.com")).Accepted
    || await sms.AuthenticateWebhookAsync("Basic b2xkOm9sZA==", null, CancellationToken.None)
    || handler.RequestCount != requestsBeforeFallbackChecks)
    throw new Exception("FAIL retired environment credentials must not enable delivery or webhook authentication.");
if (email.GetDailyLimit() != 123 || sms.GetDailyLimit() != 2 || sms.GetAlertDailyLimit() != 30)
    throw new Exception("FAIL server delivery limits must remain configurable.");
Console.WriteLine("PASS retired environment credentials ignored; server limits retained");
passed++;

// Saved account selection must not fall back when the requested account is missing or disabled.
accounts.DefaultAccount = accounts.DefaultAccount! with
{
    Settings = new() { ["AccountSid"] = "SAVED", ["ApiKeySid"] = "SAVED", ["FromNumber"] = "+15005550006",
        ["WebhookBaseUrl"] = "https://example.com/traccar-scope-api", ["WebhookUsername"] = "saved" },
    Secrets = new() { ["ApiKeySecret"] = "SAVED", ["WebhookPassword"] = "secret" },
};
var savedStatus = await service.GetStatusAsync(CancellationToken.None);
var callback = await service.GetTwilioStatusCallbackUrlAsync(CancellationToken.None);
if (!savedStatus.Ready || savedStatus.ConfigurationSource != "database"
    || callback is null || !callback.Contains($"/twilio/{accounts.DefaultAccount.Id:D}/status")
    || !await service.AuthenticateWebhookAsync("Basic c2F2ZWQ6c2VjcmV0", accounts.DefaultAccount.Id, CancellationToken.None)
    || await service.AuthenticateWebhookAsync("Basic c2F2ZWQ6c2VjcmV0", Guid.NewGuid(), CancellationToken.None)
    || (await service.GetStatusForAccountAsync(Guid.NewGuid(), CancellationToken.None)).Ready)
    throw new Exception("FAIL saved SMS account selection or webhook identity.");
accounts.DefaultAccount = accounts.DefaultAccount with { Enabled = false };
if ((await service.GetStatusAsync(CancellationToken.None)).Ready)
    throw new Exception("FAIL disabled SMS account must remain disabled.");
Console.WriteLine("PASS saved SMS account and webhook selection; missing/disabled accounts fail closed");
passed++;

var emailAccounts = new ProviderAccountStore
{
    DefaultAccount = new ResolvedProviderAccount(Guid.NewGuid(), "email", "Graph", "Saved Graph", true,
        new() { ["TenantId"] = "SAVED_TENANT", ["ClientId"] = "SAVED_CLIENT" }, 1,
        new() { ["ClientSecret"] = "SAVED_SECRET" }, null),
};
var savedEmail = new EmailDeliveryService(new SingleClientFactory(handler), retired, emailAccounts);
if (!(await savedEmail.GetStatusAsync(CancellationToken.None)).Ready
    || (await savedEmail.GetStatusForAccountAsync(Guid.NewGuid(), CancellationToken.None)).Ready)
    throw new Exception("FAIL saved email account selection.");
emailAccounts.DefaultAccount = emailAccounts.DefaultAccount with { Enabled = false };
if ((await savedEmail.GetStatusAsync(CancellationToken.None)).Ready)
    throw new Exception("FAIL disabled email account must remain disabled.");
Console.WriteLine("PASS saved email account selection; missing/disabled accounts fail closed");
passed++;

Console.WriteLine($"All {passed} local Twilio API service checks passed. These checks used mocked HTTP responses; no network request was made.");

sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
{
    private readonly HttpClient _client = new(handler, disposeHandler: false);
    public HttpClient CreateClient(string name) => _client;
}

sealed class MagicNumberResponseHandler : HttpMessageHandler
{
    public (string Name, string From, string To, int ExpectedHttp, int? ExpectedErrorCode)? NextCase { get; set; }
    public CapturedRequest? LastRequest { get; private set; }
    public int RequestCount { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        RequestCount++;
        var form = await request.Content!.ReadAsStringAsync(cancellationToken);
        LastRequest = new CapturedRequest(request.Method, request.RequestUri!.AbsoluteUri,
            request.Headers.Authorization, form);
        var current = NextCase ?? throw new InvalidOperationException("No mock case was selected.");
        var successful = current.ExpectedHttp == 201;
        var json = successful
            ? "{\"sid\":\"SM_TEST_MESSAGE\",\"status\":\"queued\"}"
            : $"{{\"code\":{current.ExpectedErrorCode},\"message\":\"Mock Twilio error\",\"status\":400}}";
        return new HttpResponseMessage((HttpStatusCode)current.ExpectedHttp)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
        };
    }
}

sealed record CapturedRequest(HttpMethod Method, string Uri, AuthenticationHeaderValue? Authorization, string Form);

public sealed class ProviderAccountStore
{
    public ResolvedProviderAccount? DefaultAccount { get; set; }
    public Task<ResolvedProviderAccount?> GetDefaultAsync(string channel, CancellationToken cancellationToken) =>
        Task.FromResult(DefaultAccount?.Channel == channel ? DefaultAccount : null);
    public Task<ResolvedProviderAccount?> GetByIdAsync(Guid accountId, CancellationToken cancellationToken) =>
        Task.FromResult(DefaultAccount?.Id == accountId ? DefaultAccount : null);
}

public sealed record ResolvedProviderAccount(
    Guid Id,
    string Channel,
    string Provider,
    string Name,
    bool Enabled,
    Dictionary<string, string?> Settings,
    int Revision,
    Dictionary<string, string> Secrets,
    string? ConfigurationError);

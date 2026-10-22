using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

// Isolated real HTTP/cookie middleware; no database, real accounts, or development bypass.
var clock = new SessionClock(new DateTimeOffset(2026, 10, 21, 12, 0, 0, TimeSpan.Zero));
var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [], EnvironmentName = "Testing" });
builder.Logging.ClearProviders();
builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));
builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        TraccarScopeCookieAuthentication.Configure(options);
        options.TimeProvider = clock;
    });
builder.Services.AddAuthorization();
await using var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapPost("/test-session", async (HttpContext context) =>
{
    var identity = new ClaimsIdentity([
        new Claim(ClaimTypes.Name, "disposable-session-fixture"),
        new Claim(ClaimTypes.Role, "regular")
    ], CookieAuthenticationDefaults.AuthenticationScheme);
    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
    return Results.NoContent();
});
app.MapGet("/protected", () => Results.Ok(new { permitted = true })).RequireAuthorization();
app.MapGet("/admin", () => Results.Ok(new { administrator = true }))
    .RequireAuthorization(policy => policy.RequireRole("admin"));
await app.StartAsync();
try
{
    using var handler = new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false };
    using var client = new HttpClient(handler) { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(10) };
    var options = app.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
        .Get(CookieAuthenticationDefaults.AuthenticationScheme);
    var lifetime = options.ExpireTimeSpan;
    Check("configured session lifetime is positive", lifetime > TimeSpan.Zero);
    Check("existing sliding renewal stays enabled", options.SlidingExpiration);

    using (var anonymous = await Send("/protected"))
        CheckStatus("anonymous access returns 401 without redirect", anonymous, HttpStatusCode.Unauthorized);
    var originalCookie = await SignIn();
    using (var valid = await Send("/protected", originalCookie))
        CheckStatus("valid test session can read protected content", valid, HttpStatusCode.OK);
    using (var denied = await Send("/admin", originalCookie))
        CheckStatus("regular test session receives 403 for admin content", denied, HttpStatusCode.Forbidden);

    clock.Advance(lifetime / 4);
    using (var early = await Send("/protected", originalCookie))
    {
        CheckStatus("session remains valid before renewal threshold", early, HttpStatusCode.OK);
        Check("early request does not renew the ticket", !early.Headers.Contains("Set-Cookie"));
    }
    clock.Advance(lifetime / 2);
    string renewedCookie;
    using (var sliding = await Send("/protected", originalCookie))
    {
        CheckStatus("active session remains valid past half its lifetime", sliding, HttpStatusCode.OK);
        renewedCookie = CookieFrom(sliding);
        Check("sliding renewal issues a replacement ticket", renewedCookie != originalCookie);
    }
    clock.Advance(lifetime / 4 + TimeSpan.FromSeconds(1));
    using (var expired = await Send("/protected", originalCookie))
        CheckStatus("original expired ticket returns 401 without redirect", expired, HttpStatusCode.Unauthorized);
    using (var expiredAdmin = await Send("/admin", originalCookie))
        CheckStatus("expired ticket is unauthenticated rather than an admin denial", expiredAdmin, HttpStatusCode.Unauthorized);
    using (var renewed = await Send("/protected", renewedCookie))
        CheckStatus("renewed ticket survives the original expiry", renewed, HttpStatusCode.OK);

    clock.Advance(lifetime + TimeSpan.FromSeconds(1));
    using (var expiredRenewal = await Send("/protected", renewedCookie))
        CheckStatus("renewed ticket also expires after inactivity", expiredRenewal, HttpStatusCode.Unauthorized);
    var freshCookie = await SignIn();
    using (var recovered = await Send("/protected", freshCookie))
        CheckStatus("a fresh sign-in restores protected access", recovered, HttpStatusCode.OK);

    Console.WriteLine("Session expiration: all checks passed with simulated time; real sessions and database untouched.");

    async Task<HttpResponseMessage> Send(string path, string? cookie = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (cookie is not null) request.Headers.Add("Cookie", cookie);
        return await client.SendAsync(request);
    }
    async Task<string> SignIn()
    {
        using var response = await client.PostAsync("/test-session", null);
        CheckStatus("test-only sign-in issues a session", response, HttpStatusCode.NoContent);
        var header = response.Headers.GetValues("Set-Cookie").Single();
        Check("session cookie remains HttpOnly and SameSite=Lax", header.Contains("httponly", StringComparison.OrdinalIgnoreCase)
            && header.Contains("samesite=lax", StringComparison.OrdinalIgnoreCase));
        return CookieFrom(response);
    }
}
finally { await app.StopAsync(); }

static string CookieFrom(HttpResponseMessage response) => response.Headers.GetValues("Set-Cookie")
    .Single(value => value.StartsWith("traccar_scope_api_session=", StringComparison.Ordinal)).Split(';')[0];
static void CheckStatus(string name, HttpResponseMessage response, HttpStatusCode expected)
{
    Check(name, response.StatusCode == expected && response.Headers.Location is null);
}
static void Check(string name, bool condition)
{
    if (!condition) throw new InvalidOperationException(name);
    Console.WriteLine($"PASS: {name}");
}
sealed class SessionClock(DateTimeOffset utcNow) : TimeProvider
{
    private DateTimeOffset current = utcNow;
    public override DateTimeOffset GetUtcNow() => current;
    public void Advance(TimeSpan duration) => current += duration;
}
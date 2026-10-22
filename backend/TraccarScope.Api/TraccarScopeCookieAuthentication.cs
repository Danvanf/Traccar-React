using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;

public static class TraccarScopeCookieAuthentication
{
    public static void Configure(CookieAuthenticationOptions options)
    {
        options.Cookie.Name = "traccar_scope_api_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    }
}
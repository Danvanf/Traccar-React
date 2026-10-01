using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

public sealed record VehicleAppAuthOptions(string? Username, string? Password)
{
    public bool Enabled => !string.IsNullOrWhiteSpace(Username) && !string.IsNullOrEmpty(Password);
}

public static class VehicleAppAuthEndpoints
{
    public static void MapVehicleAppAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/auth/status", (VehicleAppAuthOptions options, HttpContext context) =>
            Results.Ok(new { enabled = options.Enabled, authenticated = context.User.Identity?.IsAuthenticated ?? false }));

        app.MapPost("/auth/login", async (LoginRequest request, VehicleAppAuthOptions options, HttpContext context) =>
        {
            if (!options.Enabled)
                return Results.Problem("VehicleApp authentication is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);

            var usernameMatches = SecureEquals(request.Username, options.Username);
            var passwordMatches = SecureEquals(request.Password, options.Password);
            if (!usernameMatches || !passwordMatches)
                return Results.Unauthorized();

            var identity = new ClaimsIdentity(
                new[] { new Claim(ClaimTypes.Name, options.Username!) },
                CookieAuthenticationDefaults.AuthenticationScheme);
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
            return Results.Ok(new { authenticated = true });
        });

        app.MapPost("/auth/logout", async (HttpContext context) =>
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });
    }

    private static bool SecureEquals(string? supplied, string? expected)
    {
        var suppliedHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(supplied ?? string.Empty));
        var expectedHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(expected ?? string.Empty));
        return CryptographicOperations.FixedTimeEquals(suppliedHash, expectedHash);
    }

    public sealed record LoginRequest(string? Username, string? Password);
}

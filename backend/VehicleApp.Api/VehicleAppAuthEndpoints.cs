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
        {
            var authenticated = context.User.Identity?.IsAuthenticated ?? false;
            var username = context.User.Identity?.Name;
            var role = context.User.FindFirstValue(ClaimTypes.Role);
            if (authenticated && role is null && options.Enabled && SecureEquals(username, options.Username))
                role = "admin";
            return Results.Ok(new { enabled = options.Enabled, authenticated, role });
        });

        app.MapPost("/auth/login", async (LoginRequest request, VehicleAppAuthOptions options, Npgsql.NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (!options.Enabled)
                return Results.Problem("VehicleApp authentication is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);

            string? role = null;
            string? databaseHash = null;
            await using (var connection = await dataSource.OpenConnectionAsync(cancellationToken))
            await using (var command = new Npgsql.NpgsqlCommand("select password_hash, role from app_users where username = @username and active", connection))
            {
                command.Parameters.AddWithValue("username", request.Username ?? string.Empty);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    databaseHash = reader.IsDBNull(0) ? null : reader.GetString(0);
                    role = reader.GetString(1);
                }
            }

            var databaseMatches = databaseHash is not null && PasswordHashing.Verify(request.Password ?? string.Empty, databaseHash);
            var environmentMatches = SecureEquals(request.Username, options.Username) && SecureEquals(request.Password, options.Password);
            if (!databaseMatches && !environmentMatches)
                return Results.Unauthorized();

            role ??= "admin";

            var identity = new ClaimsIdentity(
                new[]
                {
                    new Claim(ClaimTypes.Name, options.Username!),
                    new Claim(ClaimTypes.Role, role)
                },
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

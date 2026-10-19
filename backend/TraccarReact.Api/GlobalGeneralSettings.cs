using System.Text.Json;
using Npgsql;

public sealed record GlobalGeneralSettings(
    string ApiBaseUrl,
    string TraccarScopeApiBaseUrl,
    bool UseBackendVehicleCatalog,
    string Username,
    string Password,
    int PollIntervalMs,
    int RealtimeHours,
    int MovementThresholdM,
    string DisplayUnits,
    string Theme,
    bool HasTraccarPassword = false)
{
    public static GlobalGeneralSettings Defaults { get; } = new(
        "/api", "/traccar-scope-api", false, string.Empty, string.Empty, 5000, 3, 20, "imperial", "auto");
}

public sealed record SaveGlobalGeneralSettingsRequest(
    string? ApiBaseUrl,
    string? TraccarScopeApiBaseUrl,
    bool UseBackendVehicleCatalog,
    string? Username,
    string? Password,
    int PollIntervalMs,
    int RealtimeHours,
    int MovementThresholdM,
    string? DisplayUnits,
    string? Theme);

public sealed class GlobalGeneralSettingsStore(NpgsqlDataSource dataSource, CredentialProtectionService credentialProtection)
{
    private const string GeneralKey = "general";
    private const string TraccarPasswordKey = "traccar-password";
    private const string TraccarPasswordPurpose = "global-traccar-password";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task EnsureSchemaAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            create table if not exists app_system_settings (
                setting_key text primary key,
                setting_value text not null,
                updated_at timestamptz not null default now()
            )
            """, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<GlobalGeneralSettings> GetAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        string? settingsJson = null;
        string? protectedPassword = null;
        await using (var command = new NpgsqlCommand("select setting_key, setting_value from app_system_settings where setting_key = any(@keys)", connection))
        {
            command.Parameters.AddWithValue("keys", new[] { GeneralKey, TraccarPasswordKey });
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                if (reader.GetString(0) == GeneralKey) settingsJson = reader.GetString(1);
                else if (reader.GetString(0) == TraccarPasswordKey) protectedPassword = reader.GetString(1);
            }
        }

        var settings = string.IsNullOrWhiteSpace(settingsJson)
            ? GlobalGeneralSettings.Defaults
            : JsonSerializer.Deserialize<GlobalGeneralSettings>(ApiNamingMigration.UpgradeGeneralSettingsJson(settingsJson), JsonOptions) ?? GlobalGeneralSettings.Defaults;
        var password = string.IsNullOrWhiteSpace(protectedPassword)
            ? string.Empty
            : credentialProtection.UnprotectSystemCredential(TraccarPasswordPurpose, protectedPassword);
        return settings with { Password = password, HasTraccarPassword = !string.IsNullOrEmpty(password) };
    }

    public async Task SaveAsync(GlobalGeneralSettings settings, string? password, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var publicSettings = settings with { Password = string.Empty };
        var json = JsonSerializer.Serialize(publicSettings, JsonOptions);
        await using (var command = new NpgsqlCommand("""
            insert into app_system_settings (setting_key, setting_value, updated_at)
            values (@key, @value, now())
            on conflict (setting_key) do update set setting_value = excluded.setting_value, updated_at = now()
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("key", GeneralKey);
            command.Parameters.AddWithValue("value", json);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        if (!string.IsNullOrEmpty(password))
        {
            var protectedPassword = credentialProtection.ProtectSystemCredential(TraccarPasswordPurpose, password);
            await using var command = new NpgsqlCommand("""
                insert into app_system_settings (setting_key, setting_value, updated_at)
                values (@key, @value, now())
                on conflict (setting_key) do update set setting_value = excluded.setting_value, updated_at = now()
                """, connection, transaction);
            command.Parameters.AddWithValue("key", TraccarPasswordKey);
            command.Parameters.AddWithValue("value", protectedPassword);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }
}

public static class GlobalGeneralSettingsEndpoints
{
    public static void MapGlobalGeneralSettingsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/system-settings/general", async (GlobalGeneralSettingsStore store, CancellationToken cancellationToken) =>
        {
            try
            {
                var settings = await store.GetAsync(cancellationToken);
                return Results.Ok(settings with { Password = string.Empty, HasTraccarPassword = !string.IsNullOrEmpty(settings.Password) });
            }
            catch (CredentialProtectionException)
            {
                return Results.Problem("The shared Traccar password cannot be decrypted. Check the API credential encryption key configuration.", statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        }).RequireAuthorization();

        app.MapPut("/api/admin/system-settings/general", async (SaveGlobalGeneralSettingsRequest request, GlobalGeneralSettingsStore store, CredentialProtectionService protection, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.ApiBaseUrl) || request.ApiBaseUrl.Length > 500)
                return Results.BadRequest("API Base URL is required and must be 500 characters or fewer.");
            if (string.IsNullOrWhiteSpace(request.TraccarScopeApiBaseUrl) || request.TraccarScopeApiBaseUrl.Length > 500)
                return Results.BadRequest("Traccar Scope API Base URL is required and must be 500 characters or fewer.");
            if (request.Username?.Length > 200 || request.Password?.Length > 2000)
                return Results.BadRequest("Traccar credentials exceed the allowed length.");
            if (request.PollIntervalMs is < 1000 or > 120000)
                return Results.BadRequest("Poll interval must be between 1000 and 120000 milliseconds.");
            if (request.RealtimeHours is < 1 or > 24)
                return Results.BadRequest("Realtime hours must be between 1 and 24.");
            if (request.MovementThresholdM is < 1 or > 10000)
                return Results.BadRequest("Movement threshold must be between 1 and 10000 meters.");
            if (request.DisplayUnits is not ("imperial" or "metric"))
                return Results.BadRequest("Display units must be imperial or metric.");
            if (request.Theme is not ("auto" or "light" or "dark"))
                return Results.BadRequest("Theme must be auto, light, or dark.");

            if (!string.IsNullOrEmpty(request.Password) && !protection.CanProtect)
                return Results.Problem("Credential encryption is not configured. The shared Traccar password was not saved.", statusCode: StatusCodes.Status503ServiceUnavailable);

            var settings = new GlobalGeneralSettings(
                request.ApiBaseUrl.Trim(), request.TraccarScopeApiBaseUrl.Trim(), request.UseBackendVehicleCatalog,
                request.Username?.Trim() ?? string.Empty, string.Empty, request.PollIntervalMs,
                request.RealtimeHours, request.MovementThresholdM, request.DisplayUnits!, request.Theme!);
            try
            {
                await store.SaveAsync(settings, request.Password, cancellationToken);
                return Results.NoContent();
            }
            catch (CredentialProtectionException)
            {
                return Results.Problem("Credential encryption is not configured. The shared Traccar password was not saved.", statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        }).RequireAuthorization(policy => policy.RequireRole("admin"));
    }
}

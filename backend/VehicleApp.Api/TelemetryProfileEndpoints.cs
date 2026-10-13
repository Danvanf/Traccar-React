using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;

public static class TelemetryProfileEndpoints
{
    private static readonly Regex ProfileKeyPattern = new("^[A-Za-z0-9_.-]{1,200}$", RegexOptions.Compiled);

    public static void MapTelemetryProfileEndpoints(this WebApplication app)
    {
        app.MapGet("/api/telemetry-profiles", ListAsync).WithName("ListTelemetryProfiles");
        app.MapPut("/api/telemetry-profiles/{profileKey}", UpsertAsync).WithName("UpsertTelemetryProfile");
        app.MapDelete("/api/telemetry-profiles/{profileKey}", DeleteAsync).WithName("DeleteTelemetryProfile");
    }

    private static async Task<IResult> ListAsync(
        NpgsqlDataSource dataSource,
        VehicleAppAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(dataSource, authOptions, context, requireAdmin: false, cancellationToken: cancellationToken);
        if (authorizationFailure is not null) return authorizationFailure;
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("select profile_key, display_name, schema_version, translation_json from telemetry_profiles order by display_name, profile_key", connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var profiles = new List<TelemetryProfileResponse>();
            while (await reader.ReadAsync(cancellationToken))
            {
                using var translation = JsonDocument.Parse(reader.GetString(3));
                profiles.Add(new TelemetryProfileResponse(reader.GetString(0), reader.GetString(1), reader.GetInt32(2), translation.RootElement.Clone()));
            }
            return Results.Ok(profiles);
        }
        catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
        {
            return Results.Problem(title: "Telemetry profile storage schema is not current", detail: "Apply the Phase 3 vehicle app schema and scripts/phase_telemetry_profile_schema.sql.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Telemetry profile lookup failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult> UpsertAsync(
        string profileKey,
        TelemetryProfileUpsertRequest request,
        NpgsqlDataSource dataSource,
        VehicleAppAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(dataSource, authOptions, context, requireAdmin: true, cancellationToken: cancellationToken);
        if (authorizationFailure is not null) return authorizationFailure;
        if (!ProfileKeyPattern.IsMatch(profileKey)) return Results.BadRequest("Profile key contains invalid characters or is too long.");
        if (!string.Equals(request.Id, profileKey, StringComparison.Ordinal)) return Results.BadRequest("The profile id must match the route key.");
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 200) return Results.BadRequest("Profile name is required and must be 200 characters or fewer.");
        if (request.AttributeMap.ValueKind != JsonValueKind.Object) return Results.BadRequest("attributeMap must be a JSON object.");

        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                insert into telemetry_profiles (profile_key, display_name, schema_version, translation_json, updated_at)
                values (@profileKey, @displayName, @schemaVersion, @translationJson, now())
                on conflict (profile_key) do update set
                  display_name = excluded.display_name,
                  schema_version = excluded.schema_version,
                  translation_json = excluded.translation_json,
                  updated_at = now()
                """, connection);
            command.Parameters.AddWithValue("profileKey", profileKey);
            command.Parameters.AddWithValue("displayName", request.Name.Trim());
            if (request.SchemaVersion <= 0) return Results.BadRequest("schemaVersion must be a positive integer.");
            command.Parameters.AddWithValue("schemaVersion", request.SchemaVersion);
            command.Parameters.Add("translationJson", NpgsqlDbType.Jsonb).Value = request.AttributeMap.GetRawText();
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.NoContent();
        }
        catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
        {
            return Results.Problem(title: "Telemetry profile storage schema is not current", detail: "Apply the Phase 3 vehicle app schema and scripts/phase_telemetry_profile_schema.sql.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Telemetry profile save failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult> DeleteAsync(
        string profileKey,
        NpgsqlDataSource dataSource,
        VehicleAppAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(dataSource, authOptions, context, requireAdmin: true, cancellationToken: cancellationToken);
        if (authorizationFailure is not null) return authorizationFailure;
        if (!ProfileKeyPattern.IsMatch(profileKey)) return Results.BadRequest("Profile key contains invalid characters or is too long.");
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using (var used = new NpgsqlCommand("""
                select exists(select 1 from vehicles where profile_id=@profileKey)
                    or exists(select 1 from telemetry_profile_assignments a join telemetry_profiles p on p.id=a.profile_id where p.profile_key=@profileKey)
                """, connection, transaction))
            {
                used.Parameters.AddWithValue("profileKey", profileKey);
                if ((bool)(await used.ExecuteScalarAsync(cancellationToken) ?? false))
                    return Results.Conflict("This profile is assigned to a vehicle. Change the vehicle profile before deleting it.");
            }
            await using var command = new NpgsqlCommand("delete from telemetry_profiles where profile_key=@profileKey", connection, transaction);
            command.Parameters.AddWithValue("profileKey", profileKey);
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return Results.NotFound();
            await transaction.CommitAsync(cancellationToken);
            return Results.NoContent();
        }
        catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
        {
            return Results.Problem(title: "Telemetry profile storage schema is not current", detail: "Apply the Phase 3 vehicle app schema and scripts/phase_telemetry_profile_schema.sql.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Telemetry profile delete failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult?> AuthorizeAsync(
        NpgsqlDataSource dataSource,
        VehicleAppAuthOptions options,
        HttpContext context,
        bool requireAdmin,
        CancellationToken cancellationToken)
    {
        if (!options.Enabled) return null;
        var username = context.User.Identity?.Name;
        if (string.IsNullOrWhiteSpace(username)) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select role from app_users where username=@username and active", connection);
        command.Parameters.AddWithValue("username", username);
        var role = await command.ExecuteScalarAsync(cancellationToken) as string;
        if (role is null) return Results.Unauthorized();
        if (requireAdmin && !string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase)) return Results.Forbid();
        return null;
    }
}

public sealed record TelemetryProfileUpsertRequest(string Id, string Name, int SchemaVersion, JsonElement AttributeMap);
public sealed record TelemetryProfileResponse(string Id, string Name, int SchemaVersion, JsonElement AttributeMap);

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
        app.MapGet("/api/telemetry-profiles/history", ListSharedHistoryAsync).WithName("ListSharedTelemetryProfileHistory");
        app.MapGet("/api/telemetry-profiles/{profileKey}/revisions", ListRevisionsAsync).WithName("ListTelemetryProfileRevisions");
        app.MapPut("/api/telemetry-profiles/{profileKey}", UpsertAsync).WithName("UpsertTelemetryProfile");
        app.MapDelete("/api/telemetry-profiles/{profileKey}", DeleteAsync).WithName("DeleteTelemetryProfile");
    }

    private static async Task<IResult> ListSharedHistoryAsync(
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(dataSource, authOptions, context, requireAdmin: false, cancellationToken: cancellationToken);
        if (authorizationFailure is not null) return authorizationFailure;
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("select profile_key, revision, display_name, schema_version, translation_json, effective_at from telemetry_profile_revisions order by profile_key, effective_at, revision", connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var revisions = new List<TelemetryProfileHistoryResponse>();
            while (await reader.ReadAsync(cancellationToken))
            {
                using var translation = JsonDocument.Parse(reader.GetString(4));
                revisions.Add(new TelemetryProfileHistoryResponse(
                    reader.GetString(0), reader.GetInt64(1), reader.GetString(2), reader.GetInt32(3),
                    translation.RootElement.Clone(), reader.GetFieldValue<DateTimeOffset>(5)));
            }
            return Results.Ok(revisions);
        }
        catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
        {
            return Results.Problem(title: "Telemetry profile revision storage is not current", detail: "Apply scripts/phase_telemetry_profile_revisions_schema.sql.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Telemetry profile history lookup failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult> ListAsync(
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(dataSource, authOptions, context, requireAdmin: false, cancellationToken: cancellationToken);
        if (authorizationFailure is not null) return authorizationFailure;
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("select profile_key, display_name, schema_version, translation_json, revision from telemetry_profiles order by display_name, profile_key", connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var profiles = new List<TelemetryProfileResponse>();
            while (await reader.ReadAsync(cancellationToken))
            {
                using var translation = JsonDocument.Parse(reader.GetString(3));
                profiles.Add(new TelemetryProfileResponse(reader.GetString(0), reader.GetString(1), reader.GetInt32(2), translation.RootElement.Clone(), reader.GetInt64(4)));
            }
            return Results.Ok(profiles);
        }
        catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
        {
            return Results.Problem(title: "Telemetry profile revision storage is not current", detail: "Apply scripts/phase_telemetry_profile_revisions_schema.sql.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Telemetry profile lookup failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult> ListRevisionsAsync(
        string profileKey,
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(dataSource, authOptions, context, requireAdmin: true, cancellationToken: cancellationToken);
        if (authorizationFailure is not null) return authorizationFailure;
        if (!ProfileKeyPattern.IsMatch(profileKey)) return Results.BadRequest("Profile key contains invalid characters or is too long.");
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("select profile_key, revision, display_name, schema_version, translation_json, change_kind, changed_by, created_at, effective_at from telemetry_profile_revisions where profile_key=@profileKey order by revision desc", connection);
            command.Parameters.AddWithValue("profileKey", profileKey);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var revisions = new List<TelemetryProfileRevisionResponse>();
            while (await reader.ReadAsync(cancellationToken))
            {
                using var translation = JsonDocument.Parse(reader.GetString(4));
                revisions.Add(new TelemetryProfileRevisionResponse(
                    reader.GetString(0), reader.GetInt64(1), reader.GetString(2), reader.GetInt32(3),
                    translation.RootElement.Clone(), reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetString(6), reader.GetFieldValue<DateTimeOffset>(7), reader.GetFieldValue<DateTimeOffset>(8)));
            }
            return Results.Ok(revisions);
        }
        catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
        {
            return Results.Problem(title: "Telemetry profile revision storage is not current", detail: "Apply scripts/phase_telemetry_profile_revisions_schema.sql.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Telemetry profile revision lookup failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult> UpsertAsync(
        string profileKey,
        TelemetryProfileUpsertRequest request,
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(dataSource, authOptions, context, requireAdmin: true, cancellationToken: cancellationToken);
        if (authorizationFailure is not null) return authorizationFailure;
        if (!ProfileKeyPattern.IsMatch(profileKey)) return Results.BadRequest("Profile key contains invalid characters or is too long.");
        if (!string.Equals(request.Id, profileKey, StringComparison.Ordinal)) return Results.BadRequest("The profile id must match the route key.");
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 200) return Results.BadRequest("Profile name is required and must be 200 characters or fewer.");
        if (request.AttributeMap.ValueKind != JsonValueKind.Object) return Results.BadRequest("attributeMap must be a JSON object.");
        if (!TryGetExpectedRevision(context.Request, out var expectedRevision)) return Results.StatusCode(StatusCodes.Status428PreconditionRequired);
        var changeKind = string.IsNullOrWhiteSpace(request.ChangeKind) ? "manual" : request.ChangeKind.Trim();
        if (changeKind is not ("manual" or "documented-auto" or "undo" or "migration")) return Results.BadRequest("changeKind is not supported.");
        if (request.SchemaVersion <= 0) return Results.BadRequest("schemaVersion must be a positive integer.");

        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            long? currentRevision;
            await using (var current = new NpgsqlCommand("select revision from telemetry_profiles where profile_key=@profileKey for update", connection, transaction))
            {
                current.Parameters.AddWithValue("profileKey", profileKey);
                var value = await current.ExecuteScalarAsync(cancellationToken);
                currentRevision = value is null or DBNull ? null : Convert.ToInt64(value);
            }

            if (currentRevision.GetValueOrDefault() != expectedRevision)
            {
                await using var currentProfile = new NpgsqlCommand("select revision, display_name, schema_version, translation_json from telemetry_profiles where profile_key=@profileKey", connection, transaction);
                currentProfile.Parameters.AddWithValue("profileKey", profileKey);
                await using var reader = await currentProfile.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken)) return Results.Conflict(new { message = "The profile changed while this edit was being saved.", revision = 0 });
                using var translation = JsonDocument.Parse(reader.GetString(3));
                return Results.Conflict(new TelemetryProfileConflictResponse(
                    "The profile changed while this edit was being saved. Reload it before applying your changes.",
                    reader.GetInt64(0), reader.GetString(1), reader.GetInt32(2), translation.RootElement.Clone()));
            }

            long nextRevision;
            if (currentRevision is null)
            {
                if (expectedRevision != 0) return Results.Conflict(new { message = "The profile no longer exists.", revision = 0 });
                nextRevision = 1;
                await using (var insert = new NpgsqlCommand("insert into telemetry_profiles (profile_key, display_name, schema_version, translation_json, revision, updated_at) values (@profileKey, @displayName, @schemaVersion, @translationJson, @revision, now())", connection, transaction))
                {
                    AddProfileParameters(insert, profileKey, request, nextRevision);
                    await insert.ExecuteNonQueryAsync(cancellationToken);
                }
            }
            else
            {
                await using (var preserveCurrent = new NpgsqlCommand("""
                    insert into telemetry_profile_revisions (profile_key, revision, display_name, schema_version, translation_json, change_kind, effective_at)
                    select profile_key, revision, display_name, schema_version, translation_json, 'legacy', updated_at
                    from telemetry_profiles where profile_key=@profileKey
                    on conflict (profile_key, revision) do nothing
                    """, connection, transaction))
                {
                    preserveCurrent.Parameters.AddWithValue("profileKey", profileKey);
                    await preserveCurrent.ExecuteNonQueryAsync(cancellationToken);
                }
                nextRevision = currentRevision.Value + 1;
                await using (var update = new NpgsqlCommand("update telemetry_profiles set display_name=@displayName, schema_version=@schemaVersion, translation_json=@translationJson, revision=@revision, updated_at=now() where profile_key=@profileKey", connection, transaction))
                {
                    AddProfileParameters(update, profileKey, request, nextRevision);
                    await update.ExecuteNonQueryAsync(cancellationToken);
                }
            }

            await using (var snapshot = new NpgsqlCommand("""
                insert into telemetry_profile_revisions (profile_key, revision, display_name, schema_version, translation_json, change_kind, changed_by, effective_at)
                select profile_key, revision, display_name, schema_version, translation_json, @changeKind, @changedBy, updated_at
                from telemetry_profiles where profile_key=@profileKey
                on conflict (profile_key, revision) do nothing
                """, connection, transaction))
            {
                snapshot.Parameters.AddWithValue("profileKey", profileKey);
                snapshot.Parameters.AddWithValue("changeKind", changeKind);
                snapshot.Parameters.AddWithValue("changedBy", (object?)context.User.Identity?.Name ?? DBNull.Value);
                await snapshot.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new TelemetryProfileUpsertResponse(profileKey, nextRevision));
        }
        catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
        {
            return Results.Problem(title: "Telemetry profile revision storage schema is not current", detail: "Apply scripts/phase_telemetry_profile_revisions_schema.sql.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Telemetry profile save failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult> DeleteAsync(
        string profileKey,
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(dataSource, authOptions, context, requireAdmin: true, cancellationToken: cancellationToken);
        if (authorizationFailure is not null) return authorizationFailure;
        if (!ProfileKeyPattern.IsMatch(profileKey)) return Results.BadRequest("Profile key contains invalid characters or is too long.");
        if (!TryGetExpectedRevision(context.Request, out var expectedRevision)) return Results.StatusCode(StatusCodes.Status428PreconditionRequired);
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using (var revision = new NpgsqlCommand("select revision from telemetry_profiles where profile_key=@profileKey for update", connection, transaction))
            {
                revision.Parameters.AddWithValue("profileKey", profileKey);
                var current = await revision.ExecuteScalarAsync(cancellationToken);
                if (current is null or DBNull) return Results.NotFound();
                var currentRevision = Convert.ToInt64(current);
                if (currentRevision != expectedRevision) return Results.Conflict(new { message = "The profile changed before it could be deleted.", revision = currentRevision });
            }
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
            return Results.Problem(title: "Telemetry profile revision storage is not current", detail: "Apply scripts/phase_telemetry_profile_revisions_schema.sql.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Telemetry profile delete failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static bool TryGetExpectedRevision(HttpRequest request, out long revision)
    {
        revision = 0;
        var value = request.Headers["If-Match"].ToString().Trim();
        if (value.StartsWith("W/", StringComparison.OrdinalIgnoreCase)) value = value[2..].Trim();
        value = value.Trim('"');
        return long.TryParse(value, out revision) && revision >= 0;
    }

    private static void AddProfileParameters(NpgsqlCommand command, string profileKey, TelemetryProfileUpsertRequest request, long revision)
    {
        command.Parameters.AddWithValue("profileKey", profileKey);
        command.Parameters.AddWithValue("displayName", request.Name.Trim());
        command.Parameters.AddWithValue("schemaVersion", request.SchemaVersion);
        command.Parameters.Add("translationJson", NpgsqlDbType.Jsonb).Value = request.AttributeMap.GetRawText();
        command.Parameters.AddWithValue("revision", revision);
    }

    private static async Task<IResult?> AuthorizeAsync(
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions options,
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

public sealed record TelemetryProfileUpsertRequest(string Id, string Name, int SchemaVersion, JsonElement AttributeMap, string? ChangeKind = null);
public sealed record TelemetryProfileResponse(string Id, string Name, int SchemaVersion, JsonElement AttributeMap, long Revision);
public sealed record TelemetryProfileHistoryResponse(string Id, long Revision, string Name, int SchemaVersion, JsonElement AttributeMap, DateTimeOffset EffectiveAt);
public sealed record TelemetryProfileUpsertResponse(string Id, long Revision);
public sealed record TelemetryProfileConflictResponse(string Message, long Revision, string Name, int SchemaVersion, JsonElement AttributeMap);
public sealed record TelemetryProfileRevisionResponse(string Id, long Revision, string Name, int SchemaVersion, JsonElement AttributeMap, string ChangeKind, string? ChangedBy, DateTimeOffset CreatedAt, DateTimeOffset EffectiveAt);

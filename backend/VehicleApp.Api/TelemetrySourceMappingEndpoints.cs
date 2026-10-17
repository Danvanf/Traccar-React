using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;

public static class TelemetrySourceMappingEndpoints
{
    private static readonly Regex FieldKeyPattern = new("^[A-Za-z0-9_.-]{1,200}$", RegexOptions.Compiled);

    public static void MapTelemetrySourceMappingEndpoints(this WebApplication app)
    {
        app.MapGet("/api/telemetry-source-mappings/{deviceId:int}", ListAsync);
        app.MapPut("/api/telemetry-source-mappings/{deviceId:int}/{fieldKey}", SaveAsync);
    }

    private static async Task<IResult> ListAsync(int deviceId, NpgsqlDataSource dataSource, VehicleAppAuthOptions options, HttpContext context, CancellationToken cancellationToken)
    {
        var failure = await AuthorizeAsync(dataSource, options, context, requireAdmin: false, cancellationToken);
        if (failure is not null) return failure;
        if (deviceId <= 0) return Results.BadRequest("Traccar device id must be positive.");
        if (!await VehicleAccess.CanReadDeviceAsync(deviceId, dataSource, options, context, cancellationToken)) return Results.NotFound();
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("select field_key, revision, effective_at, mapping_json, changed_by, change_kind, created_at from telemetry_source_mapping_revisions where traccar_device_id=@deviceId order by field_key, effective_at, revision", connection);
            command.Parameters.AddWithValue("deviceId", deviceId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var rows = new List<TelemetrySourceMappingRevisionResponse>();
            while (await reader.ReadAsync(cancellationToken))
            {
                JsonElement? mapping = null;
                if (!reader.IsDBNull(3))
                {
                    using var document = JsonDocument.Parse(reader.GetString(3));
                    mapping = document.RootElement.Clone();
                }
                rows.Add(new TelemetrySourceMappingRevisionResponse(reader.GetString(0), reader.GetInt64(1), reader.GetFieldValue<DateTimeOffset>(2), mapping, reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetString(5), reader.GetFieldValue<DateTimeOffset>(6)));
            }
            return Results.Ok(rows);
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Tracker mapping history lookup failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult> SaveAsync(int deviceId, string fieldKey, TelemetrySourceMappingSaveRequest request, NpgsqlDataSource dataSource, VehicleAppAuthOptions options, HttpContext context, CancellationToken cancellationToken)
    {
        var failure = await AuthorizeAsync(dataSource, options, context, requireAdmin: true, cancellationToken);
        if (failure is not null) return failure;
        if (deviceId <= 0) return Results.BadRequest("Traccar device id must be positive.");
        if (!FieldKeyPattern.IsMatch(fieldKey)) return Results.BadRequest("Field key contains invalid characters or is too long.");
        if (request.ExpectedRevision < 0) return Results.BadRequest("Expected revision cannot be negative.");
        if (request.ChangeKind is not ("manual" or "documented-auto" or "undo")) return Results.BadRequest("changeKind must be manual, documented-auto, or undo.");
        if (request.Mapping is JsonElement mappingValue && mappingValue.ValueKind != JsonValueKind.Object) return Results.BadRequest("mapping must be a JSON object or null to return to the shared profile baseline.");

        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using (var lockCommand = new NpgsqlCommand("select pg_advisory_xact_lock(hashtextextended(@scope, 0))", connection, transaction))
            {
                lockCommand.Parameters.AddWithValue("scope", $"{deviceId}:{fieldKey}");
                await lockCommand.ExecuteNonQueryAsync(cancellationToken);
            }
            long currentRevision;
            await using (var revisionCommand = new NpgsqlCommand("select coalesce(max(revision), 0) from telemetry_source_mapping_revisions where traccar_device_id=@deviceId and field_key=@fieldKey", connection, transaction))
            {
                revisionCommand.Parameters.AddWithValue("deviceId", deviceId);
                revisionCommand.Parameters.AddWithValue("fieldKey", fieldKey);
                currentRevision = (long)(await revisionCommand.ExecuteScalarAsync(cancellationToken) ?? 0L);
            }
            if (currentRevision != request.ExpectedRevision)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Results.Conflict(new TelemetrySourceMappingConflictResponse("This tracker mapping changed since you opened it. Reload before saving.", currentRevision));
            }
            var effectiveAt = DateTimeOffset.UtcNow;
            var username = context.User.Identity?.Name;
            await using (var insert = new NpgsqlCommand("insert into telemetry_source_mapping_revisions (traccar_device_id, field_key, revision, effective_at, mapping_json, changed_by, change_kind) values (@deviceId, @fieldKey, @revision, @effectiveAt, @mapping, @changedBy, @changeKind)", connection, transaction))
            {
                insert.Parameters.AddWithValue("deviceId", deviceId);
                insert.Parameters.AddWithValue("fieldKey", fieldKey);
                insert.Parameters.AddWithValue("revision", currentRevision + 1);
                insert.Parameters.AddWithValue("effectiveAt", effectiveAt);
                insert.Parameters.Add("mapping", NpgsqlDbType.Jsonb).Value = request.Mapping is JsonElement mapping
                    ? mapping.GetRawText()
                    : DBNull.Value;
                insert.Parameters.AddWithValue("changedBy", (object?)username ?? DBNull.Value);
                insert.Parameters.AddWithValue("changeKind", request.ChangeKind);
                await insert.ExecuteNonQueryAsync(cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new TelemetrySourceMappingSaveResponse(fieldKey, currentRevision + 1, effectiveAt, request.ChangeKind));
        }
        catch (PostgresException ex)
        {
            return Results.Problem(title: "Tracker mapping save failed", detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult?> AuthorizeAsync(NpgsqlDataSource dataSource, VehicleAppAuthOptions options, HttpContext context, bool requireAdmin, CancellationToken cancellationToken)
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

public sealed record TelemetrySourceMappingSaveRequest(long ExpectedRevision, JsonElement? Mapping, string ChangeKind = "manual");
public sealed record TelemetrySourceMappingSaveResponse(string FieldKey, long Revision, DateTimeOffset EffectiveAt, string ChangeKind);
public sealed record TelemetrySourceMappingConflictResponse(string Message, long Revision);
public sealed record TelemetrySourceMappingRevisionResponse(string FieldKey, long Revision, DateTimeOffset EffectiveAt, JsonElement? Mapping, string? ChangedBy, string ChangeKind, DateTimeOffset CreatedAt);

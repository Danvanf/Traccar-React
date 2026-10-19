using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;

public static class TelemetryShareEndpoints
{
    private static readonly Regex FieldKeyPattern = new("^[A-Za-z0-9_.-]{1,200}$", RegexOptions.Compiled);
    private static readonly Regex ColorPattern = new("^#[0-9a-fA-F]{6}$", RegexOptions.Compiled);

    public static void MapTelemetryShareEndpoints(this WebApplication app)
    {
        app.MapPost("/api/telemetry-shares", CreateAsync)
            .WithName("CreateTelemetryShare");
        app.MapGet("/api/telemetry-shares", ListAsync)
            .WithName("ListTelemetryShares");
        app.MapPost("/api/telemetry-shares/{shareId:guid}/rotate", RotateAsync)
            .WithName("RotateTelemetryShareToken");
        app.MapPost("/api/telemetry-shares/{shareId:guid}/enable", EnableAsync)
            .WithName("EnableTelemetryShare");
        app.MapPut("/api/telemetry-shares/{shareId:guid}/expiration", UpdateExpirationAsync)
            .WithName("UpdateTelemetryShareExpiration");
        app.MapDelete("/api/telemetry-shares/{shareId:guid}", RevokeAsync)
            .WithName("RevokeTelemetryShare");
        app.MapGet("/api/telemetry-shares/storage-summary", StorageSummaryAsync)
            .WithName("TelemetryShareStorageSummary");
    }

    private static async Task<IResult> StorageSummaryAsync(NpgsqlDataSource dataSource, TraccarScopeApiAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken)
    {
        var actor = await FindActorAsync(dataSource, authOptions, context, cancellationToken);
        if (actor is null) return Results.Unauthorized();
        if (!actor.IsAdmin) return Results.Forbid();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select count(*) filter (where status='active'),
                   count(*) filter (where status='expired'),
                   count(*) filter (where status='revoked'),
                   coalesce((select sum(pg_column_size(point_values)) from telemetry_share_points), 0),
                   coalesce((select count(*) from telemetry_share_points), 0)
            from telemetry_shares
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return Results.Ok(new
        {
            activeShares = reader.GetInt64(0),
            expiredShares = reader.GetInt64(1),
            revokedShares = reader.GetInt64(2),
            pointPayloadBytes = reader.GetInt64(3),
            pointCount = reader.GetInt64(4),
        });
    }

    private static async Task<IResult> CreateAsync(
        TelemetryShareCreateRequest request,
        NpgsqlDataSource dataSource,
        TelemetryShareTokenService tokenService,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var actor = await FindActorAsync(dataSource, authOptions, context, cancellationToken);
        if (actor is null) return Results.Unauthorized();
        if (!Guid.TryParse(request.VehicleId, out var vehicleId)) return Results.BadRequest("A valid vehicleId is required.");
        if (request.Mode is not ("graph" or "range")) return Results.BadRequest("mode must be graph or range.");
        if (request.FieldKeys is null || request.FieldKeys.Count == 0)
            return Results.BadRequest("Select at least one telemetry field.");
        if (request.Series is null || request.Series.Count != request.FieldKeys.Count)
            return Results.BadRequest("Series metadata must match the selected telemetry fields.");
        if (request.FromUtc is null || request.ThroughUtc is null || request.ThroughUtc <= request.FromUtc)
            return Results.BadRequest("A valid non-empty UTC date range is required.");
        if (request.ThroughUtc - request.FromUtc > TimeSpan.FromDays(90))
            return Results.BadRequest("A share may cover at most 90 days.");
        if (request.ExpiresAt is null || request.ExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(5) || request.ExpiresAt > DateTimeOffset.UtcNow.AddDays(90))
            return Results.BadRequest("Expiration must be between five minutes and 90 days from now.");
        if (request.Title?.Length > 200 || request.Message?.Length > 2000)
            return Results.BadRequest("The title or message is too long.");
        if (!request.FieldKeys.All(key => FieldKeyPattern.IsMatch(key)) || request.FieldKeys.Distinct(StringComparer.Ordinal).Count() != request.FieldKeys.Count)
            return Results.BadRequest("Telemetry field keys are invalid or duplicated.");
        if (request.Series.Any(series => !request.FieldKeys.Contains(series.FieldKey, StringComparer.Ordinal)
            || !ColorPattern.IsMatch(series.Color ?? string.Empty)
            || series.DisplayOrder < 0))
            return Results.BadRequest("Each series must name a selected field, use a hex color, and have a non-negative order.");
        if (request.Points is null || request.Points.Count > 250_000)
            return Results.BadRequest("The snapshot contains too many points.");

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var trips = await LoadTripsAsync(connection, transaction, request, vehicleId, actor, cancellationToken);
        if (trips.Count == 0) return Results.BadRequest("No authorized trips matched this share.");
        if (request.Mode == "graph" && request.TripIds is null)
            return Results.BadRequest("Graph shares require at least one trip.");

        var tripIds = trips.Select(trip => trip.Id).ToHashSet();
        var pointsByTrip = request.Points
            .Where(point => tripIds.Contains(point.TripId))
            .GroupBy(point => point.TripId)
            .ToDictionary(group => group.Key, group => group.OrderBy(point => point.OccurredAt).ToList());
        var totalPointCount = pointsByTrip.Values.Sum(points => points.Count);
        if (totalPointCount == 0) return Results.BadRequest("The share contains no telemetry points for the selected trips.");

        var token = tokenService.Create();
        var shareId = Guid.NewGuid();
        var vehicleLabel = trips[0].VehicleName;
        await using (var command = new NpgsqlCommand("""
            insert into telemetry_shares
              (id, token_hash, owner_user_id, vehicle_id, mode, title, message,
               vehicle_label_snapshot, from_utc, through_utc, time_zone, allow_export,
               expires_at)
            values
              (@id, @tokenHash, @ownerUserId, @vehicleId, @mode, @title, @message,
               @vehicleLabel, @fromUtc, @throughUtc, @timeZone, @allowExport,
               @expiresAt)
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("id", shareId);
            command.Parameters.Add("tokenHash", NpgsqlDbType.Bytea).Value = token.Hash;
            command.Parameters.AddWithValue("ownerUserId", actor.UserId);
            command.Parameters.AddWithValue("vehicleId", vehicleId);
            command.Parameters.AddWithValue("mode", request.Mode);
            command.Parameters.AddWithValue("title", (object?)request.Title ?? DBNull.Value);
            command.Parameters.AddWithValue("message", (object?)request.Message ?? DBNull.Value);
            command.Parameters.AddWithValue("vehicleLabel", vehicleLabel);
            command.Parameters.AddWithValue("fromUtc", request.FromUtc.Value.UtcDateTime);
            command.Parameters.AddWithValue("throughUtc", request.ThroughUtc.Value.UtcDateTime);
            command.Parameters.AddWithValue("timeZone", request.TimeZone ?? "UTC");
            command.Parameters.AddWithValue("allowExport", request.AllowExport);
            command.Parameters.AddWithValue("expiresAt", request.ExpiresAt.Value.UtcDateTime);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        var tripKeys = new Dictionary<Guid, Guid>();
        foreach (var trip in trips)
        {
            var tripKey = Guid.NewGuid();
            tripKeys[trip.Id] = tripKey;
            await using var command = new NpgsqlCommand("""
                insert into telemetry_share_trips
                  (share_id, source_trip_id, trip_key, display_order, started_at,
                   ended_at, duration_seconds, distance_meters, summary_snapshot)
                values (@shareId, @sourceTripId, @tripKey, @displayOrder, @startedAt,
                        @endedAt, @durationSeconds, @distanceMeters, '{}'::jsonb)
                """, connection, transaction);
            command.Parameters.AddWithValue("shareId", shareId);
            command.Parameters.AddWithValue("sourceTripId", trip.Id);
            command.Parameters.AddWithValue("tripKey", tripKey);
            command.Parameters.AddWithValue("displayOrder", trip.DisplayOrder);
            command.Parameters.AddWithValue("startedAt", trip.StartedAt.UtcDateTime);
            command.Parameters.AddWithValue("endedAt", trip.EndedAt.UtcDateTime);
            command.Parameters.AddWithValue("durationSeconds", (object?)trip.DurationSeconds ?? DBNull.Value);
            command.Parameters.AddWithValue("distanceMeters", (object?)trip.DistanceMeters ?? DBNull.Value);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var series in request.Series.OrderBy(series => series.DisplayOrder))
        {
            await using var command = new NpgsqlCommand("""
                insert into telemetry_share_series
                  (share_id, field_key, label_snapshot, unit_snapshot, color, display_order)
                values (@shareId, @fieldKey, @label, @unit, @color, @displayOrder)
                """, connection, transaction);
            command.Parameters.AddWithValue("shareId", shareId);
            command.Parameters.AddWithValue("fieldKey", series.FieldKey);
            command.Parameters.AddWithValue("label", series.Label?.Trim() is { Length: > 0 } label ? label : series.FieldKey);
            command.Parameters.AddWithValue("unit", (object?)series.Unit ?? DBNull.Value);
            command.Parameters.AddWithValue("color", series.Color!);
            command.Parameters.AddWithValue("displayOrder", series.DisplayOrder);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var pair in pointsByTrip)
        {
            var trip = trips.First(trip => trip.Id == pair.Key);
            var tripKey = tripKeys[pair.Key];
            var pointIndex = 0;
            foreach (var point in pair.Value)
            {
                if (point.OccurredAt < trip.StartedAt.AddMinutes(-1) || point.OccurredAt > trip.EndedAt.AddMinutes(1)) continue;
                var safeValues = point.Values
                    .Where(value => request.FieldKeys.Contains(value.Key, StringComparer.Ordinal)
                        && value.Value.ValueKind == JsonValueKind.Number
                        && value.Value.TryGetDouble(out var number)
                        && double.IsFinite(number))
                    .ToDictionary(value => value.Key, value => value.Value);
                if (safeValues.Count == 0) continue;
                await using var command = new NpgsqlCommand("""
                    insert into telemetry_share_points
                      (share_id, trip_key, point_index, occurred_at, elapsed_milliseconds, point_values)
                    values (@shareId, @tripKey, @pointIndex, @occurredAt, @elapsedMilliseconds, cast(@pointValues as jsonb))
                    """, connection, transaction);
                command.Parameters.AddWithValue("shareId", shareId);
                command.Parameters.AddWithValue("tripKey", tripKey);
                command.Parameters.AddWithValue("pointIndex", pointIndex++);
                command.Parameters.AddWithValue("occurredAt", point.OccurredAt.UtcDateTime);
                command.Parameters.AddWithValue("elapsedMilliseconds", Math.Max(0, point.ElapsedMilliseconds));
                command.Parameters.AddWithValue("pointValues", JsonSerializer.Serialize(safeValues));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        await using (var audit = new NpgsqlCommand("insert into telemetry_share_audit (share_id, actor_user_id, action) values (@shareId, @actorId, 'created')", connection, transaction))
        {
            audit.Parameters.AddWithValue("shareId", shareId);
            audit.Parameters.AddWithValue("actorId", actor.UserId);
            await audit.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(new
        {
            shareId,
            token = token.RawToken,
            path = $"/shared/telemetry/{token.RawToken}",
            mode = request.Mode,
            tripCount = trips.Count,
            pointCount = totalPointCount,
            expiresAt = request.ExpiresAt,
            allowExport = request.AllowExport,
        });
    }

    private static async Task<IResult> ListAsync(
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var actor = await FindActorAsync(dataSource, authOptions, context, cancellationToken);
        if (actor is null) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select s.id, s.mode, s.title, s.vehicle_label_snapshot, s.from_utc,
                   s.through_utc, s.allow_export, s.status, s.expires_at,
                   s.created_at, s.last_accessed_at, s.access_count,
                   count(distinct st.trip_key), count(sp.point_index), count(distinct ss.field_key)
            from telemetry_shares s
            left join telemetry_share_trips st on st.share_id = s.id
            left join telemetry_share_points sp on sp.share_id = s.id and sp.trip_key = st.trip_key
            left join telemetry_share_series ss on ss.share_id = s.id
            where @isAdmin or s.owner_user_id = @ownerId
            group by s.id
            order by s.created_at desc
            """, connection);
        command.Parameters.AddWithValue("isAdmin", actor.IsAdmin);
        command.Parameters.AddWithValue("ownerId", actor.UserId);
        var rows = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new
            {
                shareId = reader.GetGuid(0), mode = reader.GetString(1), title = reader.IsDBNull(2) ? null : reader.GetString(2),
                vehicle = reader.GetString(3), fromUtc = reader.GetFieldValue<DateTimeOffset>(4), throughUtc = reader.GetFieldValue<DateTimeOffset>(5),
                allowExport = reader.GetBoolean(6), status = reader.GetString(7), expiresAt = reader.GetFieldValue<DateTimeOffset>(8),
                createdAt = reader.GetFieldValue<DateTimeOffset>(9), lastAccessedAt = reader.IsDBNull(10) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(10),
                accessCount = reader.GetInt64(11), tripCount = reader.GetInt64(12), pointCount = reader.GetInt64(13), fieldCount = reader.GetInt64(14),
            });
        }
        return Results.Ok(rows);
    }

    private static async Task<IResult> RotateAsync(
        Guid shareId,
        NpgsqlDataSource dataSource,
        TelemetryShareTokenService tokenService,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var actor = await FindActorAsync(dataSource, authOptions, context, cancellationToken);
        if (actor is null) return Results.Unauthorized();
        var token = tokenService.Create();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var command = new NpgsqlCommand("update telemetry_shares set token_hash=@tokenHash, updated_at=now(), status='active', revoked_at=null where id=@shareId and (@isAdmin or owner_user_id=@ownerId) and status <> 'revoked'", connection, transaction))
        {
            command.Parameters.Add("tokenHash", NpgsqlDbType.Bytea).Value = token.Hash;
            command.Parameters.AddWithValue("shareId", shareId);
            command.Parameters.AddWithValue("isAdmin", actor.IsAdmin);
            command.Parameters.AddWithValue("ownerId", actor.UserId);
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return Results.NotFound();
        }
        await using (var audit = new NpgsqlCommand("insert into telemetry_share_audit (share_id, actor_user_id, action) values (@shareId, @actorId, 'token_rotated')", connection, transaction))
        {
            audit.Parameters.AddWithValue("shareId", shareId);
            audit.Parameters.AddWithValue("actorId", actor.UserId);
            await audit.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(new { shareId, token = token.RawToken, path = $"/shared/telemetry/{token.RawToken}" });
    }

    private static async Task<IResult> RevokeAsync(
        Guid shareId,
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var actor = await FindActorAsync(dataSource, authOptions, context, cancellationToken);
        if (actor is null) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var command = new NpgsqlCommand("update telemetry_shares set status='revoked', revoked_at=now(), updated_at=now() where id=@shareId and (@isAdmin or owner_user_id=@ownerId) and status <> 'revoked'", connection, transaction))
        {
            command.Parameters.AddWithValue("shareId", shareId);
            command.Parameters.AddWithValue("isAdmin", actor.IsAdmin);
            command.Parameters.AddWithValue("ownerId", actor.UserId);
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return Results.NotFound();
        }
        await using (var audit = new NpgsqlCommand("insert into telemetry_share_audit (share_id, actor_user_id, action) values (@shareId, @actorId, 'revoked')", connection, transaction))
        {
            audit.Parameters.AddWithValue("shareId", shareId);
            audit.Parameters.AddWithValue("actorId", actor.UserId);
            await audit.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> EnableAsync(
        Guid shareId,
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var actor = await FindActorAsync(dataSource, authOptions, context, cancellationToken);
        if (actor is null) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var command = new NpgsqlCommand("update telemetry_shares set updated_at=now(), status='active', revoked_at=null where id=@shareId and (@isAdmin or owner_user_id=@ownerId) and status='revoked' and expires_at > now()", connection, transaction))
        {
            command.Parameters.AddWithValue("shareId", shareId);
            command.Parameters.AddWithValue("isAdmin", actor.IsAdmin);
            command.Parameters.AddWithValue("ownerId", actor.UserId);
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return Results.NotFound();
        }
        await using (var audit = new NpgsqlCommand("insert into telemetry_share_audit (share_id, actor_user_id, action) values (@shareId, @actorId, 'enabled')", connection, transaction))
        {
            audit.Parameters.AddWithValue("shareId", shareId);
            audit.Parameters.AddWithValue("actorId", actor.UserId);
            await audit.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> UpdateExpirationAsync(
        Guid shareId,
        TelemetryShareExpirationRequest request,
        NpgsqlDataSource dataSource,
        TraccarScopeApiAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var actor = await FindActorAsync(dataSource, authOptions, context, cancellationToken);
        if (actor is null) return Results.Unauthorized();
        if (request.ExpiresAt is null || request.ExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(5) || request.ExpiresAt > DateTimeOffset.UtcNow.AddDays(90))
            return Results.BadRequest("Expiration must be between five minutes and 90 days from now.");

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var command = new NpgsqlCommand("""
            update telemetry_shares
            set expires_at=@expiresAt, updated_at=now(),
                status=case when status='expired' then 'active' else status end
            where id=@shareId and (@isAdmin or owner_user_id=@ownerId)
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("expiresAt", request.ExpiresAt.Value.UtcDateTime);
            command.Parameters.AddWithValue("shareId", shareId);
            command.Parameters.AddWithValue("isAdmin", actor.IsAdmin);
            command.Parameters.AddWithValue("ownerId", actor.UserId);
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return Results.NotFound();
        }
        await using (var audit = new NpgsqlCommand("insert into telemetry_share_audit (share_id, actor_user_id, action) values (@shareId, @actorId, 'expiration_updated')", connection, transaction))
        {
            audit.Parameters.AddWithValue("shareId", shareId);
            audit.Parameters.AddWithValue("actorId", actor.UserId);
            await audit.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<List<ShareTrip>> LoadTripsAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, TelemetryShareCreateRequest request, Guid vehicleId, Actor actor, CancellationToken cancellationToken)
    {
        var byId = request.TripIds is { Count: > 0 };
        var sql = $"""
            select t.id, v.display_name, t.started_at, t.ended_at, t.duration_seconds, t.distance_meters
            from trips t join vehicles v on v.id=t.vehicle_id
            where t.vehicle_id=@vehicleId
              and t.started_at >= @fromUtc and t.started_at < @throughUtc
              {(byId ? "and t.id = any(@tripIds)" : string.Empty)}
              and (@isAdmin or exists (select 1 from app_user_vehicle_access ua where ua.vehicle_id=t.vehicle_id and ua.user_id=@ownerId)
                   or exists (select 1 from app_group_vehicle_access ga join app_group_memberships gm on gm.group_id=ga.group_id where ga.vehicle_id=t.vehicle_id and gm.user_id=@ownerId))
            order by t.started_at
            limit 500
            """;
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("vehicleId", vehicleId);
        command.Parameters.AddWithValue("fromUtc", request.FromUtc!.Value.UtcDateTime);
        command.Parameters.AddWithValue("throughUtc", request.ThroughUtc!.Value.UtcDateTime);
        command.Parameters.AddWithValue("isAdmin", actor.IsAdmin);
        command.Parameters.AddWithValue("ownerId", actor.UserId);
        if (byId) command.Parameters.Add("tripIds", NpgsqlDbType.Array | NpgsqlDbType.Uuid).Value = request.TripIds!.ToArray();
        var rows = new List<ShareTrip>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var order = 0;
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new ShareTrip(reader.GetGuid(0), reader.GetString(1), reader.GetFieldValue<DateTimeOffset>(2), reader.GetFieldValue<DateTimeOffset>(3), reader.IsDBNull(4) ? null : reader.GetInt32(4), reader.IsDBNull(5) ? null : reader.GetDouble(5), order++));
        }
        return rows;
    }

    private static async Task<Actor?> FindActorAsync(NpgsqlDataSource dataSource, TraccarScopeApiAuthOptions options, HttpContext context, CancellationToken cancellationToken)
    {
        if (!options.Enabled) return null;
        var username = context.User.Identity?.Name;
        if (string.IsNullOrWhiteSpace(username)) return null;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select id, role from app_users where username=@username and active", connection);
        command.Parameters.AddWithValue("username", username);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? new Actor(reader.GetGuid(0), string.Equals(reader.GetString(1), "admin", StringComparison.OrdinalIgnoreCase)) : null;
    }

    private sealed record Actor(Guid UserId, bool IsAdmin);
    private sealed record ShareTrip(Guid Id, string VehicleName, DateTimeOffset StartedAt, DateTimeOffset EndedAt, int? DurationSeconds, double? DistanceMeters, int DisplayOrder);
}

public sealed record TelemetryShareCreateRequest(
    string Mode,
    string VehicleId,
    IReadOnlyList<Guid>? TripIds,
    DateTimeOffset? FromUtc,
    DateTimeOffset? ThroughUtc,
    string? TimeZone,
    IReadOnlyList<string>? FieldKeys,
    IReadOnlyList<TelemetryShareSeriesRequest>? Series,
    IReadOnlyList<TelemetrySharePointRequest>? Points,
    string? Title,
    string? Message,
    bool AllowExport,
    DateTimeOffset? ExpiresAt);

public sealed record TelemetryShareExpirationRequest(DateTimeOffset? ExpiresAt);

public sealed record TelemetryShareSeriesRequest(string FieldKey, string? Label, string? Unit, string? Color, int DisplayOrder);

public sealed record TelemetrySharePointRequest(Guid TripId, DateTimeOffset OccurredAt, long ElapsedMilliseconds, Dictionary<string, JsonElement> Values);

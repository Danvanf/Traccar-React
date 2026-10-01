using Npgsql;
using NpgsqlTypes;

public static class TripIdentityEndpoints
{
    public static void MapTripIdentityEndpoints(this WebApplication app)
    {
        app.MapGet("/api/trips/resolve", ResolveAsync)
            .WithName("ResolveTripIdentity")
            .WithSummary("Resolves one exact persisted trip without guessing or consulting current bindings.");
    }

    private static async Task<IResult> ResolveAsync(
        int traccarDeviceId, DateTimeOffset startedAt, DateTimeOffset endedAt,
        long? startTraccarPositionId, long? endTraccarPositionId,
        NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (traccarDeviceId <= 0 || endedAt < startedAt
            || startTraccarPositionId is <= 0 || endTraccarPositionId is <= 0)
            return TypedResults.BadRequest("A valid device, ordered trip timestamps, and positive position IDs are required.");

        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand(
                """
                select id, vehicle_id, traccar_device_id, started_at, ended_at,
                       start_traccar_position_id, end_traccar_position_id, notes, derivation_version, max_speed_mph
                from trips
                where traccar_device_id = @deviceId
                  and ((started_at = @startedAt and ended_at = @endedAt)
                       or (cast(@startPositionId as bigint) is not null and cast(@endPositionId as bigint) is not null
                           and start_traccar_position_id = cast(@startPositionId as bigint)
                           and end_traccar_position_id = cast(@endPositionId as bigint)))
                  and traccar_source_id is null
                limit 2
                """, connection);
            command.Parameters.AddWithValue("deviceId", traccarDeviceId);
            command.Parameters.AddWithValue("startedAt", startedAt.UtcDateTime);
            command.Parameters.AddWithValue("endedAt", endedAt.UtcDateTime);
            command.Parameters.Add("startPositionId", NpgsqlDbType.Bigint).Value = (object?)startTraccarPositionId ?? DBNull.Value;
            command.Parameters.Add("endPositionId", NpgsqlDbType.Bigint).Value = (object?)endTraccarPositionId ?? DBNull.Value;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var candidates = new List<SavedTripIdentity>();
            while (await reader.ReadAsync(cancellationToken))
                candidates.Add(new SavedTripIdentity(
                    reader.GetGuid(0), reader.GetGuid(1), reader.GetInt32(2),
                    reader.GetFieldValue<DateTimeOffset>(3), reader.GetFieldValue<DateTimeOffset>(4),
                    reader.IsDBNull(5) ? null : reader.GetInt64(5),
                    reader.IsDBNull(6) ? null : reader.GetInt64(6),
                    reader.IsDBNull(7) ? null : reader.GetString(7),
                    reader.IsDBNull(8) ? null : reader.GetString(8),
                    reader.IsDBNull(9) ? null : reader.GetDouble(9)));

            var result = TripIdentity.Resolve(candidates, traccarDeviceId, startedAt, endedAt,
                startTraccarPositionId, endTraccarPositionId);
            return result.Status switch
            {
                TripIdentityStatus.Found => TypedResults.Ok(result.Trip),
                TripIdentityStatus.Ambiguous => TypedResults.Problem(
                    statusCode: StatusCodes.Status409Conflict,
                    title: "Multiple saved trips match this selection",
                    detail: "Editing is disabled until duplicate trip records are reconciled."),
                _ => TypedResults.Problem(
                    statusCode: StatusCodes.Status404NotFound,
                    title: "No exact saved trip matches this selection",
                    detail: "Import this trip's range first. Partial or recalculated trips may have different boundaries; editing is disabled until an exact match exists."),
            };
        }
        catch (PostgresException ex) when (ex.SqlState == "42P01")
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Trip storage is unavailable", detail: "Apply the Phase 3 schema before resolving trips.");
        }
    }
}

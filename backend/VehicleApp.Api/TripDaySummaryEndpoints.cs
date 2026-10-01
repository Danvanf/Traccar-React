using Npgsql;

public static class TripDaySummaryEndpoints
{
    public static void MapTripDaySummaryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/trips/day-summaries-all", GetAsync)
            .WithName("GetAllTripDaySummaries")
            .WithSummary("Returns lightweight saved-trip metadata for history navigation.");
    }

    private static async Task<IResult> GetAsync(
        DateTimeOffset? from, DateTimeOffset? to, Guid? vehicleId,
        NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (from.HasValue && to.HasValue && to < from)
            return TypedResults.BadRequest("to must be on or after from.");

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select id, vehicle_id, traccar_device_id, started_at, ended_at,
                   duration_seconds, distance_meters, max_speed_mph,
                   (select count(*) from trip_events e where e.trip_id = trips.id) as event_count,
                   start_traccar_position_id, end_traccar_position_id,
                   start_latitude, start_longitude, end_latitude, end_longitude,
                   start_address, end_address
            from trips
            where (cast(@from as timestamptz) is null or ended_at >= cast(@from as timestamptz))
              and (cast(@to as timestamptz) is null or started_at <= cast(@to as timestamptz))
              and (cast(@vehicleId as uuid) is null or vehicle_id = cast(@vehicleId as uuid))
            order by started_at desc
            limit 10000
            """, connection);
        command.Parameters.AddWithValue("from", (object?)from?.UtcDateTime ?? DBNull.Value);
        command.Parameters.AddWithValue("to", (object?)to?.UtcDateTime ?? DBNull.Value);
        command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value);

        var rows = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(new
            {
                id = reader.GetGuid(0),
                vehicleId = reader.GetGuid(1),
                traccarDeviceId = reader.GetInt32(2),
                startedAt = reader.GetFieldValue<DateTimeOffset>(3),
                endedAt = reader.GetFieldValue<DateTimeOffset>(4),
                durationSeconds = reader.GetInt32(5),
                distanceMeters = reader.GetDouble(6),
                maxSpeedMph = reader.IsDBNull(7) ? (double?)null : reader.GetDouble(7),
                eventCount = reader.GetInt64(8),
                startTraccarPositionId = reader.IsDBNull(9) ? (long?)null : reader.GetInt64(9),
                endTraccarPositionId = reader.IsDBNull(10) ? (long?)null : reader.GetInt64(10),
                startLatitude = reader.IsDBNull(11) ? (double?)null : reader.GetDouble(11),
                startLongitude = reader.IsDBNull(12) ? (double?)null : reader.GetDouble(12),
                endLatitude = reader.IsDBNull(13) ? (double?)null : reader.GetDouble(13),
                endLongitude = reader.IsDBNull(14) ? (double?)null : reader.GetDouble(14),
                startAddress = reader.IsDBNull(15) ? null : reader.GetString(15),
                endAddress = reader.IsDBNull(16) ? null : reader.GetString(16),
            });
        return TypedResults.Ok(rows);
    }
}

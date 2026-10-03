using Npgsql;

public static class TripDaySummaryEndpoints
{
    public static void MapTripDaySummaryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/trips/history-span", GetHistorySpanAsync)
            .WithName("GetTripHistorySpan")
            .WithSummary("Returns the earliest and latest saved trip timestamps.");

        app.MapGet("/api/trips/history-month-summaries", GetHistoryMonthSummariesAsync)
            .WithName("GetTripHistoryMonthSummaries")
            .WithSummary("Returns month-level active-day coverage for lazy history navigation.");

        app.MapGet("/api/trips/day-summaries-all", GetAsync)
            .WithName("GetAllTripDaySummaries")
            .WithSummary("Returns lightweight saved-trip metadata for history navigation.");
    }

    private static async Task<IResult> GetHistorySpanAsync(
        Guid? vehicleId,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select min(started_at) as earliest_started_at,
                   max(ended_at) as latest_ended_at,
                   count(*)::bigint as trip_count
            from trips
            where (cast(@vehicleId as uuid) is null or vehicle_id = cast(@vehicleId as uuid))
            """, connection);
        command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return TypedResults.Ok(new
        {
            earliestStartedAt = reader.IsDBNull(0) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(0),
            latestEndedAt = reader.IsDBNull(1) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(1),
            tripCount = reader.IsDBNull(2) ? 0L : reader.GetInt64(2),
        });
    }

    private static async Task<IResult> GetHistoryMonthSummariesAsync(
        Guid? vehicleId,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select to_char(date_trunc('month', started_at at time zone 'UTC'), 'YYYY-MM') as month_key,
                   count(distinct date_trunc('day', started_at at time zone 'UTC'))::int as active_day_count,
                   count(*)::int as trip_count
            from trips
            where (cast(@vehicleId as uuid) is null or vehicle_id = cast(@vehicleId as uuid))
            group by 1
            order by 1 desc
            """, connection);
        command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value);

        var rows = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new
            {
                monthKey = reader.GetString(0),
                activeDayCount = reader.GetInt32(1),
                tripCount = reader.GetInt32(2),
            });
        }

        return TypedResults.Ok(rows);
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

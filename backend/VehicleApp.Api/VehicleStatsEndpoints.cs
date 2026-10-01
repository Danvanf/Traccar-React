using Npgsql;

public static class VehicleStatsEndpoints
{
    public static void MapVehicleStatsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/vehicles/{vehicleId:guid}/stats", async (Guid vehicleId, DateTimeOffset? from, DateTimeOffset? to, string? groupBy, Guid? tagId, NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            var start = from ?? DateTimeOffset.UtcNow.AddDays(-30);
            var end = to ?? DateTimeOffset.UtcNow;
            var grouping = groupBy?.ToLowerInvariant() switch { "day" => "day", "week" => "week", _ => "trip" };
            // Group trips by identity, but return their start timestamp for display.
            var groupingBucket = grouping == "trip" ? "t.id" : $"date_trunc('{grouping}', t.started_at)";
            var periodExpression = grouping == "trip" ? "t.started_at" : groupingBucket;
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand($"""
                select {periodExpression} as period, count(*)::int as trip_count,
                       coalesce(sum(t.distance_meters), 0)::double precision as distance_meters,
                       coalesce(sum(t.duration_seconds), 0)::bigint as duration_seconds,
                       coalesce(avg(t.distance_meters), 0)::double precision as average_distance_meters,
                       coalesce(avg(t.duration_seconds), 0)::double precision as average_duration_seconds,
                       coalesce(max(t.max_speed_mph), 0)::double precision as max_speed_mph,
                       count(e.id)::int as event_count
                from trips t left join trip_events e on e.trip_id = t.id
                where t.vehicle_id = @vehicleId and t.started_at >= @from and t.started_at <= @to
                  and (cast(@tagId as uuid) is null or exists (select 1 from trip_tag_map tm where tm.trip_id = t.id and tm.tag_id = cast(@tagId as uuid)))
                group by {groupingBucket} order by period desc
                """, connection);
            command.Parameters.AddWithValue("vehicleId", vehicleId);
            command.Parameters.AddWithValue("from", start.UtcDateTime);
            command.Parameters.AddWithValue("to", end.UtcDateTime);
            command.Parameters.AddWithValue("tagId", (object?)tagId ?? DBNull.Value);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var rows = new List<object>();
            while (await reader.ReadAsync(cancellationToken)) rows.Add(new { period = reader.GetValue(0), tripCount = reader.GetInt32(1), distanceMeters = reader.GetDouble(2), durationSeconds = reader.GetInt64(3), averageDistanceMeters = reader.GetDouble(4), averageDurationSeconds = reader.GetDouble(5), maxSpeedMph = reader.GetDouble(6), eventCount = reader.GetInt32(7) });
            return Results.Ok(new { vehicleId, from = start, to = end, groupBy = grouping, rows });
        });
    }
}

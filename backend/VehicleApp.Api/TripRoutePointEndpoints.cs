using Npgsql;

public static class TripRoutePointEndpoints
{
    public static void MapTripRoutePointEndpoints(this WebApplication app)
    {
        app.MapGet("/api/trips/{tripId:guid}/route-points", GetAsync)
            .WithName("GetTripRoutePoints")
            .WithSummary("Returns persisted route geometry for an imported trip.");
    }

    private static async Task<IResult> GetAsync(Guid tripId, NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken)
    {
        if (!await VehicleAccess.CanReadTripAsync(tripId, dataSource, authOptions, context, cancellationToken)) return TypedResults.Forbid();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select point_index, occurred_at, latitude, longitude, speed_mph
            from trip_route_points
            where trip_id = @tripId
            order by point_index
            """, connection);
        command.Parameters.AddWithValue("tripId", tripId);
        var points = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            points.Add(new
            {
                pointIndex = reader.GetInt32(0),
                occurredAt = reader.IsDBNull(1) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(1),
                latitude = reader.GetDouble(2),
                longitude = reader.GetDouble(3),
                speedMph = reader.IsDBNull(4) ? (double?)null : reader.GetDouble(4),
            });
        return TypedResults.Ok(points);
    }
}

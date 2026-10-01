using Npgsql;

public static class TripRecalculationEndpoints
{
    public static void MapTripRecalculationEndpoints(this WebApplication app)
    {
        app.MapPost("/api/trips/{tripId:guid}/recalculate", RecalculateAsync)
            .WithName("RecalculateTrip")
            .WithSummary("Recalculates derived trip metrics while preserving annotations and identity.");
    }

    private static async Task<IResult> RecalculateAsync(
        Guid tripId,
        RecalculateTripRequest request,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.DerivationVersion))
            return TypedResults.BadRequest("derivationVersion is required.");
        if (request.DurationSeconds <= 0 || !double.IsFinite(request.DistanceMeters) || request.DistanceMeters < 0)
            return TypedResults.BadRequest("durationSeconds must be positive and distanceMeters must be finite and nonnegative.");

        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using var command = new NpgsqlCommand(
                """
                update trips
                set duration_seconds = @durationSeconds,
                    distance_meters = @distanceMeters,
                    avg_speed_mph = @avgSpeedMph,
                    max_speed_mph = @maxSpeedMph,
                    idle_seconds = @idleSeconds,
                    fuel_used_gallons = @fuelUsedGallons,
                    estimated_mpg = @estimatedMpg,
                    start_traccar_position_id = coalesce(@startPositionId, start_traccar_position_id),
                    end_traccar_position_id = coalesce(@endPositionId, end_traccar_position_id),
                    derivation_version = @derivationVersion
                where id = @tripId
                returning id, vehicle_id, started_at, ended_at, notes, derivation_version
                """, connection, transaction);
            command.Parameters.AddWithValue("tripId", tripId);
            command.Parameters.AddWithValue("durationSeconds", request.DurationSeconds);
            command.Parameters.AddWithValue("distanceMeters", request.DistanceMeters);
            command.Parameters.AddWithValue("avgSpeedMph", (object?)request.AvgSpeedMph ?? DBNull.Value);
            command.Parameters.AddWithValue("maxSpeedMph", (object?)request.MaxSpeedMph ?? DBNull.Value);
            command.Parameters.AddWithValue("idleSeconds", (object?)request.IdleSeconds ?? DBNull.Value);
            command.Parameters.AddWithValue("fuelUsedGallons", (object?)request.FuelUsedGallons ?? DBNull.Value);
            command.Parameters.AddWithValue("estimatedMpg", (object?)request.EstimatedMpg ?? DBNull.Value);
            command.Parameters.AddWithValue("startPositionId", (object?)request.StartTraccarPositionId ?? DBNull.Value);
            command.Parameters.AddWithValue("endPositionId", (object?)request.EndTraccarPositionId ?? DBNull.Value);
            command.Parameters.AddWithValue("derivationVersion", request.DerivationVersion.Trim());

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                return TypedResults.NotFound($"Trip {tripId} was not found.");
            var response = new RecalculatedTripResponse(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetFieldValue<DateTimeOffset>(2),
                reader.GetFieldValue<DateTimeOffset>(3), reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetString(5));
            await reader.DisposeAsync();
            await transaction.CommitAsync(cancellationToken);
            return TypedResults.Ok(response);
        }
        catch (PostgresException ex) when (ex.SqlState == "42703")
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Trip provenance schema is unavailable",
                detail: "Apply phase5_trip_derivation_schema.sql before recalculating trips.");
        }
        catch (PostgresException ex) when (ex.SqlState == "42P01")
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Trip storage is unavailable", detail: "Apply the Phase 3 schema before recalculating trips.");
        }
    }
}

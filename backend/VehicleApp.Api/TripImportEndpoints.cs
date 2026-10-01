using System.Data;
using Npgsql;

public static class TripImportEndpoints
{
    public static void MapTripImportEndpoints(this WebApplication app)
    {
        app.MapPost("/api/trips/import-by-device", ImportAsync)
            .WithName("ImportTripsByDevice")
            .WithSummary("Atomically imports non-overlapping trips and preserves exact retries.");
    }

    public static async Task<IResult> ImportAsync(ImportTripsByDeviceRequest request,
        NpgsqlDataSource dataSource, ILoggerFactory loggerFactory, CancellationToken cancellationToken)
    {
        if (request.TraccarDeviceId <= 0 || request.TraccarDeviceId > int.MaxValue)
            return TypedResults.BadRequest("traccarDeviceId must be a positive 32-bit integer.");
        if (request.Trips is null || request.Trips.Count == 0 || request.Trips.Count > 5000)
            return TypedResults.BadRequest("trips must contain between 1 and 5000 items.");
        if (request.Trips.Any(trip => trip is null || trip.EndedAt <= trip.StartedAt
            || trip.DurationSeconds <= 0 || !double.IsFinite(trip.DistanceMeters) || trip.DistanceMeters < 0
            || trip.StartTraccarPositionId is <= 0 || trip.EndTraccarPositionId is <= 0))
            return TypedResults.BadRequest("Trips require increasing timestamps, positive duration, nonnegative finite distance, and positive source IDs when supplied.");

        var traccarDeviceId = (int)request.TraccarDeviceId;
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            // A fresh snapshot after waiting for the device lock must see the prior import's commit.
            await using var tx = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
            await using (var deviceLock = new NpgsqlCommand(
                "select pg_advisory_xact_lock(724103, @deviceId)", connection, tx))
            {
                deviceLock.Parameters.AddWithValue("deviceId", traccarDeviceId);
                await deviceLock.ExecuteNonQueryAsync(cancellationToken);
            }

            var results = new List<ImportedTripIdentity>();
            var imported = 0;
            var skipped = 0;
            foreach (var trip in request.Trips)
            {
                // Check across vehicles: changing the current binding must not duplicate old trips.
                // Null source is the single-source namespace used by current import contracts.
                var candidates = new List<SavedTripIdentity>();
                await using (var existing = new NpgsqlCommand(
                    """
                    select id, vehicle_id, traccar_device_id, started_at, ended_at,
                           start_traccar_position_id, end_traccar_position_id, notes, max_speed_mph
                    from trips
                    where traccar_device_id = @deviceId and traccar_source_id is null
                      and ((started_at < @endedAt and ended_at > @startedAt)
                           or (started_at = @startedAt and ended_at = @endedAt))
                    order by started_at, id
                    limit 2
                    for update
                    """, connection, tx))
                {
                    existing.Parameters.AddWithValue("deviceId", traccarDeviceId);
                    existing.Parameters.AddWithValue("startedAt", trip.StartedAt.UtcDateTime);
                    existing.Parameters.AddWithValue("endedAt", trip.EndedAt.UtcDateTime);
                    await using var reader = await existing.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                        candidates.Add(new SavedTripIdentity(reader.GetGuid(0), reader.GetGuid(1), reader.GetInt32(2),
                            reader.GetFieldValue<DateTimeOffset>(3), reader.GetFieldValue<DateTimeOffset>(4),
                            reader.IsDBNull(5) ? null : reader.GetInt64(5),
                            reader.IsDBNull(6) ? null : reader.GetInt64(6),
                            reader.IsDBNull(7) ? null : reader.GetString(7),
                            null,
                            reader.IsDBNull(8) ? null : reader.GetDouble(8)));
                }

                if (candidates.Count > 0)
                {
                    var match = TripIdentity.Resolve(candidates, traccarDeviceId, trip.StartedAt, trip.EndedAt,
                        trip.StartTraccarPositionId, trip.EndTraccarPositionId);
                    if (candidates.Count != 1 || (match.Status != TripIdentityStatus.Found && !request.TreatOverlappingAsExisting))
                        return TypedResults.Problem(statusCode: StatusCodes.Status409Conflict,
                            title: "Trip import conflicts with saved history",
                            detail: $"The trip starting {trip.StartedAt:O} overlaps saved history or has conflicting source IDs. No trips in this batch were saved. Existing notes and tags were preserved. Reuse the original range and movement threshold; changed trip boundaries require reconciliation.",
                            extensions: new Dictionary<string, object?> {
                                ["code"] = "trip_import_conflict",
                                ["conflictingTripIds"] = candidates.Select(row => row.Id).ToArray(),
                                ["startedAt"] = trip.StartedAt, ["endedAt"] = trip.EndedAt,
                            });
                    var saved = match.Trip ?? (request.TreatOverlappingAsExisting ? candidates[0] : null);
                    if (saved is null)
                        return TypedResults.Problem(statusCode: StatusCodes.Status409Conflict,
                            title: "Trip import conflicts with saved history",
                            detail: "The trip overlaps saved history and could not be identified safely.");
                    results.Add(new(saved.Id, saved.VehicleId, saved.StartedAt, saved.EndedAt, "existing"));
                    skipped++;
                    continue; // Never overwrite metrics, notes, tags, or legacy source IDs on replay.
                }

                Guid vehicleId;
                await using (var binding = new NpgsqlCommand(
                    """
                    select vehicle_id
                    from vehicle_device_bindings
                    where traccar_device_id = @deviceId
                      and (traccar_source_id is null)
                      and starts_at <= @startedAt
                      and (ends_at is null or ends_at >= @endedAt)
                    order by starts_at desc
                    limit 2
                    for share
                    """, connection, tx))
                {
                    binding.Parameters.AddWithValue("deviceId", traccarDeviceId);
                    binding.Parameters.AddWithValue("startedAt", trip.StartedAt.UtcDateTime);
                    binding.Parameters.AddWithValue("endedAt", trip.EndedAt.UtcDateTime);
                    await using var reader = await binding.ExecuteReaderAsync(cancellationToken);
                    if (!await reader.ReadAsync(cancellationToken))
                        return TypedResults.Conflict($"No complete vehicle binding covers trip {trip.StartedAt:O} to {trip.EndedAt:O}. Set an Effective From date for the device assignment and retry.");
                    vehicleId = reader.GetGuid(0);
                    if (await reader.ReadAsync(cancellationToken))
                        return TypedResults.Conflict($"Multiple vehicle bindings cover trip {trip.StartedAt:O} to {trip.EndedAt:O}. Resolve binding history before importing.");
                }
                await using var insertCommand = new NpgsqlCommand(
                    """
                    insert into trips (
                      vehicle_id,
                      traccar_device_id,
                      started_at,
                      ended_at,
                      duration_seconds,
                      distance_meters,
                      avg_speed_mph,
                      max_speed_mph,
                      idle_seconds,
                      fuel_used_gallons,
                      estimated_mpg,
                      start_traccar_position_id,
                      end_traccar_position_id,
                      start_label,
                      end_label,
                      notes,
                      derivation_version
                    ) values (
                      @vehicleId,
                      @traccarDeviceId,
                      @startedAt,
                      @endedAt,
                      @durationSeconds,
                      @distanceMeters,
                      @avgSpeedMph,
                      @maxSpeedMph,
                      @idleSeconds,
                      @fuelUsedGallons,
                      @estimatedMpg,
                      @startTraccarPositionId,
                      @endTraccarPositionId,
                      @startLabel,
                      @endLabel,
                      @notes,
                      @derivationVersion
                    )
                    returning id
                    """, connection, tx);

                insertCommand.Parameters.AddWithValue("vehicleId", vehicleId);
                insertCommand.Parameters.AddWithValue("traccarDeviceId", traccarDeviceId);
                insertCommand.Parameters.AddWithValue("startedAt", trip.StartedAt.UtcDateTime);
                insertCommand.Parameters.AddWithValue("endedAt", trip.EndedAt.UtcDateTime);
                insertCommand.Parameters.AddWithValue("durationSeconds", trip.DurationSeconds);
                insertCommand.Parameters.AddWithValue("distanceMeters", trip.DistanceMeters);
                insertCommand.Parameters.AddWithValue("avgSpeedMph", (object?)trip.AvgSpeedMph ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("maxSpeedMph", (object?)trip.MaxSpeedMph ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("idleSeconds", (object?)trip.IdleSeconds ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("fuelUsedGallons", (object?)trip.FuelUsedGallons ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("estimatedMpg", (object?)trip.EstimatedMpg ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("startTraccarPositionId", (object?)trip.StartTraccarPositionId ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("endTraccarPositionId", (object?)trip.EndTraccarPositionId ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("startLabel", (object?)trip.StartLabel ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("endLabel", (object?)trip.EndLabel ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("notes", (object?)trip.Notes ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("derivationVersion", (object?)request.DerivationVersion ?? DBNull.Value);

                var insertedId = (Guid)(await insertCommand.ExecuteScalarAsync(cancellationToken))!;
                imported++;
                results.Add(new(insertedId, vehicleId, trip.StartedAt, trip.EndedAt, "imported"));
            }
            await tx.CommitAsync(cancellationToken);
            var vehicles = results.Select(row => row.VehicleId).Distinct().ToArray();
            return TypedResults.Ok(new ImportTripsByDeviceResponse(
                vehicles.Length == 1 ? vehicles[0] : null, traccarDeviceId, imported, skipped, results));
        }
        catch (PostgresException ex) when (ex.SqlState == "42P01")
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Trip storage is unavailable", detail: "Apply the Phase 3 schema before importing trips.");
        }
        catch (PostgresException ex) when (ex.SqlState is "23505" or "23P01" or "40001" or "40P01")
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status409Conflict,
                title: "Trip import conflicted with another change",
                detail: "No trips in this batch were saved. Retry the import; existing history was preserved.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            loggerFactory.CreateLogger("TripImport").LogError(ex, "Trip import failed for device {DeviceId}", traccarDeviceId);
            return TypedResults.Problem(statusCode: StatusCodes.Status500InternalServerError,
                title: "Trip import failed", detail: "The import could not be confirmed. Retry the same batch safely, or check the API log using the request ID.");
        }
    }
}

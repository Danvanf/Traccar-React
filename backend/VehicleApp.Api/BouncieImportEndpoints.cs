using System.Text.Json;
using Npgsql;

public static class BouncieImportEndpoints
{
    public static void MapBouncieImportEndpoints(this WebApplication app)
    {
        app.MapPost("/api/trips/import-bouncie", ImportAsync)
            .WithName("ImportBouncieTrips")
            .WithSummary("Imports Bouncie trip summaries into VehicleApp with durable deduplication.");
    }

    private static async Task<IResult> ImportAsync(BouncieImportRequest request, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (request.Rows is null || request.Rows.Count == 0)
            return TypedResults.BadRequest("At least one Bouncie trip row is required.");
        try
        {
            return TypedResults.Ok(await ImportRowsAsync(request.Rows, dataSource, cancellationToken));
        }
        catch (ArgumentException ex)
        {
            return TypedResults.BadRequest(ex.Message);
        }
        catch (PostgresException ex) when (ex.SqlState == "42P01")
        {
            return TypedResults.Problem("Apply scripts/phase8_bouncie_import_schema.sql before importing Bouncie data.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    public static async Task<BouncieImportResult> ImportRowsAsync(IReadOnlyList<BouncieImportRow> rows, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (rows is null || rows.Count == 0) throw new ArgumentException("At least one Bouncie trip row is required.");

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var imported = 0;
        var skipped = 0;
        var importedEvents = 0;

        foreach (var row in rows)
        {
            if (row.VehicleId == Guid.Empty || row.StartedAt >= row.EndedAt || string.IsNullOrWhiteSpace(row.ExternalKey))
                throw new ArgumentException("Each Bouncie row requires a vehicle, external key, and valid time range.");

            Guid? existingTripId = null;
            await using (var existing = new NpgsqlCommand("select trip_id from trip_external_identities where source_system = 'bouncie' and external_key = @externalKey limit 1", connection, transaction))
            {
                existing.Parameters.AddWithValue("externalKey", row.ExternalKey);
                var value = await existing.ExecuteScalarAsync(cancellationToken);
                if (value is Guid id) { existingTripId = id; skipped++; }
            }

            Guid tripId;
            if (existingTripId.HasValue)
            {
                tripId = existingTripId.Value;
                await using var enrich = new NpgsqlCommand("""
                    update trips set
                      max_speed_mph = coalesce(max_speed_mph, @maxSpeedMph),
                      idle_seconds = coalesce(idle_seconds, @idleSeconds),
                      start_latitude = coalesce(start_latitude, @startLatitude),
                      start_longitude = coalesce(start_longitude, @startLongitude),
                      end_latitude = coalesce(end_latitude, @endLatitude),
                      end_longitude = coalesce(end_longitude, @endLongitude),
                      start_address = coalesce(start_address, @startAddress),
                      end_address = coalesce(end_address, @endAddress),
                      external_metadata = coalesce(external_metadata, '{}'::jsonb) || @externalMetadata::jsonb
                    where id = @tripId
                    """, connection, transaction);
                enrich.Parameters.AddWithValue("tripId", tripId);
                enrich.Parameters.AddWithValue("maxSpeedMph", (object?)row.MaxSpeedMph ?? DBNull.Value);
                enrich.Parameters.AddWithValue("idleSeconds", (object?)row.IdleSeconds ?? DBNull.Value);
                enrich.Parameters.AddWithValue("startLatitude", (object?)row.StartLatitude ?? DBNull.Value);
                enrich.Parameters.AddWithValue("startLongitude", (object?)row.StartLongitude ?? DBNull.Value);
                enrich.Parameters.AddWithValue("endLatitude", (object?)row.EndLatitude ?? DBNull.Value);
                enrich.Parameters.AddWithValue("endLongitude", (object?)row.EndLongitude ?? DBNull.Value);
                enrich.Parameters.AddWithValue("startAddress", (object?)row.StartAddress ?? DBNull.Value);
                enrich.Parameters.AddWithValue("endAddress", (object?)row.EndAddress ?? DBNull.Value);
                enrich.Parameters.AddWithValue("externalMetadata", JsonSerializer.Serialize(row.SourceData ?? new Dictionary<string, string?>()));
                await enrich.ExecuteNonQueryAsync(cancellationToken);
            }
            else
            {
                await using var insert = new NpgsqlCommand("""
                    insert into trips (
                      vehicle_id, traccar_device_id, started_at, ended_at, duration_seconds,
                      distance_meters, avg_speed_mph, max_speed_mph, idle_seconds, fuel_used_gallons,
                      estimated_mpg, derivation_version, notes, start_latitude,
                      start_longitude, end_latitude, end_longitude, start_address, end_address,
                      external_metadata
                    ) values (
                      @vehicleId, @traccarDeviceId, @startedAt, @endedAt, @durationSeconds,
                      @distanceMeters, @avgSpeedMph, @maxSpeedMph, @idleSeconds, @fuelUsedGallons,
                      @estimatedMpg, 'bouncie-csv-v1', @notes, @startLatitude,
                      @startLongitude, @endLatitude, @endLongitude, @startAddress, @endAddress,
                      @externalMetadata::jsonb
                    ) returning id
                    """, connection, transaction);
                insert.Parameters.AddWithValue("vehicleId", row.VehicleId);
                insert.Parameters.AddWithValue("traccarDeviceId", row.TraccarDeviceId ?? 0);
                insert.Parameters.AddWithValue("startedAt", row.StartedAt.UtcDateTime);
                insert.Parameters.AddWithValue("endedAt", row.EndedAt.UtcDateTime);
                insert.Parameters.AddWithValue("durationSeconds", Math.Max(0, row.DurationSeconds));
                insert.Parameters.AddWithValue("distanceMeters", row.DistanceMiles * 1609.344);
                insert.Parameters.AddWithValue("avgSpeedMph", (object?)row.AverageSpeedMph ?? DBNull.Value);
                insert.Parameters.AddWithValue("maxSpeedMph", (object?)row.MaxSpeedMph ?? DBNull.Value);
                insert.Parameters.AddWithValue("idleSeconds", (object?)row.IdleSeconds ?? DBNull.Value);
                insert.Parameters.AddWithValue("fuelUsedGallons", (object?)row.FuelUsedGallons ?? DBNull.Value);
                insert.Parameters.AddWithValue("estimatedMpg", (object?)row.FuelEconomyMpg ?? DBNull.Value);
                insert.Parameters.AddWithValue("notes", "Imported from Bouncie trip export.");
                insert.Parameters.AddWithValue("startLatitude", (object?)row.StartLatitude ?? DBNull.Value);
                insert.Parameters.AddWithValue("startLongitude", (object?)row.StartLongitude ?? DBNull.Value);
                insert.Parameters.AddWithValue("endLatitude", (object?)row.EndLatitude ?? DBNull.Value);
                insert.Parameters.AddWithValue("endLongitude", (object?)row.EndLongitude ?? DBNull.Value);
                insert.Parameters.AddWithValue("startAddress", (object?)row.StartAddress ?? DBNull.Value);
                insert.Parameters.AddWithValue("endAddress", (object?)row.EndAddress ?? DBNull.Value);
                insert.Parameters.AddWithValue("externalMetadata", JsonSerializer.Serialize(row.SourceData ?? new Dictionary<string, string?>()));
                tripId = (Guid)(await insert.ExecuteScalarAsync(cancellationToken) ?? throw new InvalidOperationException("Bouncie trip insert did not return an id."));
                imported++;
            }

            if (!existingTripId.HasValue)
            {
                await using var identity = new NpgsqlCommand("insert into trip_external_identities (source_system, external_key, trip_id) values ('bouncie', @externalKey, @tripId)", connection, transaction);
                identity.Parameters.AddWithValue("externalKey", row.ExternalKey);
                identity.Parameters.AddWithValue("tripId", tripId);
                await identity.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var detected in row.Events ?? [])
            {
                await using var eventInsert = new NpgsqlCommand("""
                    insert into trip_events (
                      trip_id, vehicle_id, traccar_device_id, event_type, source,
                      occurred_at, latitude, longitude, measured_value, unit, raw_evidence
                    ) values (
                      @tripId, @vehicleId, @traccarDeviceId, @eventType, 'bouncie',
                      @occurredAt, @latitude, @longitude, @measuredValue, @unit, @rawEvidence::jsonb
                    ) on conflict (trip_id, event_type, occurred_at, source) do nothing
                    """, connection, transaction);
                eventInsert.Parameters.AddWithValue("tripId", tripId);
                eventInsert.Parameters.AddWithValue("vehicleId", row.VehicleId);
                eventInsert.Parameters.AddWithValue("traccarDeviceId", row.TraccarDeviceId ?? 0);
                eventInsert.Parameters.AddWithValue("eventType", detected.EventType);
                eventInsert.Parameters.AddWithValue("occurredAt", (detected.OccurredAt ?? row.StartedAt).UtcDateTime);
                eventInsert.Parameters.AddWithValue("latitude", (object?)detected.Latitude ?? DBNull.Value);
                eventInsert.Parameters.AddWithValue("longitude", (object?)detected.Longitude ?? DBNull.Value);
                eventInsert.Parameters.AddWithValue("measuredValue", (object?)detected.MeasuredValue ?? DBNull.Value);
                eventInsert.Parameters.AddWithValue("unit", (object?)detected.Unit ?? DBNull.Value);
                eventInsert.Parameters.AddWithValue("rawEvidence", JsonSerializer.Serialize(detected.RawEvidence ?? new Dictionary<string, object?>()));
                importedEvents += await eventInsert.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var point in row.RoutePoints ?? [])
            {
                await using var routeInsert = new NpgsqlCommand("""
                    insert into trip_route_points (trip_id, point_index, occurred_at, latitude, longitude, speed_mph, raw_evidence)
                    values (@tripId, @pointIndex, @occurredAt, @latitude, @longitude, @speedMph, @rawEvidence::jsonb)
                    on conflict (trip_id, point_index) do update set
                      occurred_at = coalesce(trip_route_points.occurred_at, excluded.occurred_at),
                      speed_mph = coalesce(trip_route_points.speed_mph, excluded.speed_mph),
                      raw_evidence = case
                        when trip_route_points.raw_evidence = '{}'::jsonb
                          then excluded.raw_evidence
                        else trip_route_points.raw_evidence
                      end
                    """, connection, transaction);
                routeInsert.Parameters.AddWithValue("tripId", tripId);
                routeInsert.Parameters.AddWithValue("pointIndex", point.PointIndex);
                routeInsert.Parameters.AddWithValue("occurredAt", (object?)point.OccurredAt?.UtcDateTime ?? DBNull.Value);
                routeInsert.Parameters.AddWithValue("latitude", point.Latitude);
                routeInsert.Parameters.AddWithValue("longitude", point.Longitude);
                routeInsert.Parameters.AddWithValue("speedMph", (object?)point.SpeedMph ?? DBNull.Value);
                routeInsert.Parameters.AddWithValue("rawEvidence", JsonSerializer.Serialize(point.RawEvidence ?? new Dictionary<string, object?>()));
                await routeInsert.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return new BouncieImportResult(imported, skipped, importedEvents);
    }
}

public sealed record BouncieImportRequest(List<BouncieImportRow> Rows);
public sealed record BouncieImportResult(int Imported, int Skipped, int ImportedEvents);

public sealed record BouncieImportRow(
    Guid VehicleId,
    int? TraccarDeviceId,
    string ExternalKey,
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    int DurationSeconds,
    double DistanceMiles,
    double? AverageSpeedMph,
    double? MaxSpeedMph,
    double? IdleSeconds,
    double? FuelUsedGallons,
    double? FuelEconomyMpg,
    double? StartLatitude,
    double? StartLongitude,
    double? EndLatitude,
    double? EndLongitude,
    string? StartAddress,
    string? EndAddress,
    Dictionary<string, string?>? SourceData,
    List<BouncieImportEvent>? Events,
    List<BouncieRoutePoint>? RoutePoints);

public sealed record BouncieRoutePoint(
    int PointIndex,
    DateTimeOffset? OccurredAt,
    double Latitude,
    double Longitude,
    double? SpeedMph,
    Dictionary<string, object?>? RawEvidence);

public sealed record BouncieImportEvent(
    string EventType,
    DateTimeOffset? OccurredAt,
    double? Latitude,
    double? Longitude,
    double? MeasuredValue,
    string? Unit,
    Dictionary<string, object?>? RawEvidence);

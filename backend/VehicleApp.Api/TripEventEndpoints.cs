using Npgsql;

public static class TripEventEndpoints
{
    public static void MapTripEventEndpoints(this WebApplication app)
    {
        app.MapPost("/api/trips/{tripId:guid}/events", async (Guid tripId, TripEventBatchRequest request, NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (!await VehicleAccess.CanReadTripAsync(tripId, dataSource, authOptions, context, cancellationToken)) return Results.Forbid();
            if (request.Events is null || request.Events.Count > 5000) return Results.BadRequest("events must contain at most 5000 items.");
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var tx = await connection.BeginTransactionAsync(cancellationToken);
            foreach (var item in request.Events)
            {
                await using var command = new NpgsqlCommand("""
                    insert into trip_events (trip_id, vehicle_id, traccar_device_id, event_type, source, occurred_at, traccar_position_id, latitude, longitude, measured_value, threshold_value, unit, severity, raw_evidence)
                    select @tripId, vehicle_id, traccar_device_id, @eventType, @source, @occurredAt, @positionId, @latitude, @longitude, @measured, @threshold, @unit, @severity, cast(@evidence as jsonb)
                    from trips where id = @tripId
                    on conflict (trip_id, event_type, occurred_at, source) do nothing;
                    """, connection, tx);
                command.Parameters.AddWithValue("tripId", tripId);
                command.Parameters.AddWithValue("eventType", item.EventType);
                command.Parameters.AddWithValue("source", item.Source);
                command.Parameters.AddWithValue("occurredAt", item.OccurredAt.UtcDateTime);
                command.Parameters.AddWithValue("positionId", (object?)item.TraccarPositionId ?? DBNull.Value);
                command.Parameters.AddWithValue("latitude", (object?)item.Latitude ?? DBNull.Value);
                command.Parameters.AddWithValue("longitude", (object?)item.Longitude ?? DBNull.Value);
                command.Parameters.AddWithValue("measured", (object?)item.MeasuredValue ?? DBNull.Value);
                command.Parameters.AddWithValue("threshold", (object?)item.ThresholdValue ?? DBNull.Value);
                command.Parameters.AddWithValue("unit", (object?)item.Unit ?? DBNull.Value);
                command.Parameters.AddWithValue("severity", (object?)item.Severity ?? DBNull.Value);
                command.Parameters.AddWithValue("evidence", item.RawEvidence ?? "{}");
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            await tx.CommitAsync(cancellationToken);
            return Results.Ok(new { tripId, saved = request.Events.Count });
        });

        app.MapGet("/api/trips/{tripId:guid}/events", async (Guid tripId, NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (!await VehicleAccess.CanReadTripAsync(tripId, dataSource, authOptions, context, cancellationToken)) return Results.Forbid();
            try
            {
                await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
                await using var command = new NpgsqlCommand("select id, event_type, source, occurred_at, latitude, longitude, measured_value, threshold_value, unit, severity, raw_evidence from trip_events where trip_id = @tripId order by occurred_at", connection);
                command.Parameters.AddWithValue("tripId", tripId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                var events = new List<object>();
                while (await reader.ReadAsync(cancellationToken))
                    events.Add(new { id = reader.GetGuid(0), eventType = reader.GetString(1), source = reader.GetString(2), occurredAt = reader.GetFieldValue<DateTimeOffset>(3), latitude = reader.IsDBNull(4) ? (double?)null : reader.GetDouble(4), longitude = reader.IsDBNull(5) ? (double?)null : reader.GetDouble(5), measuredValue = reader.IsDBNull(6) ? (double?)null : reader.GetDouble(6), thresholdValue = reader.IsDBNull(7) ? (double?)null : reader.GetDouble(7), unit = reader.IsDBNull(8) ? null : reader.GetString(8), severity = reader.IsDBNull(9) ? null : reader.GetString(9), rawEvidence = reader.GetValue(10) });
                return Results.Ok(events);
            }
            catch (PostgresException ex) when (ex.SqlState == "42P01")
            {
                return Results.Problem("Trip event schema is not installed yet.", statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });

        app.MapGet("/api/trip-events/notifications", async (DateTimeOffset? from, DateTimeOffset? to, Guid? vehicleId, NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                select e.id, e.trip_id, e.vehicle_id, coalesce(v.display_name, 'Unknown vehicle'),
                       e.event_type, e.source, e.occurred_at, e.measured_value,
                       e.threshold_value, e.unit, e.severity, e.latitude, e.longitude
                from trip_events e
                left join vehicles v on v.id = e.vehicle_id
                where (cast(@from as timestamptz) is null or e.occurred_at >= cast(@from as timestamptz))
                  and (cast(@to as timestamptz) is null or e.occurred_at <= cast(@to as timestamptz))
                  and (cast(@vehicleId as uuid) is null or e.vehicle_id = cast(@vehicleId as uuid))
                  and (not @authEnabled or @isAdmin or exists (select 1 from app_user_vehicle_access ua join app_users u on u.id = ua.user_id where ua.vehicle_id = e.vehicle_id and u.username = @username and u.active) or exists (select 1 from app_group_vehicle_access ga join app_group_memberships gm on gm.group_id = ga.group_id join app_users u on u.id = gm.user_id where ga.vehicle_id = e.vehicle_id and u.username = @username and u.active))
                order by e.occurred_at desc
                limit 500
                """, connection);
            command.Parameters.AddWithValue("from", (object?)from?.UtcDateTime ?? DBNull.Value);
            command.Parameters.AddWithValue("to", (object?)to?.UtcDateTime ?? DBNull.Value);
            command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value);
            command.Parameters.AddWithValue("authEnabled", authOptions.Enabled);
            command.Parameters.AddWithValue("isAdmin", context.User.IsInRole("admin"));
            command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var notifications = new List<object>();
            while (await reader.ReadAsync(cancellationToken))
                notifications.Add(new
                {
                    id = reader.GetGuid(0),
                    tripId = reader.GetGuid(1),
                    vehicleId = reader.GetGuid(2),
                    vehicleName = reader.GetString(3),
                    eventType = reader.GetString(4),
                    source = reader.GetString(5),
                    occurredAt = reader.GetFieldValue<DateTimeOffset>(6),
                    measuredValue = reader.IsDBNull(7) ? (double?)null : reader.GetDouble(7),
                    thresholdValue = reader.IsDBNull(8) ? (double?)null : reader.GetDouble(8),
                    unit = reader.IsDBNull(9) ? null : reader.GetString(9),
                    severity = reader.IsDBNull(10) ? null : reader.GetString(10),
                    latitude = reader.IsDBNull(11) ? (double?)null : reader.GetDouble(11),
                    longitude = reader.IsDBNull(12) ? (double?)null : reader.GetDouble(12),
                });
            return Results.Ok(notifications);
        }).WithName("GetTripEventNotifications");

        app.MapDelete("/api/trips/{tripId:guid}/events", async (Guid tripId, NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (!await VehicleAccess.CanReadTripAsync(tripId, dataSource, authOptions, context, cancellationToken)) return Results.Forbid();
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("delete from trip_events where trip_id = @tripId and (source = 'calculated' or event_type = 'maximum_speed')", connection);
            command.Parameters.AddWithValue("tripId", tripId);
            var deleted = await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.Ok(new { tripId, deleted });
        });
    }
}

public sealed record TripEventBatchRequest(IReadOnlyList<TripEventWriteRequest> Events);
public sealed record TripEventWriteRequest(string EventType, string Source, DateTimeOffset OccurredAt, long? TraccarPositionId, double? Latitude, double? Longitude, double? MeasuredValue, double? ThresholdValue, string? Unit, string? Severity, string? RawEvidence);

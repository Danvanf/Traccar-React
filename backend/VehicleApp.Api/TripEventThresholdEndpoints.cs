using Npgsql;

public static class TripEventThresholdEndpoints
{
    public static void MapTripEventThresholdEndpoints(this WebApplication app)
    {
        app.MapPost("/api/event-thresholds", async (UpsertThresholdRequest request, NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            if (request.Scope is not ("global" or "system" or "vehicle") || string.IsNullOrWhiteSpace(request.EventType) || !double.IsFinite(request.ThresholdValue) || string.IsNullOrWhiteSpace(request.Unit))
                return Results.BadRequest("Invalid threshold scope, event type, value, or unit.");
            if (request.Scope == "vehicle" && request.VehicleId is null) return Results.BadRequest("Vehicle thresholds require vehicleId.");
            if (request.Scope != "vehicle" && request.VehicleId is not null) return Results.BadRequest("Only vehicle thresholds may specify vehicleId.");
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                insert into trip_event_thresholds (scope, vehicle_id, event_type, threshold_value, unit, enabled, updated_at)
                values (@scope, @vehicleId, @eventType, @value, @unit, @enabled, now())
                on conflict (scope, coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type)
                do update set threshold_value = excluded.threshold_value, unit = excluded.unit, enabled = excluded.enabled, updated_at = now()
                """, connection);
            command.Parameters.AddWithValue("scope", request.Scope);
            command.Parameters.AddWithValue("vehicleId", (object?)request.VehicleId ?? DBNull.Value);
            command.Parameters.AddWithValue("eventType", request.EventType);
            command.Parameters.AddWithValue("value", request.ThresholdValue);
            command.Parameters.AddWithValue("unit", request.Unit);
            command.Parameters.AddWithValue("enabled", request.Enabled);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.Ok(request);
        });

        app.MapGet("/api/event-thresholds", async (Guid? vehicleId, NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                select scope, vehicle_id, event_type, threshold_value, unit, enabled
                from trip_event_thresholds
                where enabled and (scope in ('global', 'system') or (scope = 'vehicle' and vehicle_id = @vehicleId))
                order by case scope when 'global' then 1 when 'system' then 2 else 3 end, event_type
                """, connection);
            command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var rows = new List<object>();
            while (await reader.ReadAsync(cancellationToken))
                rows.Add(new { scope = reader.GetString(0), vehicleId = reader.IsDBNull(1) ? (Guid?)null : reader.GetGuid(1), eventType = reader.GetString(2), thresholdValue = reader.GetDouble(3), unit = reader.GetString(4), enabled = reader.GetBoolean(5) });
            return Results.Ok(rows);
        });
    }
}

public sealed record UpsertThresholdRequest(string Scope, Guid? VehicleId, string EventType, double ThresholdValue, string Unit, bool Enabled = true);

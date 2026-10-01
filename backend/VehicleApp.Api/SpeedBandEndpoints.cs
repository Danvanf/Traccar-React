using System.Text.Json;
using Npgsql;

public static class SpeedBandEndpoints
{
    public static void MapSpeedBandEndpoints(this WebApplication app)
    {
        app.MapGet("/api/vehicles/{vehicleId:guid}/speed-bands", async (Guid vehicleId, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand("select bands, inherited_from_vehicle_id from vehicle_speed_bands where vehicle_id=@vehicleId", conn);
            cmd.Parameters.AddWithValue("vehicleId", vehicleId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound();
            return Results.Ok(new { vehicleId, bands = JsonDocument.Parse(reader.GetString(0)).RootElement, inheritedFromVehicleId = reader.IsDBNull(1) ? (Guid?)null : reader.GetGuid(1) });
        });

        app.MapPost("/api/vehicles/{vehicleId:guid}/speed-bands", async (Guid vehicleId, SpeedBandRequest request, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.Bands.ValueKind != JsonValueKind.Array || request.Bands.GetArrayLength() == 0) return Results.BadRequest("bands must be a non-empty array.");
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand("insert into vehicle_speed_bands(vehicle_id,bands,inherited_from_vehicle_id,updated_at) values(@vehicleId,@bands,@source,now()) on conflict(vehicle_id) do update set bands=excluded.bands,inherited_from_vehicle_id=excluded.inherited_from_vehicle_id,updated_at=now()", conn);
            cmd.Parameters.AddWithValue("vehicleId", vehicleId);
            cmd.Parameters.AddWithValue("bands", request.Bands.GetRawText());
            cmd.Parameters.AddWithValue("source", (object?)request.InheritedFromVehicleId ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
            return Results.Ok(new { vehicleId });
        });
    }
}

public sealed record SpeedBandRequest(JsonElement Bands, Guid? InheritedFromVehicleId);

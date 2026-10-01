using System.Text.Json;
using Npgsql;

public static class StatusCardEndpoints
{
    public static void MapStatusCardEndpoints(this WebApplication app)
    {
        app.MapGet("/api/vehicles/{vehicleId:guid}/status-card", async (Guid vehicleId, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand("select fields from vehicle_status_card_preferences where vehicle_id=@vehicleId", conn);
            cmd.Parameters.AddWithValue("vehicleId", vehicleId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound();
            return Results.Ok(new { vehicleId, fields = JsonDocument.Parse(reader.GetString(0)).RootElement });
        });

        app.MapPost("/api/vehicles/{vehicleId:guid}/status-card", async (Guid vehicleId, StatusCardRequest request, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.Fields.ValueKind != JsonValueKind.Array) return Results.BadRequest("fields must be an array.");
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand("insert into vehicle_status_card_preferences(vehicle_id,fields,updated_at) values(@vehicleId,@fields,now()) on conflict(vehicle_id) do update set fields=excluded.fields,updated_at=now()", conn);
            cmd.Parameters.AddWithValue("vehicleId", vehicleId);
            cmd.Parameters.AddWithValue("fields", request.Fields.GetRawText());
            await cmd.ExecuteNonQueryAsync(ct);
            return Results.Ok(new { vehicleId });
        });
    }
}

public sealed record StatusCardRequest(JsonElement Fields);

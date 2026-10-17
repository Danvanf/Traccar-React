using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

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
            using var document = JsonDocument.Parse(reader.GetString(0));
            var root = document.RootElement;
            var emptyArray = JsonSerializer.SerializeToElement(Array.Empty<string>());
            var fields = root.ValueKind == JsonValueKind.Array
                ? root.Clone()
                : root.TryGetProperty("fields", out var storedFields) && storedFields.ValueKind == JsonValueKind.Array
                    ? storedFields.Clone()
                    : emptyArray;
            var storedPopupFields = default(JsonElement);
            var popupFieldsConfigured = root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("popupFields", out storedPopupFields);
            var popupFields = popupFieldsConfigured && storedPopupFields.ValueKind == JsonValueKind.Array
                    ? storedPopupFields.Clone()
                    : emptyArray;
            return Results.Ok(new { vehicleId, fields, popupFields, popupFieldsConfigured });
        });

        app.MapPost("/api/vehicles/{vehicleId:guid}/status-card", async (Guid vehicleId, StatusCardRequest request, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.Fields.ValueKind != JsonValueKind.Array) return Results.BadRequest("fields must be an array.");
            if (request.PopupFields is { ValueKind: not JsonValueKind.Array }) return Results.BadRequest("popupFields must be an array.");
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand("insert into vehicle_status_card_preferences(vehicle_id,fields,updated_at) values(@vehicleId,@fields,now()) on conflict(vehicle_id) do update set fields=excluded.fields,updated_at=now()", conn);
            cmd.Parameters.AddWithValue("vehicleId", vehicleId);
            var popupFields = request.PopupFields?.GetRawText() ?? "[]";
            cmd.Parameters.Add("fields", NpgsqlDbType.Jsonb).Value = $"{{\"fields\":{request.Fields.GetRawText()},\"popupFields\":{popupFields}}}";
            await cmd.ExecuteNonQueryAsync(ct);
            return Results.Ok(new { vehicleId });
        });
    }
}

public sealed record StatusCardRequest(JsonElement Fields, JsonElement? PopupFields);

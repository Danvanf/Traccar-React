using System.Globalization;
using System.Text;
using Npgsql;

public static class BusinessMileageReportEndpoints
{
    public static void MapBusinessMileageReportEndpoints(this WebApplication app) => app.MapGet("/api/reports/business-mileage", GetAsync).WithName("GetBusinessMileageReport");

    private static async Task<IResult> GetAsync(DateTimeOffset? from, DateTimeOffset? to, Guid? vehicleId, Guid? tagId, string? format, string? units, NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken)
    {
        var start = from ?? DateTimeOffset.UtcNow.AddMonths(-1); var end = to ?? DateTimeOffset.UtcNow;
        if (end < start) return Results.BadRequest(new { title = "Invalid report range", detail = "The through date must be on or after the from date." });
        var reportUnits = units?.Trim().ToLowerInvariant() switch { null or "" or "imperial" => "imperial", "metric" => "metric", _ => null };
        if (reportUnits is null) return Results.BadRequest(new { title = "Invalid report units", detail = "Units must be imperial or metric." });
        var isAdmin = context.User.IsInRole("admin"); var username = context.User.Identity?.Name ?? string.Empty;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
          select t.id, t.started_at, t.ended_at, t.vehicle_id, v.display_name, t.start_address, t.end_address,
                 t.start_latitude, t.start_longitude, t.end_latitude, t.end_longitude, t.distance_meters, t.duration_seconds,
                 coalesce(string_agg(distinct tg.name, '; ' order by tg.name), '') as tags, coalesce(t.notes, '')
          from trips t join vehicles v on v.id=t.vehicle_id
          left join trip_tag_map tm on tm.trip_id=t.id left join trip_tags tg on tg.id=tm.tag_id
          where t.started_at >= @from and t.started_at <= @to
            and (cast(@vehicleId as uuid) is null or t.vehicle_id=cast(@vehicleId as uuid))
            and (cast(@tagId as uuid) is null or exists (select 1 from trip_tag_map tx where tx.trip_id=t.id and tx.tag_id=cast(@tagId as uuid)))
            and (not @authEnabled or @isAdmin or exists (select 1 from app_user_vehicle_access ua join app_users u on u.id=ua.user_id where ua.vehicle_id=t.vehicle_id and u.username=@username and u.active) or exists (select 1 from app_group_vehicle_access ga join app_group_memberships gm on gm.group_id=ga.group_id join app_users u on u.id=gm.user_id where ga.vehicle_id=t.vehicle_id and u.username=@username and u.active))
          group by t.id, t.started_at, t.ended_at, t.vehicle_id, v.display_name, t.start_address, t.end_address, t.start_latitude, t.start_longitude, t.end_latitude, t.end_longitude, t.distance_meters, t.duration_seconds, t.notes
          order by t.started_at desc
          """, connection);
        command.Parameters.AddWithValue("from", start.UtcDateTime); command.Parameters.AddWithValue("to", end.UtcDateTime); command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value); command.Parameters.AddWithValue("tagId", (object?)tagId ?? DBNull.Value); command.Parameters.AddWithValue("authEnabled", authOptions.Enabled); command.Parameters.AddWithValue("isAdmin", isAdmin); command.Parameters.AddWithValue("username", username);
        var rows = new List<Row>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) rows.Add(new Row(reader.GetGuid(0), reader.GetDateTime(1), reader.GetDateTime(2), reader.GetGuid(3), reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetString(6), reader.IsDBNull(7) ? null : reader.GetDouble(7), reader.IsDBNull(8) ? null : reader.GetDouble(8), reader.IsDBNull(9) ? null : reader.GetDouble(9), reader.IsDBNull(10) ? null : reader.GetDouble(10), reader.GetDouble(11), reader.GetInt64(12), reader.GetString(13), reader.GetString(14)));
        var report = new { reportType = "business-mileage", generatedAtUtc = DateTimeOffset.UtcNow, units = reportUnits, filters = new { from = start, to = end, vehicleId, tagId }, summary = new { tripCount = rows.Count, distanceMeters = rows.Sum(r => r.DistanceMeters), durationSeconds = rows.Sum(r => r.DurationSeconds), uncategorizedCount = rows.Count(r => string.IsNullOrWhiteSpace(r.Tags)) }, warnings = rows.Count == 0 ? new[] { "No trips matched the selected filters." } : Array.Empty<string>(), rows };
        if (string.Equals(format, "csv", StringComparison.OrdinalIgnoreCase)) return Results.File(BuildCsv(rows, reportUnits), "text/csv; charset=utf-8", $"business-mileage-{start:yyyyMMdd}-{end:yyyyMMdd}.csv");
        return Results.Ok(report);
    }
    private static byte[] BuildCsv(IEnumerable<Row> rows, string units)
    {
        var u = units == "metric" ? "km" : "mi"; var b = new StringBuilder($"Date,Vehicle,From,To,Distance ({u}),Duration (min),Tags,Purpose\n");
        foreach (var r in rows) { var d = units == "metric" ? r.DistanceMeters / 1000d : r.DistanceMeters / 1609.344d; b.Append(r.StartedAt.ToString("O", CultureInfo.InvariantCulture)).Append(',').Append(Escape(r.VehicleName)).Append(',').Append(Escape(r.StartAddress ?? "")).Append(',').Append(Escape(r.EndAddress ?? "")).Append(',').Append(d.ToString(CultureInfo.InvariantCulture)).Append(',').Append((r.DurationSeconds / 60d).ToString(CultureInfo.InvariantCulture)).Append(',').Append(Escape(r.Tags)).Append(',').AppendLine(Escape(r.Notes)); }
        return Encoding.UTF8.GetBytes(b.ToString());
    }
    private static string Escape(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
    private sealed record Row(Guid Id, DateTime StartedAt, DateTime EndedAt, Guid VehicleId, string VehicleName, string? StartAddress, string? EndAddress, double? StartLatitude, double? StartLongitude, double? EndLatitude, double? EndLongitude, double DistanceMeters, long DurationSeconds, string Tags, string Notes);
}

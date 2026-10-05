using System.Globalization;
using System.Text;
using Npgsql;

public static class UtilizationReportEndpoints
{
    public static void MapUtilizationReportEndpoints(this WebApplication app)
        => app.MapGet("/api/reports/utilization", GetAsync).WithName("GetUtilizationReport");

    private static async Task<IResult> GetAsync(DateTimeOffset? from, DateTimeOffset? to, Guid? vehicleId, Guid? tagId, string? format, string? timeZone, string? units, string? groupBy, NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken)
    {
        var start = from ?? DateTimeOffset.UtcNow.AddMonths(-1); var end = to ?? DateTimeOffset.UtcNow;
        if (end < start) return Results.BadRequest(new { title = "Invalid report range", detail = "The through date must be on or after the from date." });
        var zone = string.IsNullOrWhiteSpace(timeZone) ? "UTC" : timeZone.Trim();
        var grouping = groupBy?.Trim().ToLowerInvariant() switch { "week" => "week", "month" => "month", _ => "day" };
        var reportUnits = units?.Trim().ToLowerInvariant() switch { null or "" or "imperial" => "imperial", "metric" => "metric", _ => null };
        if (reportUnits is null) return Results.BadRequest(new { title = "Invalid report units", detail = "Units must be imperial or metric." });
        var isAdmin = context.User.IsInRole("admin"); var username = context.User.Identity?.Name ?? string.Empty;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand($"""
          select date_trunc('{grouping}', t.started_at at time zone @timeZone) as period, t.vehicle_id, v.display_name,
                 count(*)::int, min(t.started_at), max(t.ended_at), coalesce(sum(t.distance_meters),0)::double precision,
                 coalesce(sum(t.duration_seconds),0)::bigint
          from trips t join vehicles v on v.id=t.vehicle_id
          where t.started_at >= @from and t.started_at <= @to
            and (cast(@vehicleId as uuid) is null or t.vehicle_id=cast(@vehicleId as uuid))
            and (not @authEnabled or @isAdmin or exists (select 1 from app_user_vehicle_access ua join app_users u on u.id=ua.user_id where ua.vehicle_id=t.vehicle_id and u.username=@username and u.active) or exists (select 1 from app_group_vehicle_access ga join app_group_memberships gm on gm.group_id=ga.group_id join app_users u on u.id=gm.user_id where ga.vehicle_id=t.vehicle_id and u.username=@username and u.active))
            and (cast(@tagId as uuid) is null or exists (select 1 from trip_tag_map tm where tm.trip_id=t.id and tm.tag_id=cast(@tagId as uuid)))
          group by period, t.vehicle_id, v.display_name order by period desc, v.display_name
          """, connection);
        command.Parameters.AddWithValue("from", start.UtcDateTime); command.Parameters.AddWithValue("to", end.UtcDateTime); command.Parameters.AddWithValue("timeZone", zone); command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value); command.Parameters.AddWithValue("tagId", (object?)tagId ?? DBNull.Value); command.Parameters.AddWithValue("authEnabled", authOptions.Enabled); command.Parameters.AddWithValue("isAdmin", isAdmin); command.Parameters.AddWithValue("username", username);
        var rows = new List<Row>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) rows.Add(new Row(reader.GetDateTime(0), reader.GetGuid(1), reader.GetString(2), reader.GetInt32(3), reader.GetDateTime(4), reader.GetDateTime(5), reader.GetDouble(6), reader.GetInt64(7)));
        var report = new { reportType = "utilization", generatedAtUtc = DateTimeOffset.UtcNow, units = reportUnits, filters = new { from = start, to = end, groupBy = grouping, timeZone = zone, units = reportUnits, vehicleId, tagId }, summary = new { activeDays = rows.Select(r => r.Period.Date).Distinct().Count(), tripCount = rows.Sum(r => r.TripCount), distanceMeters = rows.Sum(r => r.DistanceMeters), durationSeconds = rows.Sum(r => r.DurationSeconds) }, warnings = rows.Count == 0 ? new[] { "No trips matched the selected filters." } : Array.Empty<string>(), rows };
        if (string.Equals(format, "csv", StringComparison.OrdinalIgnoreCase)) return Results.File(BuildCsv(rows, reportUnits), "text/csv; charset=utf-8", $"utilization-{start:yyyyMMdd}-{end:yyyyMMdd}.csv");
        return Results.Ok(report);
    }
    private static byte[] BuildCsv(IEnumerable<Row> rows, string units)
    {
        var u = units == "metric" ? "km" : "mi"; var b = new StringBuilder($"Date,Vehicle,Trips,First departure,Last arrival,Distance ({u}),Driving minutes\n");
        foreach (var r in rows) { var d = units == "metric" ? r.DistanceMeters / 1000d : r.DistanceMeters / 1609.344d; b.Append(r.Period.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append(',').Append(Escape(r.VehicleName)).Append(',').Append(r.TripCount).Append(',').Append(r.FirstDeparture.ToString("O", CultureInfo.InvariantCulture)).Append(',').Append(r.LastArrival.ToString("O", CultureInfo.InvariantCulture)).Append(',').Append(d.ToString(CultureInfo.InvariantCulture)).Append(',').AppendLine((r.DurationSeconds / 60d).ToString(CultureInfo.InvariantCulture)); }
        return Encoding.UTF8.GetBytes(b.ToString());
    }
    private static string Escape(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
    private sealed record Row(DateTime Period, Guid VehicleId, string VehicleName, int TripCount, DateTime FirstDeparture, DateTime LastArrival, double DistanceMeters, long DurationSeconds);
}

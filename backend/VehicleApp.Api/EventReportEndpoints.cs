using System.Globalization;
using System.Text;
using Npgsql;

public static class EventReportEndpoints
{
    public static void MapEventReportEndpoints(this WebApplication app)
        => app.MapGet("/api/reports/events", GetAsync).WithName("GetEventReport");

    private static async Task<IResult> GetAsync(DateTimeOffset? from, DateTimeOffset? to, Guid? vehicleId, Guid? tagId, string? format, NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken)
    {
        var start = from ?? DateTimeOffset.UtcNow.AddMonths(-1); var end = to ?? DateTimeOffset.UtcNow;
        if (end < start) return Results.BadRequest(new { title = "Invalid report range", detail = "The through date must be on or after the from date." });
        var isAdmin = context.User.IsInRole("admin"); var username = context.User.Identity?.Name ?? string.Empty;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
          select t.vehicle_id, v.display_name, e.event_type, e.source, count(*)::int,
                 min(e.occurred_at), max(e.occurred_at), min(e.measured_value), max(e.measured_value), max(e.unit),
                 count(*) filter (where e.severity = 'high')::int
          from trip_events e join trips t on t.id=e.trip_id join vehicles v on v.id=t.vehicle_id
          where t.started_at >= @from and t.started_at <= @to
            and (cast(@vehicleId as uuid) is null or t.vehicle_id=cast(@vehicleId as uuid))
            and (not @authEnabled or @isAdmin or exists (select 1 from app_user_vehicle_access ua join app_users u on u.id=ua.user_id where ua.vehicle_id=t.vehicle_id and u.username=@username and u.active) or exists (select 1 from app_group_vehicle_access ga join app_group_memberships gm on gm.group_id=ga.group_id join app_users u on u.id=gm.user_id where ga.vehicle_id=t.vehicle_id and u.username=@username and u.active))
            and (cast(@tagId as uuid) is null or exists (select 1 from trip_tag_map tm where tm.trip_id=t.id and tm.tag_id=cast(@tagId as uuid)))
          group by t.vehicle_id, v.display_name, e.event_type, e.source
          order by max(e.occurred_at) desc, v.display_name, e.event_type
          """, connection);
        command.Parameters.AddWithValue("from", start.UtcDateTime); command.Parameters.AddWithValue("to", end.UtcDateTime); command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value); command.Parameters.AddWithValue("tagId", (object?)tagId ?? DBNull.Value); command.Parameters.AddWithValue("authEnabled", authOptions.Enabled); command.Parameters.AddWithValue("isAdmin", isAdmin); command.Parameters.AddWithValue("username", username);
        var rows = new List<Row>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) rows.Add(new Row(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4), reader.GetDateTime(5), reader.GetDateTime(6), reader.IsDBNull(7) ? null : reader.GetDouble(7), reader.IsDBNull(8) ? null : reader.GetDouble(8), reader.IsDBNull(9) ? null : reader.GetString(9), reader.GetInt32(10)));
        var report = new { reportType = "events", generatedAtUtc = DateTimeOffset.UtcNow, filters = new { from = start, to = end, vehicleId, tagId }, summary = new { eventCount = rows.Sum(r => r.EventCount), eventTypes = rows.Select(r => r.EventType).Distinct().Count(), vehicles = rows.Select(r => r.VehicleId).Distinct().Count() }, warnings = rows.Count == 0 ? new[] { "No events matched the selected filters." } : Array.Empty<string>(), rows };
        if (string.Equals(format, "csv", StringComparison.OrdinalIgnoreCase)) return Results.File(BuildCsv(rows), "text/csv; charset=utf-8", $"events-{start:yyyyMMdd}-{end:yyyyMMdd}.csv");
        return Results.Ok(report);
    }
    private static byte[] BuildCsv(IEnumerable<Row> rows)
    {
        var b = new StringBuilder("Vehicle,Event type,Source,Count,First occurrence,Last occurrence,Minimum,Maximum,Unit,High severity\n");
        foreach (var r in rows) b.Append(Escape(r.VehicleName)).Append(',').Append(Escape(r.EventType)).Append(',').Append(Escape(r.Source)).Append(',').Append(r.EventCount).Append(',').Append(r.FirstOccurrence.ToString("O", CultureInfo.InvariantCulture)).Append(',').Append(r.LastOccurrence.ToString("O", CultureInfo.InvariantCulture)).Append(',').Append(r.Minimum?.ToString(CultureInfo.InvariantCulture) ?? string.Empty).Append(',').Append(r.Maximum?.ToString(CultureInfo.InvariantCulture) ?? string.Empty).Append(',').Append(Escape(r.Unit ?? string.Empty)).Append(',').AppendLine(r.HighSeverity.ToString(CultureInfo.InvariantCulture));
        return Encoding.UTF8.GetBytes(b.ToString());
    }
    private static string Escape(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
    private sealed record Row(Guid VehicleId, string VehicleName, string EventType, string Source, int EventCount, DateTime FirstOccurrence, DateTime LastOccurrence, double? Minimum, double? Maximum, string? Unit, int HighSeverity);
}

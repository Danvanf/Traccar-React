using System.Globalization;
using System.Text;
using Npgsql;

public static class CompletenessReportEndpoints
{
    public static void MapCompletenessReportEndpoints(this WebApplication app)
        => app.MapGet("/api/reports/data-completeness", GetAsync).WithName("GetDataCompletenessReport");

    private static async Task<IResult> GetAsync(
        DateTimeOffset? from, DateTimeOffset? to, Guid? vehicleId, Guid? tagId, string? format, NpgsqlDataSource dataSource,
        VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken)
    {
        var start = from ?? DateTimeOffset.UtcNow.AddMonths(-1);
        var end = to ?? DateTimeOffset.UtcNow;
        if (end < start) return Results.BadRequest(new { title = "Invalid report range", detail = "The through date must be on or after the from date." });
        var isAdmin = context.User.IsInRole("admin");
        var username = context.User.Identity?.Name ?? string.Empty;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            with filtered as (
              select t.id, t.vehicle_id, v.display_name as vehicle_name, t.max_speed_mph,
                     coalesce(t.external_metadata ->> 'source', case when t.derivation_version like 'bouncie%' then 'bouncie-csv' else 'traccar' end) as source
              from trips t join vehicles v on v.id = t.vehicle_id
              where t.started_at >= @from and t.started_at <= @to
                and (cast(@vehicleId as uuid) is null or t.vehicle_id = cast(@vehicleId as uuid))
                and (not @authEnabled or @isAdmin or exists (select 1 from app_user_vehicle_access ua join app_users u on u.id=ua.user_id where ua.vehicle_id=t.vehicle_id and u.username=@username and u.active) or exists (select 1 from app_group_vehicle_access ga join app_group_memberships gm on gm.group_id=ga.group_id join app_users u on u.id=gm.user_id where ga.vehicle_id=t.vehicle_id and u.username=@username and u.active))
                and (cast(@tagId as uuid) is null or exists (select 1 from trip_tag_map tm where tm.trip_id=t.id and tm.tag_id=cast(@tagId as uuid)))
            ), route as (
              select trip_id, count(*)::int as route_points, count(*) filter (where raw_evidence <> '{}'::jsonb)::int as telemetry_points
              from trip_route_points group by trip_id
            ), events as (
              select trip_id, count(*)::int as event_count from trip_events group by trip_id
            )
            select vehicle_id, vehicle_name, source, count(*)::int as trip_count,
                   count(*) filter (where max_speed_mph is null)::int as trips_without_max_speed,
                   count(*) filter (where source <> 'traccar' and coalesce(route.route_points,0)=0)::int as trips_without_route,
                   count(*) filter (where source <> 'traccar' and coalesce(route.telemetry_points,0)=0)::int as trips_without_telemetry,
                   coalesce(sum(route.route_points),0)::int as route_points,
                   coalesce(sum(route.telemetry_points),0)::int as telemetry_points,
                   coalesce(sum(events.event_count),0)::int as event_count,
                   case when source = 'traccar' then 'live source' when coalesce(sum(route.route_points),0) > 0 then 'saved' else 'missing' end as route_coverage,
                   case when source = 'traccar' then 'live source' when coalesce(sum(route.telemetry_points),0) > 0 then 'saved' else 'missing' end as telemetry_coverage
            from filtered
            left join route on route.trip_id=filtered.id
            left join events on events.trip_id=filtered.id
            group by vehicle_id, vehicle_name, source
            order by vehicle_name, source
            """, connection);
        command.Parameters.AddWithValue("from", start.UtcDateTime); command.Parameters.AddWithValue("to", end.UtcDateTime);
        command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value); command.Parameters.AddWithValue("tagId", (object?)tagId ?? DBNull.Value);
        command.Parameters.AddWithValue("authEnabled", authOptions.Enabled); command.Parameters.AddWithValue("isAdmin", isAdmin); command.Parameters.AddWithValue("username", username);
        var rows = new List<Row>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) rows.Add(new Row(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3), reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7), reader.GetInt32(8), reader.GetInt32(9), reader.GetString(10), reader.GetString(11)));
        var totalTrips = rows.Sum(x => x.TripCount);
        var report = new { reportType = "data-completeness", generatedAtUtc = DateTimeOffset.UtcNow, filters = new { from = start, to = end, vehicleId, tagId }, summary = new { tripCount = totalTrips, tripsWithoutMaxSpeed = rows.Sum(x => x.TripsWithoutMaxSpeed), tripsWithoutRoute = rows.Sum(x => x.TripsWithoutRoute), tripsWithoutTelemetry = rows.Sum(x => x.TripsWithoutTelemetry), sourceCount = rows.Select(x => x.Source).Distinct().Count() }, warnings = rows.Count == 0 ? new[] { "No trips matched the selected filters." } : new[] { "Traccar routes and telemetry are live source data loaded on demand; zero saved route points is not counted as missing." }, rows };
        if (string.Equals(format, "csv", StringComparison.OrdinalIgnoreCase)) return Results.File(BuildCsv(rows), "text/csv; charset=utf-8", $"data-completeness-{start:yyyyMMdd}-{end:yyyyMMdd}.csv");
        return Results.Ok(report);
    }

    private static byte[] BuildCsv(IEnumerable<Row> rows)
    {
        var b = new StringBuilder("Vehicle,Source,Trips,Without max speed,Without route,Without telemetry,Route points,Telemetry points,Route coverage,Telemetry coverage,Events\n");
        foreach (var r in rows) b.Append(Escape(r.VehicleName)).Append(',').Append(Escape(r.Source)).Append(',').Append(r.TripCount).Append(',').Append(r.TripsWithoutMaxSpeed).Append(',').Append(r.TripsWithoutRoute).Append(',').Append(r.TripsWithoutTelemetry).Append(',').Append(r.RoutePoints).Append(',').Append(r.TelemetryPoints).Append(',').Append(Escape(r.RouteCoverage)).Append(',').Append(Escape(r.TelemetryCoverage)).Append(',').AppendLine(r.EventCount.ToString(CultureInfo.InvariantCulture));
        return Encoding.UTF8.GetBytes(b.ToString());
    }
    private static string Escape(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
    private sealed record Row(Guid VehicleId, string VehicleName, string Source, int TripCount, int TripsWithoutMaxSpeed, int TripsWithoutRoute, int TripsWithoutTelemetry, int RoutePoints, int TelemetryPoints, int EventCount, string RouteCoverage, string TelemetryCoverage);
}

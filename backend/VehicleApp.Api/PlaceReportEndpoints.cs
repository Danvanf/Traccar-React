using System.Globalization;
using System.Text;
using Npgsql;

public static class PlaceReportEndpoints
{
    public static void MapPlaceReportEndpoints(this WebApplication app)
    {
        app.MapGet("/api/reports/places", GetAsync).WithName("GetPlaceReport");
    }

    private static async Task<IResult> GetAsync(
        DateTimeOffset? from,
        DateTimeOffset? to,
        Guid? vehicleId,
        Guid? tagId,
        string? format,
        string? units,
        NpgsqlDataSource dataSource,
        VehicleAppAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var start = from ?? DateTimeOffset.UtcNow.AddMonths(-1);
        var end = to ?? DateTimeOffset.UtcNow;
        if (end < start)
            return Results.BadRequest(new { title = "Invalid report range", detail = "The through date must be on or after the from date." });
        var reportUnits = units?.Trim().ToLowerInvariant() switch
        {
            null or "" or "imperial" => "imperial",
            "metric" => "metric",
            _ => null
        };
        if (reportUnits is null)
            return Results.BadRequest(new { title = "Invalid report units", detail = "Units must be imperial or metric." });

        var isAdmin = context.User.IsInRole("admin");
        var username = context.User.Identity?.Name ?? string.Empty;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            with filtered_trips as (
                select t.id, t.vehicle_id, v.display_name as vehicle_name, t.started_at, t.ended_at,
                       t.distance_meters, t.duration_seconds, t.start_latitude, t.start_longitude,
                       t.end_latitude, t.end_longitude
                from trips t
                join vehicles v on v.id = t.vehicle_id
                where t.started_at >= @from and t.started_at <= @to
                  and (cast(@vehicleId as uuid) is null or t.vehicle_id = cast(@vehicleId as uuid))
                  and (not @authEnabled or @isAdmin or exists (
                         select 1 from app_user_vehicle_access ua join app_users u on u.id = ua.user_id
                         where ua.vehicle_id = t.vehicle_id and u.username = @username and u.active
                       ) or exists (
                         select 1 from app_group_vehicle_access ga
                         join app_group_memberships gm on gm.group_id = ga.group_id
                         join app_users u on u.id = gm.user_id
                         where ga.vehicle_id = t.vehicle_id and u.username = @username and u.active
                       ))
                  and (cast(@tagId as uuid) is null or exists (
                         select 1 from trip_tag_map tm where tm.trip_id = t.id and tm.tag_id = cast(@tagId as uuid)
                       ))
            ), endpoint_visits as (
                select ft.*, p.id as place_id, p.name as place_name, 'departure'::text as visit_type, ft.started_at as visit_at
                from filtered_trips ft
                join lateral (
                    select np.id, np.name
                    from named_places np
                    where (np.vehicle_id = ft.vehicle_id or np.vehicle_id is null)
                      and ft.start_latitude is not null and ft.start_longitude is not null
                      and (2 * 6371000 * asin(sqrt(
                            sin(radians(ft.start_latitude - np.latitude) / 2)^2
                            + cos(radians(ft.start_latitude)) * cos(radians(np.latitude))
                            * sin(radians(ft.start_longitude - np.longitude) / 2)^2
                          ))) <= np.radius_meters
                    order by (np.vehicle_id = ft.vehicle_id) desc, np.radius_meters, np.id
                    limit 1
                ) p on true
                union all
                select ft.*, p.id as place_id, p.name as place_name, 'arrival'::text as visit_type, ft.ended_at as visit_at
                from filtered_trips ft
                join lateral (
                    select np.id, np.name
                    from named_places np
                    where (np.vehicle_id = ft.vehicle_id or np.vehicle_id is null)
                      and ft.end_latitude is not null and ft.end_longitude is not null
                      and (2 * 6371000 * asin(sqrt(
                            sin(radians(ft.end_latitude - np.latitude) / 2)^2
                            + cos(radians(ft.end_latitude)) * cos(radians(np.latitude))
                            * sin(radians(ft.end_longitude - np.longitude) / 2)^2
                          ))) <= np.radius_meters
                    order by (np.vehicle_id = ft.vehicle_id) desc, np.radius_meters, np.id
                    limit 1
                ) p on true
            ), place_trips as (
                select place_id, place_name, vehicle_id, vehicle_name, trip_id,
                       max(distance_meters) as distance_meters, max(duration_seconds) as duration_seconds,
                       max(visit_at) as visit_at,
                       bool_or(visit_type = 'arrival') as arrived,
                       bool_or(visit_type = 'departure') as departed
                from (select place_id, place_name, vehicle_id, vehicle_name, id as trip_id, distance_meters, duration_seconds, visit_at, visit_type from endpoint_visits) visits
                group by place_id, place_name, vehicle_id, vehicle_name, trip_id
            )
            select place_id, place_name, vehicle_id, vehicle_name,
                   count(*)::int as trip_count,
                   sum((arrived)::int)::int as arrivals,
                   sum((departed)::int)::int as departures,
                   coalesce(sum(distance_meters), 0)::double precision as distance_meters,
                   coalesce(sum(duration_seconds), 0)::bigint as duration_seconds,
                   avg(distance_meters)::double precision as average_distance_meters,
                   avg(duration_seconds)::double precision as average_duration_seconds,
                   max(visit_at) as last_visit
            from place_trips
            group by place_id, place_name, vehicle_id, vehicle_name
            order by last_visit desc, place_name
            """, connection);
        command.Parameters.AddWithValue("from", start.UtcDateTime);
        command.Parameters.AddWithValue("to", end.UtcDateTime);
        command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value);
        command.Parameters.AddWithValue("tagId", (object?)tagId ?? DBNull.Value);
        command.Parameters.AddWithValue("authEnabled", authOptions.Enabled);
        command.Parameters.AddWithValue("isAdmin", isAdmin);
        command.Parameters.AddWithValue("username", username);

        var rows = new List<PlaceReportRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(new PlaceReportRow(reader.GetGuid(0), reader.GetString(1), reader.GetGuid(2), reader.GetString(3), reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetDouble(7), reader.GetInt64(8), reader.GetDouble(9), reader.GetDouble(10), reader.GetDateTime(11)));

        var report = new
        {
            reportType = "places",
            generatedAtUtc = DateTimeOffset.UtcNow,
            units = reportUnits,
            storageUnits = new { distance = "m", duration = "s" },
            filters = new { from = start, to = end, units = reportUnits, vehicleId, tagId },
            summary = new { placeCount = rows.Count, visitCount = rows.Sum(r => r.TripCount), distanceMeters = rows.Sum(r => r.DistanceMeters), durationSeconds = rows.Sum(r => r.DurationSeconds) },
            warnings = rows.Count == 0 ? new[] { "No named-place visits matched the selected filters." } : Array.Empty<string>(),
            rows
        };
        if (string.Equals(format, "csv", StringComparison.OrdinalIgnoreCase))
            return Results.File(BuildCsv(rows, reportUnits), "text/csv; charset=utf-8", $"places-{start:yyyyMMdd}-{end:yyyyMMdd}.csv");
        return Results.Ok(report);
    }

    private static byte[] BuildCsv(IEnumerable<PlaceReportRow> rows, string units)
    {
        var distanceUnit = units == "metric" ? "km" : "mi";
        var builder = new StringBuilder($"Place,Vehicle,Visits,Arrivals,Departures,Distance ({distanceUnit}),Duration (min),Average distance ({distanceUnit}),Average duration (min),Last visit\n");
        foreach (var row in rows)
        {
            var distance = units == "metric" ? row.DistanceMeters / 1000d : row.DistanceMeters / 1609.344d;
            var averageDistance = units == "metric" ? row.AverageDistanceMeters / 1000d : row.AverageDistanceMeters / 1609.344d;
            builder.Append(Escape(row.PlaceName)).Append(',').Append(Escape(row.VehicleName)).Append(',')
                .Append(row.TripCount.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(row.Arrivals.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(row.Departures.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(distance.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append((row.DurationSeconds / 60d).ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(averageDistance.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append((row.AverageDurationSeconds / 60d).ToString(CultureInfo.InvariantCulture)).Append(',')
                .AppendLine(row.LastVisit.ToString("O", CultureInfo.InvariantCulture));
        }
        return Encoding.UTF8.GetBytes(builder.ToString());
    }

    private static string Escape(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
    private sealed record PlaceReportRow(Guid PlaceId, string PlaceName, Guid VehicleId, string VehicleName, int TripCount, int Arrivals, int Departures, double DistanceMeters, long DurationSeconds, double AverageDistanceMeters, double AverageDurationSeconds, DateTime LastVisit);
}

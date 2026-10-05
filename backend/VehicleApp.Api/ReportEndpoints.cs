using System.Globalization;
using System.Text;
using Npgsql;

public static class ReportEndpoints
{
    public static void MapReportEndpoints(this WebApplication app)
    {
        app.MapGet("/api/reports/usage-summary", GetUsageSummaryAsync)
            .WithName("GetUsageSummaryReport");
        app.MapGet("/api/reports/trip-log", GetTripLogAsync)
            .WithName("GetTripLogReport");
        app.MapGet("/api/reports/monthly-summary", GetMonthlySummaryAsync)
            .WithName("GetMonthlySummaryReport");
    }

    private static Task<IResult> GetTripLogAsync(
        DateTimeOffset? from,
        DateTimeOffset? to,
        Guid? vehicleId,
        Guid? tagId,
        string? format,
        string? timeZone,
        string? units,
        NpgsqlDataSource dataSource,
        VehicleAppAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
        => GetUsageSummaryAsync(from, to, "trip", vehicleId, tagId, format, timeZone, units, dataSource, authOptions, context, cancellationToken, "trip-log");

    private static Task<IResult> GetMonthlySummaryAsync(
        DateTimeOffset? from,
        DateTimeOffset? to,
        Guid? vehicleId,
        Guid? tagId,
        string? format,
        string? timeZone,
        string? units,
        NpgsqlDataSource dataSource,
        VehicleAppAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken)
        => GetUsageSummaryAsync(from, to, "month", vehicleId, tagId, format, timeZone, units, dataSource, authOptions, context, cancellationToken, "monthly-summary");

    private static async Task<IResult> GetUsageSummaryAsync(
        DateTimeOffset? from,
        DateTimeOffset? to,
        string? groupBy,
        Guid? vehicleId,
        Guid? tagId,
        string? format,
        string? timeZone,
        string? units,
        NpgsqlDataSource dataSource,
        VehicleAppAuthOptions authOptions,
        HttpContext context,
        CancellationToken cancellationToken,
        string reportType = "usage-summary")
    {
        var start = from ?? DateTimeOffset.UtcNow.AddDays(-30);
        var end = to ?? DateTimeOffset.UtcNow;
        if (end < start)
            return Results.BadRequest(new { title = "Invalid report range", detail = "The through date must be on or after the from date." });

        var grouping = groupBy?.Trim().ToLowerInvariant() switch
        {
            "day" => "day",
            "week" => "week",
            "month" => "month",
            "year" => "year",
            _ => "trip"
        };
        var reportTimeZone = string.IsNullOrWhiteSpace(timeZone) ? "UTC" : timeZone.Trim();
        if (reportTimeZone.Length > 80 || reportTimeZone.Any(char.IsControl) || reportTimeZone.Contains('\''))
            return Results.BadRequest(new { title = "Invalid report time zone", detail = "Use an IANA time zone such as America/New_York." });
        var reportUnits = units?.Trim().ToLowerInvariant() switch
        {
            null or "" or "imperial" => "imperial",
            "metric" => "metric",
            _ => null
        };
        if (reportUnits is null)
            return Results.BadRequest(new { title = "Invalid report units", detail = "Units must be imperial or metric." });
        var localStartedAt = $"t.started_at AT TIME ZONE @timeZone";
        var periodExpression = grouping == "trip" ? "t.started_at" : $"date_trunc('{grouping}', {localStartedAt})";
        var endedAtExpression = grouping == "trip" ? "t.ended_at" : "null";
        var startAddressExpression = grouping == "trip" ? "coalesce(nullif(t.start_label, ''), t.start_place_name, t.start_address)" : "null";
        var endAddressExpression = grouping == "trip" ? "coalesce(nullif(t.end_label, ''), t.end_place_name, t.end_address)" : "null";
        var startLatitudeExpression = grouping == "trip" ? "t.start_latitude" : "null";
        var startLongitudeExpression = grouping == "trip" ? "t.start_longitude" : "null";
        var endLatitudeExpression = grouping == "trip" ? "t.end_latitude" : "null";
        var endLongitudeExpression = grouping == "trip" ? "t.end_longitude" : "null";
        var groupingExpression = grouping == "trip"
            ? "t.id, t.started_at, t.ended_at, t.start_label, t.end_label, t.start_place_name, t.end_place_name, t.start_address, t.end_address, t.start_latitude, t.start_longitude, t.end_latitude, t.end_longitude, t.vehicle_id, t.vehicle_name"
            : $"{periodExpression}, t.vehicle_id, t.vehicle_name";

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var isAdmin = context.User.IsInRole("admin");
        var username = context.User.Identity?.Name ?? string.Empty;
        if (vehicleId.HasValue && authOptions.Enabled && !isAdmin)
        {
            await using var accessCommand = new NpgsqlCommand("""
                select exists (select 1 from vehicles where id = @vehicleId),
                       exists (
                         select 1 from app_user_vehicle_access ua
                         join app_users u on u.id = ua.user_id
                         where ua.vehicle_id = @vehicleId and u.username = @username and u.active
                         union
                         select 1 from app_group_vehicle_access ga
                         join app_group_memberships gm on gm.group_id = ga.group_id
                         join app_users u on u.id = gm.user_id
                         where ga.vehicle_id = @vehicleId and u.username = @username and u.active
                       )
                """, connection);
            accessCommand.Parameters.AddWithValue("vehicleId", vehicleId.Value);
            accessCommand.Parameters.AddWithValue("username", username);
            await using var accessReader = await accessCommand.ExecuteReaderAsync(cancellationToken);
            await accessReader.ReadAsync(cancellationToken);
            if (!accessReader.GetBoolean(0)) return Results.NotFound(new { title = "Vehicle not found" });
            if (!accessReader.GetBoolean(1)) return Results.Forbid();
        }
        await using var command = new NpgsqlCommand($"""
            with filtered_trips as (
                select t.*, v.display_name as vehicle_name,
                       start_place_name.name as start_place_name,
                       end_place_name.name as end_place_name
                from trips t
                join vehicles v on v.id = t.vehicle_id
                left join lateral (
                    select np.name
                    from named_places np
                    where (np.vehicle_id = t.vehicle_id or np.vehicle_id is null)
                      and t.start_latitude is not null and t.start_longitude is not null
                      and (2 * 6371000 * asin(sqrt(
                            sin(radians(t.start_latitude - np.latitude) / 2)^2
                            + cos(radians(t.start_latitude)) * cos(radians(np.latitude))
                            * sin(radians(t.start_longitude - np.longitude) / 2)^2
                          ))) <= np.radius_meters
                    order by (np.vehicle_id = t.vehicle_id) desc, np.radius_meters, np.id
                    limit 1
                ) start_place_name on true
                left join lateral (
                    select np.name
                    from named_places np
                    where (np.vehicle_id = t.vehicle_id or np.vehicle_id is null)
                      and t.end_latitude is not null and t.end_longitude is not null
                      and (2 * 6371000 * asin(sqrt(
                            sin(radians(t.end_latitude - np.latitude) / 2)^2
                            + cos(radians(t.end_latitude)) * cos(radians(np.latitude))
                            * sin(radians(t.end_longitude - np.longitude) / 2)^2
                          ))) <= np.radius_meters
                    order by (np.vehicle_id = t.vehicle_id) desc, np.radius_meters, np.id
                    limit 1
                ) end_place_name on true
                where t.started_at >= @from and t.started_at <= @to
                  and (cast(@vehicleId as uuid) is null or t.vehicle_id = cast(@vehicleId as uuid))
                  and (not @authEnabled or @isAdmin or exists (
                         select 1 from app_user_vehicle_access ua
                         join app_users u on u.id = ua.user_id
                         where ua.vehicle_id = t.vehicle_id and u.username = @username and u.active
                       ) or exists (
                         select 1 from app_group_vehicle_access ga
                         join app_group_memberships gm on gm.group_id = ga.group_id
                         join app_users u on u.id = gm.user_id
                         where ga.vehicle_id = t.vehicle_id and u.username = @username and u.active
                       ))
                  and (cast(@tagId as uuid) is null or exists (
                         select 1 from trip_tag_map tm
                         where tm.trip_id = t.id and tm.tag_id = cast(@tagId as uuid)
                       ))
            ), event_counts as (
                select e.trip_id, count(*)::int as event_count
                from trip_events e
                join filtered_trips ft on ft.id = e.trip_id
                group by e.trip_id
            )
            select {periodExpression} as period,
                   {(grouping == "trip" ? "t.id" : "null")} as trip_id,
                   t.vehicle_id,
                   t.vehicle_name,
                   {endedAtExpression} as ended_at,
                   {startAddressExpression} as start_address,
                   {endAddressExpression} as end_address,
                   {startLatitudeExpression} as start_latitude,
                   {startLongitudeExpression} as start_longitude,
                   {endLatitudeExpression} as end_latitude,
                   {endLongitudeExpression} as end_longitude,
                   count(*)::int as trip_count,
                   coalesce(sum(t.distance_meters), 0)::double precision as distance_meters,
                   coalesce(sum(t.duration_seconds), 0)::bigint as duration_seconds,
                   coalesce(avg(t.distance_meters), 0)::double precision as average_distance_meters,
                   coalesce(avg(t.duration_seconds), 0)::double precision as average_duration_seconds,
                   max(t.max_speed_mph)::double precision as max_speed_mph,
                   coalesce(sum(ec.event_count), 0)::int as event_count
            from filtered_trips t
            left join event_counts ec on ec.trip_id = t.id
            group by {groupingExpression}
            order by period desc, vehicle_name
            """, connection);
        command.Parameters.AddWithValue("from", start.UtcDateTime);
        command.Parameters.AddWithValue("to", end.UtcDateTime);
        command.Parameters.AddWithValue("timeZone", reportTimeZone);
        command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value);
        command.Parameters.AddWithValue("tagId", (object?)tagId ?? DBNull.Value);
        command.Parameters.AddWithValue("authEnabled", authOptions.Enabled);
        command.Parameters.AddWithValue("isAdmin", isAdmin);
        command.Parameters.AddWithValue("username", username);

        var rows = new List<UsageSummaryRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new UsageSummaryRow(
                reader.GetFieldValue<DateTime>(0),
                reader.IsDBNull(1) ? null : reader.GetFieldValue<Guid>(1),
                reader.GetFieldValue<Guid>(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? (DateTime?)null : reader.GetFieldValue<DateTime>(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? (double?)null : reader.GetDouble(7),
                reader.IsDBNull(8) ? (double?)null : reader.GetDouble(8),
                reader.IsDBNull(9) ? (double?)null : reader.GetDouble(9),
                reader.IsDBNull(10) ? (double?)null : reader.GetDouble(10),
                reader.GetInt32(11),
                reader.GetDouble(12),
                reader.GetInt64(13),
                reader.GetDouble(14),
                reader.GetDouble(15),
                reader.IsDBNull(16) ? null : reader.GetDouble(16),
                reader.GetInt32(17)));
        }

        var tripCount = rows.Sum(row => row.TripCount);
        var distanceMeters = rows.Sum(row => row.DistanceMeters);
        var durationSeconds = rows.Sum(row => row.DurationSeconds);
        var summary = new
        {
            tripCount,
            distanceMeters,
            durationSeconds,
            averageTripDistanceMeters = tripCount == 0 ? (double?)null : distanceMeters / tripCount,
            averageTripDurationSeconds = tripCount == 0 ? (double?)null : (double)durationSeconds / tripCount,
            eventCount = rows.Sum(row => row.EventCount),
            maxSpeedMph = rows.Where(row => row.MaxSpeedMph.HasValue).Select(row => row.MaxSpeedMph!.Value).Cast<double?>().Max()
        };
        var report = new
        {
            reportType,
            generatedAtUtc = DateTimeOffset.UtcNow,
            units = reportUnits,
            storageUnits = new { distance = "m", duration = "s", speed = "mph" },
            filters = new { from = start, to = end, groupBy = grouping, timeZone = reportTimeZone, units = reportUnits, vehicleId, tagId },
            summary,
            columns = BuildColumns(reportType),
            warnings = rows.Count == 0 ? new[] { "No trips matched the selected filters." } : Array.Empty<string>(),
            rows
        };

        if (string.Equals(format, "csv", StringComparison.OrdinalIgnoreCase))
            return Results.File(BuildCsv(rows, reportUnits, reportType), "text/csv; charset=utf-8", $"{reportType}-{start:yyyyMMdd}-{end:yyyyMMdd}.csv");

        return Results.Ok(report);
    }

    private static byte[] BuildCsv(IEnumerable<UsageSummaryRow> rows, string units, string reportType)
    {
        var builder = new StringBuilder();
        var distanceUnit = units == "metric" ? "km" : "mi";
        var speedUnit = units == "metric" ? "km/h" : "mph";
        builder.AppendLine(reportType == "trip-log"
            ? $"Period,Trip ID,Vehicle,End,From,To,Distance ({distanceUnit}),Duration (min),Max Speed ({speedUnit}),Events"
            : $"Period,Trip ID,Vehicle,Trips,Distance ({distanceUnit}),Duration (min),Average Distance ({distanceUnit}),Average Duration (min),Max Speed ({speedUnit}),Events");
        foreach (var row in rows)
        {
            builder.Append(Escape(row.Period.ToString("O", CultureInfo.InvariantCulture))).Append(',');
            builder.Append(Escape(row.TripId?.ToString() ?? string.Empty)).Append(',');
            builder.Append(Escape(row.VehicleName)).Append(',');
            if (reportType == "trip-log") builder.Append(Escape(row.EndedAt?.ToString("O", CultureInfo.InvariantCulture) ?? string.Empty)).Append(',');
            if (reportType == "trip-log")
            {
                builder.Append(Escape(LocationText(row.StartAddress, row.StartLatitude, row.StartLongitude))).Append(',');
                builder.Append(Escape(LocationText(row.EndAddress, row.EndLatitude, row.EndLongitude))).Append(',');
            }
            if (reportType != "trip-log") builder.Append(row.TripCount.ToString(CultureInfo.InvariantCulture)).Append(',');
            var distance = units == "metric" ? row.DistanceMeters / 1000d : row.DistanceMeters / 1609.344d;
            var averageDistance = units == "metric" ? row.AverageDistanceMeters / 1000d : row.AverageDistanceMeters / 1609.344d;
            var speed = row.MaxSpeedMph.HasValue && units == "metric" ? row.MaxSpeedMph.Value * 1.609344d : row.MaxSpeedMph;
            builder.Append(distance.ToString(CultureInfo.InvariantCulture)).Append(',');
            builder.Append((row.DurationSeconds / 60d).ToString(CultureInfo.InvariantCulture)).Append(',');
            if (reportType != "trip-log")
            {
                builder.Append(averageDistance.ToString(CultureInfo.InvariantCulture)).Append(',');
                builder.Append((row.AverageDurationSeconds / 60d).ToString(CultureInfo.InvariantCulture)).Append(',');
            }
            builder.Append(speed?.ToString(CultureInfo.InvariantCulture) ?? string.Empty).Append(',');
            builder.AppendLine(row.EventCount.ToString(CultureInfo.InvariantCulture));
        }
        return Encoding.UTF8.GetBytes(builder.ToString());
    }

    private static string Escape(string value) => $"\"{value.Replace("\"", "\"\"")}\"";

    private static string LocationText(string? address, double? latitude, double? longitude)
        => !string.IsNullOrWhiteSpace(address) ? address : latitude.HasValue && longitude.HasValue ? $"{latitude.Value:F5}, {longitude.Value:F5}" : string.Empty;

    private static ReportColumn[] BuildColumns(string reportType) => reportType == "trip-log"
        ? new[] { new ReportColumn("period", "Period", null), new ReportColumn("tripId", "Trip ID", null), new ReportColumn("vehicleName", "Vehicle", null), new ReportColumn("endedAt", "End", null), new ReportColumn("startAddress", "From", null), new ReportColumn("endAddress", "To", null), new ReportColumn("distanceMeters", "Distance", "m"), new ReportColumn("durationSeconds", "Duration", "s"), new ReportColumn("maxSpeedMph", "Maximum speed", "mph"), new ReportColumn("eventCount", "Events", null) }
        : new[] { new ReportColumn("period", "Period", null), new ReportColumn("tripId", "Trip ID", null), new ReportColumn("vehicleName", "Vehicle", null), new ReportColumn("tripCount", "Trips", null), new ReportColumn("distanceMeters", "Distance", "m"), new ReportColumn("durationSeconds", "Duration", "s"), new ReportColumn("averageDistanceMeters", "Average distance", "m"), new ReportColumn("averageDurationSeconds", "Average duration", "s"), new ReportColumn("maxSpeedMph", "Maximum speed", "mph"), new ReportColumn("eventCount", "Events", null) };

    private sealed record UsageSummaryRow(
        DateTime Period,
        Guid? TripId,
        Guid VehicleId,
        string VehicleName,
        DateTime? EndedAt,
        string? StartAddress,
        string? EndAddress,
        double? StartLatitude,
        double? StartLongitude,
        double? EndLatitude,
        double? EndLongitude,
        int TripCount,
        double DistanceMeters,
        long DurationSeconds,
        double AverageDistanceMeters,
        double AverageDurationSeconds,
        double? MaxSpeedMph,
        int EventCount);

    private sealed record ReportColumn(string Key, string Label, string? Unit);
}

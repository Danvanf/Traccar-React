using System.Text.Json;
using Npgsql;

public static class SpeedBandReportEndpoints
{
    public static void MapSpeedBandReportEndpoints(this WebApplication app) => app.MapGet("/api/reports/speed-bands", GetAsync).WithName("GetSpeedBandReport");

    private static async Task<IResult> GetAsync(DateTimeOffset? from, DateTimeOffset? to, Guid? vehicleId, Guid? tagId, NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken)
    {
        var start = from ?? DateTimeOffset.UtcNow.AddMonths(-1); var end = to ?? DateTimeOffset.UtcNow;
        if (end < start) return Results.BadRequest(new { title = "Invalid report range" });
        var admin = context.User.IsInRole("admin"); var username = context.User.Identity?.Name ?? string.Empty;
        await using var db = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
          select t.vehicle_id, v.display_name, coalesce(sb.bands, '[]'::jsonb), t.traccar_device_id, t.started_at, t.ended_at, rp.trip_id, rp.point_index, rp.latitude, rp.longitude, rp.speed_mph
          from trips t join vehicles v on v.id=t.vehicle_id left join vehicle_speed_bands sb on sb.vehicle_id=t.vehicle_id
          left join trip_route_points rp on rp.trip_id=t.id
          where t.started_at >= @from and t.started_at <= @to
            and (cast(@vehicleId as uuid) is null or t.vehicle_id=cast(@vehicleId as uuid))
            and (cast(@tagId as uuid) is null or exists (select 1 from trip_tag_map tm where tm.trip_id=t.id and tm.tag_id=cast(@tagId as uuid)))
            -- Bouncie's historical REST GPS is geometry-only. It has no
            -- speed per coordinate, so speed-band distance is Traccar-only.
            and coalesce(t.external_metadata ->> 'source', '') <> 'bouncie-rest-v1'
            and coalesce(t.derivation_version, '') <> 'bouncie-csv-v1'
            and (not @authEnabled or @admin or exists (select 1 from app_user_vehicle_access ua join app_users u on u.id=ua.user_id where ua.vehicle_id=t.vehicle_id and u.username=@username and u.active) or exists (select 1 from app_group_vehicle_access ga join app_group_memberships gm on gm.group_id=ga.group_id join app_users u on u.id=gm.user_id where ga.vehicle_id=t.vehicle_id and u.username=@username and u.active))
          order by t.vehicle_id, rp.trip_id, rp.point_index
          """, db);
        command.Parameters.AddWithValue("from", start.UtcDateTime); command.Parameters.AddWithValue("to", end.UtcDateTime); command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value); command.Parameters.AddWithValue("tagId", (object?)tagId ?? DBNull.Value); command.Parameters.AddWithValue("authEnabled", authOptions.Enabled); command.Parameters.AddWithValue("admin", admin); command.Parameters.AddWithValue("username", username);
        var states = new Dictionary<Guid, State>();
        var windows = new List<TraccarWindow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var id = reader.GetGuid(0); if (!states.TryGetValue(id, out var state)) { state = new State(id, reader.GetString(1), reader.GetString(2)); states[id] = state; }
            if (!reader.IsDBNull(3))
            {
                var window = new TraccarWindow(id, reader.GetString(1), reader.GetInt32(3), reader.GetFieldValue<DateTime>(4), reader.GetFieldValue<DateTime>(5));
                if (!windows.Any(existing => existing.VehicleId == window.VehicleId && existing.StartedAt == window.StartedAt && existing.EndedAt == window.EndedAt)) windows.Add(window);
            }
            if (reader.IsDBNull(6)) continue;
            state.HasRoute = true;
            if (reader.IsDBNull(10)) continue;
            var trip = reader.GetGuid(6); var index = reader.GetInt32(7); var lat = reader.GetDouble(8); var lon = reader.GetDouble(9); var mph = reader.GetDouble(10);
            if (state.Trip == trip && state.Index + 1 == index) state.Add(state.Lat, state.Lon, lat, lon, mph);
            state.Trip = trip; state.Index = index; state.Lat = lat; state.Lon = lon;
        }
        var rows = states.Values.SelectMany(s => s.Rows()).ToArray();
        var warnings = new List<string>
        {
            "Speed Bands currently use Traccar point-speed data only. Bouncie historical trips are excluded because their GPS coordinates do not include speed per point."
        };
        return Results.Ok(new { reportType = "speed-bands", generatedAtUtc = DateTimeOffset.UtcNow, filters = new { from = start, to = end, vehicleId, tagId }, summary = new { vehicles = states.Count, routeVehicles = states.Values.Count(s => s.HasRoute), distanceMeters = rows.Sum(r => r.DistanceMeters) }, warnings, traccarWindows = windows, rows });
    }

    private static double Meters(double a, double b, double c, double d) { const double r=6371000; var p=Math.PI/180; var x=Math.Sin((c-a)*p/2); var y=Math.Sin((d-b)*p/2); return 2*r*Math.Asin(Math.Sqrt(x*x+Math.Cos(a*p)*Math.Cos(c*p)*y*y)); }
    private sealed record Band(Guid VehicleId,string VehicleName,int BandIndex,double FromMph,double? ThroughMph,string Color,double DistanceMeters,int Points);
    private sealed record TraccarWindow(Guid VehicleId, string VehicleName, int TraccarDeviceId, DateTime StartedAt, DateTime EndedAt);
    private sealed class State
    {
        public Guid Id; public string Name; public string Json; public bool HasRoute; public Guid Trip; public int Index=-1; public double Lat,Lon; private readonly List<Band> bands=new();
        public State(Guid id,string name,string json){Id=id;Name=name;Json=json;}
        public void Add(double a,double b,double c,double d,double mph){using var doc=JsonDocument.Parse(Json);var i=0;foreach(var e in doc.RootElement.EnumerateArray()){var f=e.TryGetProperty("fromMph",out var fv)?fv.GetDouble():i*20;double? t=e.TryGetProperty("throughMph",out var tv)&&tv.ValueKind!=JsonValueKind.Null?tv.GetDouble():null;if(mph>=f&&(t is null||mph<=t)){var color=e.TryGetProperty("color",out var cv)?cv.GetString()??"":string.Empty;var distance=Meters(a,b,c,d);var old=bands.FirstOrDefault(x=>x.BandIndex==i);if(old is null)bands.Add(new Band(Id,Name,i,f,t,color,distance,1));else bands[bands.IndexOf(old)]=old with{DistanceMeters=old.DistanceMeters+distance,Points=old.Points+1};break;}i++;}}
        public IEnumerable<Band> Rows()
        {
            if (bands.Count > 0) return bands;
            using var doc = JsonDocument.Parse(Json);
            var fallback = new List<Band>(); var index = 0;
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var from = item.TryGetProperty("fromMph", out var fromValue) ? fromValue.GetDouble() : index * 20;
                double? through = item.TryGetProperty("throughMph", out var throughValue) && throughValue.ValueKind != JsonValueKind.Null ? throughValue.GetDouble() : null;
                var color = item.TryGetProperty("color", out var colorValue) ? colorValue.GetString() ?? string.Empty : string.Empty;
                fallback.Add(new Band(Id, Name, index++, from, through, color, 0, 0));
            }
            if (fallback.Count == 0)
                fallback.AddRange(new[] { 20d, 40d, 60d, 80d }.Select((through, i) => new Band(Id, Name, i, i * 20, through, string.Empty, 0, 0)).Append(new Band(Id, Name, 4, 80, null, string.Empty, 0, 0)));
            return fallback;
        }
    }
}

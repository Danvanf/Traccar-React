using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

// Requires an explicit disposable test database; never falls back to app configuration.
var connection = Environment.GetEnvironmentVariable("VEHICLE_ACCESS_TEST_CONNECTION")
    ?? throw new Exception("Set VEHICLE_ACCESS_TEST_CONNECTION to a disposable test database, or use Run-Isolated.ps1.");
var connectionBuilder = new NpgsqlConnectionStringBuilder(connection);
var schema = "vehicle_access_test_" + Guid.NewGuid().ToString("N");
await using var schemaAdmin = NpgsqlDataSource.Create(connectionBuilder.ConnectionString);
connectionBuilder.SearchPath = schema;
await using var data = NpgsqlDataSource.Create(connectionBuilder.ConnectionString);
var auth = new TraccarScopeApiAuthOptions(null, null, false);
var userId = Guid.NewGuid();
var groupId = Guid.NewGuid();
var allowedVehicle = Guid.NewGuid();
var deniedVehicle = Guid.NewGuid();
var allowedTrip = Guid.NewGuid();
var deniedTrip = Guid.NewGuid();
const int allowedDevice = 1900000001;
const int deniedDevice = 1900000002;
var context = new DefaultHttpContext { User = Principal("regular") };
var created = false;
try
{
    await using (var command = schemaAdmin.CreateCommand($"create schema {schema}")) await command.ExecuteNonQueryAsync();
    created = true;
    await Sql("""
        create table app_users(id uuid primary key, username text, active boolean);
        create table app_user_vehicle_access(user_id uuid, vehicle_id uuid);
        create table app_group_vehicle_access(group_id uuid, vehicle_id uuid);
        create table app_group_memberships(group_id uuid, user_id uuid);
        create table app_user_device_access(user_id uuid, traccar_device_id integer);
        create table app_group_device_access(group_id uuid, traccar_device_id integer);
        create table vehicle_device_bindings(vehicle_id uuid, traccar_device_id integer, ends_at timestamptz);
        create table trips(id uuid primary key, vehicle_id uuid, traccar_device_id integer);
        create table trip_route_points(trip_id uuid, point_index integer, occurred_at timestamptz,
            latitude double precision, longitude double precision, speed_mph double precision);
        """);
    Check("test search_path has no application schema fallback", (string)(await Sql("select current_schema()"))! == schema);
    await Sql("insert into app_users values (@u, 'access-fixture', true)", ("u", userId));
    await Sql("insert into app_user_device_access values (@u, @d)", ("u", userId), ("d", allowedDevice));
    await Sql("insert into trips values (@a, @av, @ad), (@b, @bv, @bd)",
        ("a", allowedTrip), ("av", allowedVehicle), ("ad", allowedDevice),
        ("b", deniedTrip), ("bv", deniedVehicle), ("bd", deniedDevice));
    await Sql("insert into trip_route_points values (@t, 0, now(), 0, 0, 0)", ("t", allowedTrip));
    await Sql("insert into trip_route_points values (@t, 0, now(), 1, 1, 0)", ("t", deniedTrip));
    Check("direct device grant permits its device", await Device(allowedDevice));
    Check("known existing out-of-scope device is denied", !await Device(deniedDevice));
    Check("invalid device id is denied", !await Device(0));
    Check("direct device grant permits its trip", await Trip(allowedTrip));
    Check("known existing out-of-scope trip is denied", !await Trip(deniedTrip));
    Check("readable device list excludes the out-of-scope device",
        (await VehicleAccess.GetReadableDeviceIdsAsync(data, auth, context, CancellationToken.None))!.SetEquals([allowedDevice]));

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [], EnvironmentName = "Testing" });
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));
    builder.Services.AddSingleton(data);
    builder.Services.AddSingleton(auth);
    builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
    builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(TraccarScopeCookieAuthentication.Configure);
    builder.Services.AddAuthorization();
    await using (var app = builder.Build())
    {
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapPost("/fixture-session", async (HttpContext http) =>
        {
            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, Principal("regular"));
            return Results.NoContent();
        });
        app.MapTripRoutePointEndpoints();
        await app.StartAsync();
        try
        {
            using var handler = new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false };
            using var client = new HttpClient(handler) { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(10) };
            using var login = await client.PostAsync("/fixture-session", null);
            Check("test-only regular identity receives a session", login.StatusCode == HttpStatusCode.NoContent);
            var cookie = login.Headers.GetValues("Set-Cookie").Single().Split(';')[0];
            using var permittedRequest = new HttpRequestMessage(HttpMethod.Get, $"/api/trips/{allowedTrip}/route-points");
            permittedRequest.Headers.Add("Cookie", cookie);
            using var permitted = await client.SendAsync(permittedRequest);
            Check("real trip route endpoint returns permitted fixture geometry", permitted.StatusCode == HttpStatusCode.OK
                && (await permitted.Content.ReadAsStringAsync()).Contains("pointIndex"));
            using var deniedRequest = new HttpRequestMessage(HttpMethod.Get, $"/api/trips/{deniedTrip}/route-points");
            deniedRequest.Headers.Add("Cookie", cookie);
            using var denied = await client.SendAsync(deniedRequest);
            Check("real trip route endpoint returns 403 for existing out-of-scope trip", denied.StatusCode == HttpStatusCode.Forbidden
                && denied.Headers.Location is null && string.IsNullOrWhiteSpace(await denied.Content.ReadAsStringAsync()));
        }
        finally { await app.StopAsync(); }
    }

    await Sql("delete from app_user_device_access");
    await Sql("insert into app_group_memberships values (@g, @u)", ("g", groupId), ("u", userId));
    await Sql("insert into app_group_device_access values (@g, @d)", ("g", groupId), ("d", allowedDevice));
    Check("group device grant permits its device and trip", await Device(allowedDevice) && await Trip(allowedTrip));
    Check("group device grant does not expose unrelated device/trip", !await Device(deniedDevice) && !await Trip(deniedTrip));
    await Sql("delete from app_group_device_access");
    await Sql("insert into app_user_vehicle_access values (@u, @v)", ("u", userId), ("v", allowedVehicle));
    await Sql("insert into vehicle_device_bindings values (@v, @d, null)", ("v", allowedVehicle), ("d", allowedDevice));
    Check("current vehicle binding permits its device and trip", await Device(allowedDevice) && await Trip(allowedTrip));
    Check("vehicle grant does not expose unrelated device/trip", !await Device(deniedDevice) && !await Trip(deniedTrip));
    await Sql("delete from app_user_vehicle_access");
    await Sql("insert into app_group_vehicle_access values (@g, @v)", ("g", groupId), ("v", allowedVehicle));
    Check("group vehicle grant permits its device and trip", await Device(allowedDevice) && await Trip(allowedTrip));
    await Sql("update app_users set active=false");
    Check("inactive regular user cannot read previously granted device/trip", !await Device(allowedDevice) && !await Trip(allowedTrip));
    Check("inactive regular user has no readable devices", (await VehicleAccess.GetReadableDeviceIdsAsync(data, auth, context, CancellationToken.None))!.Count == 0);
    Console.WriteLine("Vehicle access: all isolated database/HTTP checks passed.");
}
finally
{
    if (created)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(schema, "^vehicle_access_test_[0-9a-f]{32}$")) throw new Exception("Unsafe test schema cleanup target.");
        await using var cleanup = schemaAdmin.CreateCommand($"drop schema {schema} cascade");
        await cleanup.ExecuteNonQueryAsync();
        Console.WriteLine("Disposable schema removed; existing application records untouched.");
    }
}

Task<bool> Device(int id) => VehicleAccess.CanReadDeviceAsync(id, data, auth, context, CancellationToken.None);
Task<bool> Trip(Guid id) => VehicleAccess.CanReadTripAsync(id, data, auth, context, CancellationToken.None);
async Task<object?> Sql(string sql, params (string Name, object Value)[] parameters)
{
    await using var command = data.CreateCommand(sql);
    foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
    return await command.ExecuteScalarAsync();
}
static ClaimsPrincipal Principal(string role) => new(new ClaimsIdentity([
    new Claim(ClaimTypes.Name, "access-fixture"), new Claim(ClaimTypes.Role, role)
], CookieAuthenticationDefaults.AuthenticationScheme));
static void Check(string name, bool passed)
{
    if (!passed) throw new Exception("FAIL: " + name);
    Console.WriteLine("PASS: " + name);
}
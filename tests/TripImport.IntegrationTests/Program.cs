using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Npgsql;

// Run from the repo root. Only a fresh, randomly named schema is written or removed.
// Existing app tables are unreachable through this test connection's search_path.
var root = Directory.GetCurrentDirectory();
var config = new ConfigurationBuilder().SetBasePath(root)
    .AddJsonFile("backend/VehicleApp.Api/appsettings.json")
    .AddJsonFile("backend/VehicleApp.Api/appsettings.Development.json", optional: true)
    .AddEnvironmentVariables().Build();
var connectionString = Environment.GetEnvironmentVariable("TRIP_IMPORT_TEST_CONNECTION")
    ?? config.GetConnectionString("VehicleApp") ?? throw new Exception("Missing test connection.");
var connectionBuilder = new NpgsqlConnectionStringBuilder(connectionString);
var hostOverride = Environment.GetEnvironmentVariable("TRIP_IMPORT_TEST_HOST");
if (!string.IsNullOrWhiteSpace(hostOverride)) connectionBuilder.Host = hostOverride;
var portOverride = Environment.GetEnvironmentVariable("TRIP_IMPORT_TEST_PORT");
if (!string.IsNullOrWhiteSpace(portOverride)) connectionBuilder.Port = int.Parse(portOverride);
connectionString = connectionBuilder.ConnectionString;
var schema = "trip_import_test_" + Guid.NewGuid().ToString("N");
var testBuilder = new NpgsqlConnectionStringBuilder(connectionString) { SearchPath = schema };
await using var admin = NpgsqlDataSource.Create(connectionString);
await using var data = NpgsqlDataSource.Create(testBuilder.ConnectionString);
using var logger = LoggerFactory.Create(builder => builder.SetMinimumLevel(LogLevel.Critical));
var created = false;
var count = 0;
async Task<object?> Sql(string sql, params (string, object)[] parameters)
{
    await using var command = data.CreateCommand(sql);
    foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
    return await command.ExecuteScalarAsync();
}
void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAIL " + name);
    Console.WriteLine("PASS " + name); count++;
}
int Status(IResult result) => ((IStatusCodeHttpResult)result).StatusCode ?? 200;
ImportTripsByDeviceResponse Body(IResult result) => (ImportTripsByDeviceResponse)((IValueHttpResult)result).Value!;
var device = System.Security.Cryptography.RandomNumberGenerator.GetInt32(1500000000, 2000000000);
var start = DateTimeOffset.Parse("2026-01-15T12:00:00Z");
ImportTripItemRequest Trip(int minute, int length = 30) => new() {
    StartedAt = start.AddMinutes(minute), EndedAt = start.AddMinutes(minute + length),
    DurationSeconds = length * 60, DistanceMeters = 1000,
    StartTraccarPositionId = 1000 + minute, EndTraccarPositionId = 1000 + minute + length,
    Notes = "original note",
};
Task<IResult> Import(params ImportTripItemRequest[] trips) => TripImportEndpoints.ImportAsync(
    new ImportTripsByDeviceRequest { TraccarDeviceId = device, Trips = trips }, data, logger, CancellationToken.None);
try
{
    await using (var create = admin.CreateCommand($"create schema {schema}")) await create.ExecuteNonQueryAsync();
    created = true;
    var ddl = await File.ReadAllTextAsync(Path.Combine(root, "scripts/phase3_vehicle_app_schema.sql"));
    ddl = ddl[(ddl.IndexOf("-- Optional source registry", StringComparison.Ordinal))..];
    await Sql(ddl);
    var derivationSchema = await File.ReadAllTextAsync(Path.Combine(root, "scripts/phase5_trip_derivation_schema.sql"));
    derivationSchema = derivationSchema.Replace("\\set ON_ERROR_STOP on", "");
    await Sql(derivationSchema);
    Check((string)(await Sql("select current_schema()"))! == schema, "isolated search_path has no app schema fallback");
    var vehicleA = (Guid)(await Sql("insert into vehicles(display_name) values ('Isolated test A') returning id"))!;
    var vehicleB = (Guid)(await Sql("insert into vehicles(display_name) values ('Isolated test B') returning id"))!;
    await Sql("insert into vehicle_device_bindings(vehicle_id,traccar_device_id,starts_at) values (@vehicle,@device,@start)",
        ("vehicle", vehicleA), ("device", device), ("start", start.AddDays(-1)));

    var seed = await Import(Trip(0));
    Check(Status(seed) == 200 && Body(seed).Imported == 1, "initial import inserts exactly one trip");
    var id = Body(seed).Trips.Single().Id;
    var tag = (Guid)(await Sql("insert into trip_tags(name) values ('Keep tag') returning id"))!;
    await Sql("insert into trip_tag_map(trip_id,tag_id) values (@id,@tag)", ("id", id), ("tag", tag));
    var replay = await Import(Trip(0) with { Notes = "overwrite attempt", DistanceMeters = 9999 });
    Check(Status(replay) == 200 && Body(replay).Skipped == 1 && Body(replay).Trips.Single().Id == id,
        "exact replay returns the original UUID");
    Check((string)(await Sql("select notes from trips where id=@id", ("id", id)))! == "original note"
        && (double)(await Sql("select distance_meters from trips where id=@id", ("id", id)))! == 1000
        && (long)(await Sql("select count(*) from trip_tag_map where trip_id=@id", ("id", id)))! == 1,
        "replay preserves notes, metrics, and tag relationships");
    Check(Status(await Import(Trip(5, 10))) == 409, "contained partial range conflicts");
    Check(Status(await Import(Trip(-5, 40))) == 409, "wider range conflicts");
    Check(Status(await Import(Trip(0) with { EndTraccarPositionId = 777 })) == 409,
        "exact timestamps with contradictory source IDs conflict");
    Check(Status(await Import(Trip(60), Trip(5, 10))) == 409
        && (long)(await Sql("select count(*) from trips"))! == 1,
        "late batch conflict rolls back earlier inserts");
    Check(Status(await Import(Trip(30))) == 200, "adjacent non-overlapping trip is accepted");

    var concurrent = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => Import(Trip(120))));
    Check(concurrent.All(row => Status(row) == 200)
        && concurrent.Sum(row => Body(row).Imported) == 1 && concurrent.Sum(row => Body(row).Skipped) == 11
        && concurrent.Select(row => Body(row).Trips.Single().Id).Distinct().Count() == 1,
        "12 concurrent retries persist one trip and share its UUID");
    var overlaps = await Task.WhenAll(Import(Trip(240)), Import(Trip(250)));
    Check(overlaps.Count(row => Status(row) == 200) == 1 && overlaps.Count(row => Status(row) == 409) == 1,
        "concurrent overlapping requests have one winner and one conflict");
    Check(Status(await Import(Trip(360), Trip(370))) == 409
        && (long)(await Sql("select count(*) from trips where started_at >= @from", ("from", start.AddMinutes(360))))! == 0,
        "overlapping trips in one batch roll back together");
    var repeated = await Import(Trip(420), Trip(420));
    Check(Status(repeated) == 200 && Body(repeated).Imported == 1 && Body(repeated).Skipped == 1,
        "duplicate entries within a batch reuse one identity");

    await Sql("update vehicle_device_bindings set ends_at=now() where traccar_device_id=@device", ("device", device));
    Check(Status(await Import(Trip(0))) == 200, "exact replay works with no active binding");
    var futureStart = DateTimeOffset.UtcNow.AddHours(1);
    var futureTrip = Trip(600) with {
        StartedAt = futureStart,
        EndedAt = futureStart.AddMinutes(30),
        StartTraccarPositionId = 900001,
        EndTraccarPositionId = 900031,
    };
    Check(Status(await Import(futureTrip)) == 409, "new trip still requires a complete binding");
    await Sql("insert into vehicle_device_bindings(vehicle_id,traccar_device_id) values (@vehicle,@device)",
        ("vehicle", vehicleB), ("device", device));
    var rebound = await Import(Trip(0));
    Check(Status(rebound) == 200 && Body(rebound).Trips.Single().VehicleId == vehicleA,
        "rebind does not move or duplicate saved historical trips");
    var mixed = await Import(Trip(0), futureTrip);
    Check(Status(mixed) == 200 && Body(mixed).VehicleId is null && Body(mixed).Trips.Select(row => row.VehicleId).Distinct().Count() == 2,
        "mixed saved/new batch reports each trip vehicle without a misleading common vehicle");
    Check(Status(await Import(Trip(700) with { DistanceMeters = -1 })) == 400,
        "negative distance is rejected before persistence");
    Check(Status(await Import(Trip(700) with { EndedAt = start.AddMinutes(700) })) == 400,
        "zero-duration trip is rejected");
    Check(Status(await Import(Trip(700) with { StartTraccarPositionId = 0 })) == 400,
        "invalid source ID is rejected");

    // Legacy imports have no source position IDs; retries must not silently rewrite them.
    var legacy = await Import(Trip(720) with { StartTraccarPositionId = null, EndTraccarPositionId = null });
    var legacyReplay = await Import(Trip(720));
    Check(Status(legacyReplay) == 200 && Body(legacyReplay).Trips.Single().Id == Body(legacy).Trips.Single().Id,
        "legacy source-less trip remains idempotent");
    var duplicate = (Guid)(await Sql("insert into trips(vehicle_id,traccar_device_id,started_at,ended_at,duration_seconds) select vehicle_id,traccar_device_id,started_at,ended_at,duration_seconds from trips where id=@id returning id", ("id", id)))!;
    Check(Status(await Import(Trip(0))) == 409, "pre-existing duplicate rows require reconciliation");
    Check((long)(await Sql("select count(*) from trip_tag_map where trip_id=@id", ("id", id)))! == 1,
        "all conflict cases preserve original tag relationships");

    var migration = (await File.ReadAllTextAsync(Path.Combine(root, "scripts/trip_import_uniqueness.sql")))
        .Replace("\\set ON_ERROR_STOP on", "");
    async Task ApplyMigration()
    {
        await using var connection = await data.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(migration, connection);
        try { await command.ExecuteNonQueryAsync(); }
        catch
        {
            await using var rollback = new NpgsqlCommand("rollback", connection);
            await rollback.ExecuteNonQueryAsync();
            throw;
        }
    }
    var refused = false;
    try { await ApplyMigration(); } catch (PostgresException ex) when (ex.SqlState == "P0001") { refused = true; }
    Check(refused && (long)(await Sql("select count(*) from trips where id=@id", ("id", duplicate)))! == 1,
        "uniqueness migration refuses duplicates without deleting data");
    await Sql("delete from trips where id=@id", ("id", duplicate)); // This is the disposable duplicate created above.
    await ApplyMigration();
    await ApplyMigration();
    Check((long)(await Sql("select count(*) from pg_indexes where schemaname=current_schema() and indexname='ux_trips_default_source_identity'"))! == 1,
        "uniqueness migration is safely repeatable");
    var uniqueRejected = false;
    try
    {
        await Sql("insert into trips(vehicle_id,traccar_device_id,started_at,ended_at,duration_seconds) select vehicle_id,traccar_device_id,started_at,ended_at,duration_seconds from trips where id=@id", ("id", id));
    }
    catch (PostgresException ex) when (ex.SqlState == "23505") { uniqueRejected = true; }
    Check(uniqueRejected, "database index blocks an exact duplicate from an external writer");
    var indexedConcurrent = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Import(Trip(840))));
    Check(indexedConcurrent.All(row => Status(row) == 200)
        && indexedConcurrent.Sum(row => Body(row).Imported) == 1,
        "concurrent retries also pass with the database uniqueness index");

    var historicalDevice = System.Security.Cryptography.RandomNumberGenerator.GetInt32(1500000000, 2000000000);
    var historicalStart = start.AddDays(-100);
    var historicalChange = start.AddDays(-50);
    await Sql("insert into vehicle_device_bindings(vehicle_id,traccar_device_id,starts_at,ends_at) values (@vehicle,@device,@from,@to)",
        ("vehicle", vehicleA), ("device", historicalDevice), ("from", historicalStart), ("to", historicalChange));
    await Sql("insert into vehicle_device_bindings(vehicle_id,traccar_device_id,starts_at) values (@vehicle,@device,@from)",
        ("vehicle", vehicleB), ("device", historicalDevice), ("from", historicalChange));
    async Task<IResult> ImportHistorical(int minute) => await TripImportEndpoints.ImportAsync(
        new ImportTripsByDeviceRequest { TraccarDeviceId = historicalDevice, Trips = [Trip(minute) with { StartedAt = historicalStart.AddMinutes(minute), EndedAt = historicalStart.AddMinutes(minute + 30) }] }, data, logger, CancellationToken.None);
    var oldHistory = await ImportHistorical(10);
    var newHistory = await TripImportEndpoints.ImportAsync(
        new ImportTripsByDeviceRequest { TraccarDeviceId = historicalDevice, Trips = [Trip(10) with { StartedAt = historicalChange.AddMinutes(10), EndedAt = historicalChange.AddMinutes(40) }] }, data, logger, CancellationToken.None);
    Check(Status(oldHistory) == 200 && Body(oldHistory).Trips.Single().VehicleId == vehicleA
        && Status(newHistory) == 200 && Body(newHistory).Trips.Single().VehicleId == vehicleB,
        "historical imports use the binding that covers the trip timestamps");
    var crossing = await TripImportEndpoints.ImportAsync(
        new ImportTripsByDeviceRequest { TraccarDeviceId = historicalDevice, Trips = [Trip(0) with { StartedAt = historicalChange.AddMinutes(-10), EndedAt = historicalChange.AddMinutes(10) }] }, data, logger, CancellationToken.None);
    Check(Status(crossing) == 409, "a trip crossing a vehicle reassignment is rejected");
    Console.WriteLine($"Import integration: {count} checks passed using disposable schema {schema}.");
}
finally
{
    if (created)
    {
        // The target is generated above, never supplied by a caller or inferred from configuration.
        if (!System.Text.RegularExpressions.Regex.IsMatch(schema, "^trip_import_test_[0-9a-f]{32}$"))
            throw new Exception("Refusing unsafe cleanup target.");
        await using var cleanup = admin.CreateCommand($"drop schema {schema} cascade");
        await cleanup.ExecuteNonQueryAsync();
        Console.WriteLine("Disposable test schema removed. Existing app records were not modified.");
    }
}

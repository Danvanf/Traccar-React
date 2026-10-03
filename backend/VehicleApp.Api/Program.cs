using Npgsql;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);

var authUsername = builder.Configuration["VehicleApp:Auth:Username"]
    ?? Environment.GetEnvironmentVariable("VEHICLE_APP_AUTH_USERNAME");
var authPassword = builder.Configuration["VehicleApp:Auth:Password"]
    ?? Environment.GetEnvironmentVariable("VEHICLE_APP_AUTH_PASSWORD");
var authOptions = new VehicleAppAuthOptions(authUsername, authPassword);

builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = context =>
    {
        context.ProblemDetails.Extensions["requestId"] = context.HttpContext.TraceIdentifier;
        context.ProblemDetails.Extensions["timestampUtc"] = DateTimeOffset.UtcNow;
    };
});
builder.Services.AddOpenApi();
builder.Services.AddSingleton(authOptions);
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "vehicle_app_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();

var connectionString = builder.Configuration.GetConnectionString("VehicleApp");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("Connection string 'ConnectionStrings:VehicleApp' is required.");
}

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));
builder.Services.AddSingleton<BouncieRestService>();

var app = builder.Build();
var requestLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("RequestTiming");

await EnsureEnrichmentSchemaAsync(app.Services);
await EnsureInitialAdminAsync(app.Services, authOptions);
await app.Services.GetRequiredService<BouncieRestService>().InitializeAsync();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.Use((context, next) =>
{
    context.Response.Headers["X-Request-Id"] = context.TraceIdentifier;
    return next();
});

app.Use(async (context, next) =>
{
    var stopwatch = Stopwatch.StartNew();

    try
    {
        await next();
    }
    finally
    {
        stopwatch.Stop();
        var elapsedMs = stopwatch.Elapsed.TotalMilliseconds;
        var statusCode = context.Response.StatusCode;

        if (statusCode >= 500)
        {
            requestLogger.LogWarning(
                "HTTP {Method} {Path} -> {StatusCode} in {ElapsedMs:0.0} ms (requestId: {RequestId})",
                context.Request.Method,
                context.Request.Path,
                statusCode,
                elapsedMs,
                context.TraceIdentifier);
        }
        else
        {
            requestLogger.LogInformation(
                "HTTP {Method} {Path} -> {StatusCode} in {ElapsedMs:0.0} ms (requestId: {RequestId})",
                context.Request.Method,
                context.Request.Path,
                statusCode,
                elapsedMs,
                context.TraceIdentifier);
        }
    }
});

app.UseExceptionHandler();
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.Use(async (context, next) =>
{
    if (authOptions.Enabled
        && context.Request.Path.StartsWithSegments("/api")
        && !(context.User.Identity?.IsAuthenticated ?? false))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { title = "Authentication required", detail = "Sign in before using the VehicleApp API." });
        return;
    }

    await next();
});
app.Use(async (context, next) =>
{
    if (authOptions.Enabled
        && (HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method) || HttpMethods.IsPatch(context.Request.Method) || HttpMethods.IsDelete(context.Request.Method)))
    {
        var path = context.Request.Path;
        var configurationWrite = path.StartsWithSegments("/api/vehicles/upsert")
            || path.StartsWithSegments("/api/device-bindings")
            || path.StartsWithSegments("/api/named-places")
            || path.StartsWithSegments("/api/trip-tags/upsert")
            || path.StartsWithSegments("/api/trip-tags/")
            || path.StartsWithSegments("/api/event-thresholds")
            || (path.StartsWithSegments("/api/vehicles/") && (path.Value?.Contains("speed-bands", StringComparison.OrdinalIgnoreCase) ?? false))
            || path.StartsWithSegments("/api/integrations/bouncie")
            || path.StartsWithSegments("/api/trips/import")
            || path.StartsWithSegments("/api/dtc/catalog")
            || path.StartsWithSegments("/api/dtc/events");
        if (configurationWrite && !context.User.IsInRole("admin"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { title = "Administrator access required", detail = "This configuration operation is limited to administrators." });
            return;
        }
    }
    await next();
});
app.MapVehicleAppAuthEndpoints();
app.MapUserAccessEndpoints();
app.MapTripIdentityEndpoints();
app.MapTripDaySummaryEndpoints();
app.MapTripRecalculationEndpoints();
app.MapTripEventEndpoints();
app.MapTripRoutePointEndpoints();
app.MapTripEventThresholdEndpoints();
app.MapVehicleStatsEndpoints();
app.MapOperationsReportEndpoints();
app.MapStatusCardEndpoints();

app.MapGet("/health", async Task<IResult> (NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select 1", connection);
        await command.ExecuteScalarAsync(cancellationToken);

        return TypedResults.Ok(new HealthResponse("ok", DateTimeOffset.UtcNow));
    }
    catch (Exception ex)
    {
        return TypedResults.Problem(
            title: "Database connectivity failed",
            detail: ex.Message,
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("Health")
.WithSummary("Checks API and PostgreSQL connectivity.")
.WithDescription("Returns 200 when the API can open a connection to vehicle_app.");

app.MapGet("/api/vehicles", async Task<IResult> (NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
                        select
                            v.id,
                            v.display_name,
                            v.vin,
                            v.year,
                            v.make,
                            v.model,
                            v.notes,
                            v.profile_id,
                            b.traccar_device_id,
                            v.active,
                            v.created_at
                        from vehicles v
                        left join lateral (
                            select traccar_device_id
                            from vehicle_device_bindings b
                            where b.vehicle_id = v.id
                                and b.ends_at is null
                            order by b.is_primary desc, b.starts_at desc
                            limit 1
                        ) b on true
                        where not @authEnabled or @isAdmin or exists (
                            select 1
                            from app_users u
                            where u.username = @username and u.active
                              and (
                                exists (select 1 from app_user_vehicle_access ua where ua.user_id = u.id and ua.vehicle_id = v.id)
                                or exists (
                                    select 1
                                    from app_group_memberships gm
                                    join app_group_vehicle_access ga on ga.group_id = gm.group_id
                                    where gm.user_id = u.id and ga.vehicle_id = v.id
                                )
                              )
                        )
            order by created_at desc
            """, connection);
        command.Parameters.AddWithValue("authEnabled", authOptions.Enabled);
        command.Parameters.AddWithValue("isAdmin", context.User.IsInRole("admin"));
        command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<VehicleResponse>();

        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new VehicleResponse(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.IsDBNull(8) ? null : reader.GetInt32(8),
                reader.GetBoolean(9),
                reader.GetFieldValue<DateTimeOffset>(10)));
        }

        return TypedResults.Ok(results);
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "The vehicles table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (PostgresException ex)
    {
        return TypedResults.Problem(
            title: "Vehicle lookup database error",
            detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}",
            statusCode: StatusCodes.Status500InternalServerError);
    }
    catch (Exception ex)
    {
        return TypedResults.Problem(
            title: "Vehicle lookup failed",
            detail: ex.Message,
            statusCode: StatusCodes.Status500InternalServerError);
    }
})
.WithName("GetVehicles")
.WithSummary("Returns app vehicles.")
.WithDescription("Reads from vehicle_app.vehicles.");

app.MapPost("/api/vehicles/upsert", async Task<IResult> (
    UpsertVehicleRequest request,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.DisplayName))
        return Results.BadRequest("Vehicle display name is required.");

    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            insert into vehicles (id, display_name, vin, year, make, model, notes, profile_id, active, updated_at)
            values (coalesce(@id, gen_random_uuid()), @displayName, @vin, @year, @make, @model, @notes, @profileId, @active, now())
            on conflict (id) do update set
              display_name = excluded.display_name, vin = excluded.vin, year = excluded.year,
              make = excluded.make, model = excluded.model, notes = excluded.notes, profile_id = excluded.profile_id,
              active = excluded.active, updated_at = now()
            returning id
            """, connection);
        command.Parameters.AddWithValue("id", (object?)request.Id ?? DBNull.Value);
        command.Parameters.AddWithValue("displayName", request.DisplayName.Trim());
        command.Parameters.AddWithValue("vin", (object?)request.Vin ?? DBNull.Value);
        command.Parameters.AddWithValue("year", (object?)request.Year ?? DBNull.Value);
        command.Parameters.AddWithValue("make", (object?)request.Make ?? DBNull.Value);
        command.Parameters.AddWithValue("model", (object?)request.Model ?? DBNull.Value);
        command.Parameters.AddWithValue("notes", (object?)request.Notes ?? DBNull.Value);
        command.Parameters.AddWithValue("profileId", (object?)request.ProfileId ?? DBNull.Value);
        command.Parameters.AddWithValue("active", request.Active);
        var id = (Guid)(await command.ExecuteScalarAsync(cancellationToken))!;
        return Results.Ok(new { id });
    }
    catch (PostgresException ex)
    {
        return Results.Problem($"PostgreSQL {ex.SqlState}: {ex.MessageText}", statusCode: 500);
    }
})
.WithName("UpsertVehicle")
.WithDescription("Creates or updates an app-owned vehicle record.");

app.MapGet("/api/device-bindings", async Task<IResult> (NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select
              b.id,
              b.vehicle_id,
              v.display_name,
              b.traccar_device_id,
              b.starts_at,
              b.ends_at,
              b.is_primary
            from vehicle_device_bindings b
            join vehicles v on v.id = b.vehicle_id
            where b.ends_at is null
            order by v.display_name, b.traccar_device_id
            """, connection);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<DeviceBindingResponse>();

        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new DeviceBindingResponse(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetInt32(3),
                reader.GetFieldValue<DateTimeOffset>(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5),
                reader.GetBoolean(6)));
        }

        return TypedResults.Ok(results);
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "Required binding table(s) were not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (PostgresException ex)
    {
        return TypedResults.Problem(
            title: "Device binding lookup database error",
            detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}",
            statusCode: StatusCodes.Status500InternalServerError);
    }
    catch (Exception ex)
    {
        return TypedResults.Problem(
            title: "Device binding lookup failed",
            detail: ex.Message,
            statusCode: StatusCodes.Status500InternalServerError);
    }
})
.WithName("GetActiveDeviceBindings")
.WithSummary("Returns active device-to-vehicle bindings.")
.WithDescription("Reads active rows from vehicle_app.vehicle_device_bindings joined to vehicles.");

app.MapPost("/api/device-bindings/upsert", async Task<IResult> (
    UpsertDeviceBindingRequest request,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    if (request.TraccarDeviceId <= 0)
    {
        return TypedResults.BadRequest("traccarDeviceId must be a positive integer.");
    }

    if (!request.IsPrimary)
    {
        return TypedResults.BadRequest("Only primary bindings are supported. Set isPrimary=true.");
    }

    var effectiveFrom = request.EffectiveFrom ?? DateTimeOffset.UtcNow;
    if (effectiveFrom > DateTimeOffset.UtcNow.AddMinutes(5))
    {
        return TypedResults.BadRequest("effectiveFrom cannot be more than five minutes in the future.");
    }

    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        await using (var lockCommand = new NpgsqlCommand(
            "select pg_advisory_xact_lock(724104, @traccarDeviceId)", connection, tx))
        {
            lockCommand.Parameters.AddWithValue("traccarDeviceId", request.TraccarDeviceId);
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        var vehicleExists = false;
        await using (var vehicleCommand = new NpgsqlCommand(
                         """
                         select id
                         from vehicles
                         where id = @vehicleId
                         limit 1
                         """, connection, tx))
        {
            vehicleCommand.Parameters.AddWithValue("vehicleId", request.VehicleId);
            vehicleExists = await vehicleCommand.ExecuteScalarAsync(cancellationToken) is not null;
        }

        if (!vehicleExists)
        {
            return TypedResults.NotFound($"Vehicle {request.VehicleId} was not found.");
        }

        await using (var overlapCommand = new NpgsqlCommand(
                         """
                         select starts_at
                         from vehicle_device_bindings
                         where traccar_device_id = @traccarDeviceId
                           and (starts_at >= @effectiveFrom
                                or (starts_at < @effectiveFrom
                                    and coalesce(ends_at, 'infinity'::timestamptz) > @effectiveFrom))
                         limit 2
                         """, connection, tx))
        {
            overlapCommand.Parameters.AddWithValue("traccarDeviceId", request.TraccarDeviceId);
            overlapCommand.Parameters.AddWithValue("effectiveFrom", effectiveFrom.UtcDateTime);
            await using var overlapReader = await overlapCommand.ExecuteReaderAsync(cancellationToken);
            var overlapCount = 0;
            var hasFutureBinding = false;
            while (await overlapReader.ReadAsync(cancellationToken))
            {
                overlapCount++;
                hasFutureBinding |= overlapReader.GetFieldValue<DateTime>(0) >= effectiveFrom.UtcDateTime;
            }
            if (hasFutureBinding || overlapCount > 1)
            {
                return TypedResults.Conflict("Binding history is ambiguous at the requested effective date.");
            }
        }

        await using (var endExistingCommand = new NpgsqlCommand(
                         """
                         update vehicle_device_bindings
                         set ends_at = @effectiveFrom
                         where traccar_device_id = @traccarDeviceId
                           and ends_at is null
                           and starts_at < @effectiveFrom
                         """, connection, tx))
        {
            endExistingCommand.Parameters.AddWithValue("traccarDeviceId", request.TraccarDeviceId);
            endExistingCommand.Parameters.AddWithValue("effectiveFrom", effectiveFrom.UtcDateTime);
            await endExistingCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        Guid activeBindingId;
        await using (var insertBindingCommand = new NpgsqlCommand(
                """
                insert into vehicle_device_bindings (
                  vehicle_id,
                  traccar_device_id,
                  starts_at,
                  is_primary
                ) values (
                  @vehicleId,
                  @traccarDeviceId,
                  @effectiveFrom,
                  @isPrimary
                )
                returning id
                """, connection, tx))
        {
            insertBindingCommand.Parameters.AddWithValue("vehicleId", request.VehicleId);
            insertBindingCommand.Parameters.AddWithValue("traccarDeviceId", request.TraccarDeviceId);
            insertBindingCommand.Parameters.AddWithValue("effectiveFrom", effectiveFrom.UtcDateTime);
            insertBindingCommand.Parameters.AddWithValue("isPrimary", request.IsPrimary);

            var rawInsertedId = await insertBindingCommand.ExecuteScalarAsync(cancellationToken);
            activeBindingId = rawInsertedId is Guid id
                ? id
                : throw new InvalidOperationException("Failed to create device binding.");
        }

        await tx.CommitAsync(cancellationToken);
        return TypedResults.Ok(new UpsertDeviceBindingResponse(
            activeBindingId,
            request.VehicleId,
            request.TraccarDeviceId,
            request.IsPrimary));
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "Required binding table(s) were not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (PostgresException ex)
    {
        return TypedResults.Problem(
            title: "Device binding update failed",
            detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}",
            statusCode: StatusCodes.Status500InternalServerError);
    }
})
.WithName("UpsertDeviceBinding")
.WithSummary("Creates or updates an active device binding for an existing vehicle.")
.WithDescription("Ends conflicting active bindings for the same Traccar device and enforces exactly one active primary binding.");

app.MapDelete("/api/device-bindings/{bindingId:guid}", async Task<IResult> (
    Guid bindingId,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        await using var deactivateCommand = new NpgsqlCommand(
            """
            update vehicle_device_bindings
            set ends_at = coalesce(ends_at, now()),
                is_primary = false
            where id = @bindingId
              and ends_at is null
            """, connection);

        deactivateCommand.Parameters.AddWithValue("bindingId", bindingId);
        var deactivated = await deactivateCommand.ExecuteNonQueryAsync(cancellationToken);

        if (deactivated > 0)
        {
            return TypedResults.NoContent();
        }

        await using var existsCommand = new NpgsqlCommand(
            """
            select 1
            from vehicle_device_bindings
            where id = @bindingId
            limit 1
            """, connection);

        existsCommand.Parameters.AddWithValue("bindingId", bindingId);
        var exists = await existsCommand.ExecuteScalarAsync(cancellationToken) is not null;

        return exists ? TypedResults.NoContent() : TypedResults.NotFound();
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "Required binding table(s) were not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (PostgresException ex)
    {
        return TypedResults.Problem(
            title: "Device binding delete failed",
            detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}",
            statusCode: StatusCodes.Status500InternalServerError);
    }
})
.WithName("DeleteDeviceBinding")
.WithSummary("Deactivates an active device binding by id.")
.WithDescription("Sets ends_at for the binding row and clears primary flag.");

app.MapGet("/api/trips", async Task<IResult> (
    Guid vehicleId,
    DateTimeOffset? from,
    DateTimeOffset? to,
    int limit,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    var safeLimit = limit <= 0 ? 500 : Math.Min(limit, 5000);
    var fromUtc = from ?? DateTimeOffset.UtcNow.AddDays(-7);
    var toUtc = to ?? DateTimeOffset.UtcNow;

    if (fromUtc > toUtc)
    {
        return TypedResults.BadRequest("'from' must be earlier than or equal to 'to'.");
    }

    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
                        select id, vehicle_id, started_at, ended_at, duration_seconds, distance_meters, avg_speed_mph, max_speed_mph, notes, derivation_version
            from trips
            where vehicle_id = @vehicleId
              and started_at >= @fromUtc
              and started_at <= @toUtc
            order by started_at desc
            limit @limit
            """, connection);

        command.Parameters.AddWithValue("vehicleId", vehicleId);
        command.Parameters.AddWithValue("fromUtc", fromUtc.UtcDateTime);
        command.Parameters.AddWithValue("toUtc", toUtc.UtcDateTime);
        command.Parameters.AddWithValue("limit", safeLimit);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<TripResponse>();

        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new TripResponse(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetFieldValue<DateTimeOffset>(2),
                reader.GetFieldValue<DateTimeOffset>(3),
                reader.GetInt32(4),
                reader.GetDouble(5),
                reader.IsDBNull(6) ? null : reader.GetDouble(6),
                reader.IsDBNull(7) ? null : reader.GetDouble(7),
                reader.IsDBNull(8) ? null : reader.GetString(8),
                reader.IsDBNull(9) ? null : reader.GetString(9)));
        }

        return TypedResults.Ok(results);
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "The trips table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("GetTrips")
.WithSummary("Returns derived trips for a vehicle.")
.WithDescription("Reads from vehicle_app.trips filtered by vehicle and date range.");

app.MapGet("/api/trips/day-summaries", async Task<IResult> (
    Guid vehicleId,
    DateTimeOffset? from,
    DateTimeOffset? to,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    var fromUtc = from ?? DateTimeOffset.UtcNow.AddDays(-30);
    var toUtc = to ?? DateTimeOffset.UtcNow;

    if (fromUtc > toUtc)
    {
        return TypedResults.BadRequest("'from' must be earlier than or equal to 'to'.");
    }

    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select
              date_trunc('day', started_at) as day_utc,
              count(*) as trip_count,
              coalesce(sum(distance_meters), 0) as distance_meters
            from trips
            where vehicle_id = @vehicleId
              and started_at >= @fromUtc
              and started_at <= @toUtc
            group by 1
            order by 1 desc
            """, connection);

        command.Parameters.AddWithValue("vehicleId", vehicleId);
        command.Parameters.AddWithValue("fromUtc", fromUtc.UtcDateTime);
        command.Parameters.AddWithValue("toUtc", toUtc.UtcDateTime);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<TripDaySummaryResponse>();

        while (await reader.ReadAsync(cancellationToken))
        {
            var dayUtc = reader.GetDateTime(0);
            results.Add(new TripDaySummaryResponse(
                DateOnly.FromDateTime(dayUtc),
                reader.GetInt64(1),
                reader.GetDouble(2)));
        }

        return TypedResults.Ok(results);
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "The trips table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("GetTripDaySummaries")
.WithSummary("Returns day-level trip summaries for a vehicle.")
.WithDescription("Aggregates vehicle_app.trips by UTC day for dashboard and timeline summaries.");

app.MapTripImportEndpoints();
app.MapBouncieImportEndpoints();
app.MapBouncieRestEndpoints();
app.MapSpeedBandEndpoints();

app.MapGet("/api/named-places", async Task<IResult> (
    Guid? vehicleId,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select id, vehicle_id, name, latitude, longitude, radius_meters, notes, created_at
            from named_places
            where (@vehicleId::uuid is null or vehicle_id = @vehicleId::uuid)
            order by created_at desc
            """, connection);

        command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<NamedPlaceResponse>();

        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new NamedPlaceResponse(
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetGuid(1),
                reader.GetString(2),
                reader.GetDouble(3),
                reader.GetDouble(4),
                reader.GetInt32(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.GetFieldValue<DateTimeOffset>(7)));
        }

        return TypedResults.Ok(results);
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "named_places table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("GetNamedPlaces")
.WithSummary("Returns named places.")
.WithDescription("Reads named places from vehicle_app.named_places.");

app.MapPost("/api/named-places/upsert", async Task<IResult> (
    UpsertNamedPlaceRequest request,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return TypedResults.BadRequest("name is required.");
    }

    if (request.RadiusMeters <= 0)
    {
        return TypedResults.BadRequest("radiusMeters must be > 0.");
    }

    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            request.Id.HasValue
                ? """
                  update named_places
                  set vehicle_id = @vehicleId,
                      name = @name,
                      latitude = @latitude,
                      longitude = @longitude,
                      radius_meters = @radiusMeters,
                      notes = @notes
                  where id = @id
                  returning id, vehicle_id, name, latitude, longitude, radius_meters, notes, created_at
                  """
                : """
                  insert into named_places (vehicle_id, name, latitude, longitude, radius_meters, notes)
                  values (@vehicleId, @name, @latitude, @longitude, @radiusMeters, @notes)
                  returning id, vehicle_id, name, latitude, longitude, radius_meters, notes, created_at
                  """, connection);

        command.Parameters.AddWithValue("id", (object?)request.Id ?? DBNull.Value);
        command.Parameters.AddWithValue("vehicleId", (object?)request.VehicleId ?? DBNull.Value);
        command.Parameters.AddWithValue("name", request.Name.Trim());
        command.Parameters.AddWithValue("latitude", request.Latitude);
        command.Parameters.AddWithValue("longitude", request.Longitude);
        command.Parameters.AddWithValue("radiusMeters", request.RadiusMeters);
        command.Parameters.AddWithValue("notes", (object?)request.Notes ?? DBNull.Value);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return request.Id.HasValue
                ? TypedResults.NotFound($"Named place {request.Id} was not found.")
                : TypedResults.Problem("Failed to save named place.");
        }

        return TypedResults.Ok(new NamedPlaceResponse(
            reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetGuid(1),
            reader.GetString(2),
            reader.GetDouble(3),
            reader.GetDouble(4),
            reader.GetInt32(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.GetFieldValue<DateTimeOffset>(7)));
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "named_places table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("UpsertNamedPlace")
.WithSummary("Creates or updates a named place.")
.WithDescription("Upserts named places in vehicle_app.named_places.");

app.MapDelete("/api/named-places/{placeId:guid}", async Task<IResult> (
    Guid placeId,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            delete from named_places
            where id = @placeId
            """, connection);

        command.Parameters.AddWithValue("placeId", placeId);
        var affected = await command.ExecuteNonQueryAsync(cancellationToken);
        return affected == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "named_places table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("DeleteNamedPlace")
.WithSummary("Deletes a named place.")
.WithDescription("Deletes by id from vehicle_app.named_places.");

app.MapGet("/api/trip-tags", async Task<IResult> (
    Guid? vehicleId,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select id, vehicle_id, name, color
            from trip_tags
            where (@vehicleId::uuid is null or vehicle_id is null or vehicle_id = @vehicleId::uuid)
            order by name asc
            """, connection);

        command.Parameters.AddWithValue("vehicleId", (object?)vehicleId ?? DBNull.Value);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<TripTagResponse>();

        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new TripTagResponse(
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetGuid(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3)));
        }

        return TypedResults.Ok(results);
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "trip_tags table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("GetTripTags")
.WithSummary("Returns trip tags.")
.WithDescription("Reads tags from vehicle_app.trip_tags.");

app.MapPost("/api/trip-tags/upsert", async Task<IResult> (
    UpsertTripTagRequest request,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return TypedResults.BadRequest("name is required.");
    }

    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            request.Id.HasValue
                ? """
                  update trip_tags
                  set vehicle_id = @vehicleId,
                      name = @name,
                      color = @color
                  where id = @id
                  returning id, vehicle_id, name, color
                  """
                : """
                  insert into trip_tags (vehicle_id, name, color)
                  values (@vehicleId, @name, @color)
                  on conflict (vehicle_id, name)
                  do update set color = coalesce(excluded.color, trip_tags.color)
                  returning id, vehicle_id, name, color
                  """, connection);

        command.Parameters.AddWithValue("id", (object?)request.Id ?? DBNull.Value);
        command.Parameters.AddWithValue("vehicleId", (object?)request.VehicleId ?? DBNull.Value);
        command.Parameters.AddWithValue("name", request.Name.Trim());
        command.Parameters.AddWithValue("color", (object?)request.Color ?? DBNull.Value);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return request.Id.HasValue
                ? TypedResults.NotFound($"Trip tag {request.Id} was not found.")
                : TypedResults.Problem("Failed to save trip tag.");
        }

        return TypedResults.Ok(new TripTagResponse(
            reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetGuid(1),
            reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3)));
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "trip_tags table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("UpsertTripTag")
.WithSummary("Creates or updates a trip tag.")
.WithDescription("Upserts trip tags in vehicle_app.trip_tags.");

app.MapDelete("/api/trip-tags/{tagId:guid}", async Task<IResult> (
    Guid tagId,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("delete from trip_tags where id = @tagId", connection);
        command.Parameters.AddWithValue("tagId", tagId);
        var deleted = await command.ExecuteNonQueryAsync(cancellationToken);
        return deleted == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(title: "vehicle_app schema is missing", detail: "trip_tags table was not found.", statusCode: 503);
    }
})
.WithName("DeleteTripTag")
.WithDescription("Deletes a trip tag and its trip assignments.");

app.MapGet("/api/trips/{tripId:guid}/tags", async Task<IResult> (
    Guid tripId,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select t.id, t.vehicle_id, t.name, t.color
            from trip_tag_map m
            join trip_tags t on t.id = m.tag_id
            where m.trip_id = @tripId
            order by t.name asc
            """, connection);

        command.Parameters.AddWithValue("tripId", tripId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<TripTagResponse>();

        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new TripTagResponse(
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetGuid(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3)));
        }

        return TypedResults.Ok(results);
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "trip_tag_map/trip_tags table(s) were not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("GetTripTagsForTrip")
.WithSummary("Returns tags applied to a trip.")
.WithDescription("Reads mapped tags from vehicle_app.trip_tag_map.");

app.MapPost("/api/trips/{tripId:guid}/tags/{tagId:guid}", async Task<IResult> (
    Guid tripId,
    Guid tagId,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            insert into trip_tag_map (trip_id, tag_id)
            values (@tripId, @tagId)
            on conflict (trip_id, tag_id) do nothing
            """, connection);

        command.Parameters.AddWithValue("tripId", tripId);
        command.Parameters.AddWithValue("tagId", tagId);
        await command.ExecuteNonQueryAsync(cancellationToken);
        return TypedResults.NoContent();
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "trip_tag_map table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (PostgresException ex) when (ex.SqlState == "23503")
    {
        return TypedResults.BadRequest("tripId or tagId does not exist.");
    }
})
.WithName("AddTagToTrip")
.WithSummary("Adds a tag to a trip.")
.WithDescription("Inserts mapping row into vehicle_app.trip_tag_map.");

app.MapDelete("/api/trips/{tripId:guid}/tags/{tagId:guid}", async Task<IResult> (
    Guid tripId,
    Guid tagId,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            delete from trip_tag_map
            where trip_id = @tripId
              and tag_id = @tagId
            """, connection);

        command.Parameters.AddWithValue("tripId", tripId);
        command.Parameters.AddWithValue("tagId", tagId);
        var affected = await command.ExecuteNonQueryAsync(cancellationToken);
        return affected == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "trip_tag_map table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("RemoveTagFromTrip")
.WithSummary("Removes a tag from a trip.")
.WithDescription("Deletes mapping row from vehicle_app.trip_tag_map.");

app.MapPost("/api/trips/{tripId:guid}/notes", async Task<IResult> (
    Guid tripId,
    TripNoteUpdateRequest request,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            update trips
            set notes = @notes
            where id = @tripId
            returning id, notes
            """, connection);

        command.Parameters.AddWithValue("tripId", tripId);
        command.Parameters.AddWithValue("notes", (object?)request.Notes ?? DBNull.Value);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return TypedResults.NotFound();
        }

        return TypedResults.Ok(new TripNoteResponse(
            reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetString(1)));
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "trips table was not found. Apply Phase 3 DDL before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("UpdateTripNotes")
.WithSummary("Updates notes for a trip.")
.WithDescription("Writes notes to vehicle_app.trips.notes.");

app.MapGet("/api/dtc/catalog", async Task<IResult> (NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select code, description, severity, category, source, updated_at
            from dtc_catalog
            order by code
            """, connection);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<DtcCatalogItemResponse>();

        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new DtcCatalogItemResponse(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetFieldValue<DateTimeOffset>(5)));
        }

        return TypedResults.Ok(results);
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "DTC table(s) were not found. Apply phase5_dtc_enrichment_schema.sql before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("GetDtcCatalog")
.WithSummary("Returns known DTC catalog entries.")
.WithDescription("Reads DTC code metadata from vehicle_app.dtc_catalog.");

app.MapPost("/api/dtc/catalog/upsert", async Task<IResult> (
    UpsertDtcCatalogItemRequest request,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    var code = request.Code?.Trim().ToUpperInvariant();
    if (string.IsNullOrWhiteSpace(code))
    {
        return TypedResults.BadRequest("code is required.");
    }

    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            insert into dtc_catalog (code, description, severity, category, source, updated_at)
            values (@code, @description, @severity, @category, @source, now())
            on conflict (code)
            do update set
              description = coalesce(excluded.description, dtc_catalog.description),
              severity = coalesce(excluded.severity, dtc_catalog.severity),
              category = coalesce(excluded.category, dtc_catalog.category),
              source = coalesce(excluded.source, dtc_catalog.source),
              updated_at = now()
            returning code, description, severity, category, source, updated_at
            """, connection);

        command.Parameters.AddWithValue("code", code);
        command.Parameters.AddWithValue("description", (object?)request.Description ?? DBNull.Value);
        command.Parameters.AddWithValue("severity", (object?)request.Severity ?? DBNull.Value);
        command.Parameters.AddWithValue("category", (object?)request.Category ?? DBNull.Value);
        command.Parameters.AddWithValue("source", (object?)request.Source ?? DBNull.Value);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new InvalidOperationException("Failed to upsert DTC catalog item.");
        }

        return TypedResults.Ok(new DtcCatalogItemResponse(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.GetFieldValue<DateTimeOffset>(5)));
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "DTC table(s) were not found. Apply phase5_dtc_enrichment_schema.sql before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("UpsertDtcCatalogItem")
.WithSummary("Creates or updates DTC metadata.")
.WithDescription("Upserts DTC metadata into vehicle_app.dtc_catalog.");

app.MapGet("/api/dtc/events", async Task<IResult> (
    Guid vehicleId,
    DateTimeOffset? from,
    DateTimeOffset? to,
    int? limit,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    var safeLimit = !limit.HasValue || limit.Value <= 0 ? 500 : Math.Min(limit.Value, 5000);
    var fromUtc = from ?? DateTimeOffset.UtcNow.AddDays(-30);
    var toUtc = to ?? DateTimeOffset.UtcNow;

    if (fromUtc > toUtc)
    {
        return TypedResults.BadRequest("'from' must be earlier than or equal to 'to'.");
    }

    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            select
              e.id,
              e.vehicle_id,
              e.trip_id,
              e.traccar_device_id,
              e.code,
              c.description,
              c.severity,
              e.status,
              e.detected_at,
              e.source_position_id,
              e.source_event_id,
              e.notes,
              e.created_at
            from dtc_events e
            left join dtc_catalog c on c.code = e.code
            where e.vehicle_id = @vehicleId
              and e.detected_at >= @fromUtc
              and e.detected_at <= @toUtc
            order by e.detected_at desc
            limit @limit
            """, connection);

        command.Parameters.AddWithValue("vehicleId", vehicleId);
        command.Parameters.AddWithValue("fromUtc", fromUtc.UtcDateTime);
        command.Parameters.AddWithValue("toUtc", toUtc.UtcDateTime);
        command.Parameters.AddWithValue("limit", safeLimit);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<DtcEventResponse>();

        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new DtcEventResponse(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.IsDBNull(2) ? null : reader.GetGuid(2),
                reader.GetInt32(3),
                reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.GetFieldValue<DateTimeOffset>(8),
                reader.IsDBNull(9) ? null : reader.GetInt64(9),
                reader.IsDBNull(10) ? null : reader.GetInt64(10),
                reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.GetFieldValue<DateTimeOffset>(12)));
        }

        return TypedResults.Ok(results);
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return TypedResults.Problem(
            title: "vehicle_app schema is missing",
            detail: "DTC table(s) were not found. Apply phase5_dtc_enrichment_schema.sql before using this endpoint.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.WithName("GetDtcEvents")
.WithSummary("Returns DTC events for a vehicle in a time range.")
.WithDescription("Reads DTC events enriched with catalog metadata from vehicle_app.");

app.MapPost("/api/dtc/events/import-by-device", async Task<IResult> (
    ImportDtcEventsByDeviceRequest request,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    return await ImportDtcEventsByDeviceCoreAsync(request, dataSource, cancellationToken);
})
.WithName("ImportDtcEventsByDevice")
.WithSummary("Persists DTC events for a Traccar device into vehicle_app.")
.WithDescription("Accepts decoded DTC events and inserts missing rows into vehicle_app.dtc_events using active device binding.");

app.MapPost("/api/dtc/events/import-from-traccar", async Task<IResult> (
    ImportDtcEventsFromTraccarRequest request,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    if (request.TraccarDeviceId <= 0)
    {
        return TypedResults.BadRequest("traccarDeviceId must be a positive integer.");
    }

    if (request.TraccarDeviceId > int.MaxValue)
    {
        return TypedResults.BadRequest($"traccarDeviceId must be <= {int.MaxValue}.");
    }

    if (request.Records.Count == 0)
    {
        return TypedResults.BadRequest("records must contain at least one item.");
    }

    var decodedItems = new List<ImportDtcEventItemRequest>();
    var io30FallbackAllowedStatuses = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var status in request.Io30FallbackAllowedStatuses)
    {
        var normalizedStatus = NormalizeStatusToken(status);
        if (!string.IsNullOrWhiteSpace(normalizedStatus))
        {
            io30FallbackAllowedStatuses.Add(normalizedStatus);
        }
    }
    int? previousIo30Count = null;

    foreach (var record in request.Records)
    {
        var decodedFromRecord = DecodeDtcEventItems(record);
        decodedItems.AddRange(decodedFromRecord);

        if (!request.IncludeIo30Fallback)
        {
            continue;
        }

        var io30Count = TryGetIo30Count(record);
        if (!io30Count.HasValue)
        {
            continue;
        }

        var currentCount = io30Count.Value;
        var shouldEmitIo30Fallback = currentCount > 0 && (!previousIo30Count.HasValue || previousIo30Count.Value != currentCount);
        if (!shouldEmitIo30Fallback && request.IncludeIo30ZeroBaseline && !previousIo30Count.HasValue)
        {
            shouldEmitIo30Fallback = true;
        }
        previousIo30Count = currentCount;

        if (shouldEmitIo30Fallback && io30FallbackAllowedStatuses.Count > 0 &&
            !IsIo30FallbackStatusAllowed(record.Status, io30FallbackAllowedStatuses))
        {
            shouldEmitIo30Fallback = false;
        }

        if (!shouldEmitIo30Fallback)
        {
            continue;
        }

        var detectedAt = record.DetectedAt ?? DateTimeOffset.UtcNow;
        var rawPayload = record.RawPayload ?? record.Attributes;
        var sourceStatus = string.IsNullOrWhiteSpace(record.Status) ? "active" : record.Status;

        decodedItems.Add(new ImportDtcEventItemRequest
        {
            Code = "IO30_COUNT",
            DetectedAt = detectedAt,
            TripId = record.TripId,
            Description = "DTC count signal (io30) without explicit code text",
            Severity = "info",
            Category = "diagnostic",
            Source = "traccar",
            Status = sourceStatus,
            SourcePositionId = record.SourcePositionId,
            SourceEventId = record.SourceEventId,
            RawPayload = rawPayload,
            Notes = request.IncludeIo30ZeroBaseline && currentCount <= 0
                ? $"io30 baseline fallback detected count={currentCount}; explicit DTC code text not present"
                : $"io30 fallback detected count={currentCount}; explicit DTC code text not present"
        });
    }

    if (decodedItems.Count == 0)
    {
        return TypedResults.BadRequest("No decodable DTC codes were found in records. Provide payload attributes containing OBD/DTC codes.");
    }

    var normalized = new ImportDtcEventsByDeviceRequest
    {
        TraccarDeviceId = request.TraccarDeviceId,
        Events = decodedItems
    };

    return await ImportDtcEventsByDeviceCoreAsync(normalized, dataSource, cancellationToken);
})
.WithName("ImportDtcEventsFromTraccar")
.WithSummary("Decodes raw Traccar payload records and imports extracted DTC events.")
.WithDescription("Extracts DTC codes from common Traccar attribute patterns (dtc/dtcCodes/faultCodes) and persists decoded events into vehicle_app.dtc_events.");

IResult BuildSchemaMissingDtcProblem() => TypedResults.Problem(
    title: "vehicle_app schema is missing",
    detail: "DTC table(s) were not found. Apply phase5_dtc_enrichment_schema.sql before using this endpoint.",
    statusCode: StatusCodes.Status503ServiceUnavailable);

async Task<IResult> ImportDtcEventsByDeviceCoreAsync(
    ImportDtcEventsByDeviceRequest request,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken)
{
    if (request.TraccarDeviceId <= 0)
    {
        return TypedResults.BadRequest("traccarDeviceId must be a positive integer.");
    }

    if (request.TraccarDeviceId > int.MaxValue)
    {
        return TypedResults.BadRequest($"traccarDeviceId must be <= {int.MaxValue}.");
    }

    if (request.Events.Count == 0)
    {
        return TypedResults.BadRequest("events must contain at least one item.");
    }

    var traccarDeviceId = (int)request.TraccarDeviceId;

    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        Guid? vehicleId;
        await using (var bindCommand = new NpgsqlCommand(
                         """
                         select vehicle_id
                         from vehicle_device_bindings
                         where traccar_device_id = @traccarDeviceId
                           and ends_at is null
                         order by is_primary desc, starts_at desc
                         limit 1
                         """, connection, tx))
        {
            bindCommand.Parameters.AddWithValue("traccarDeviceId", traccarDeviceId);
            var rawVehicleId = await bindCommand.ExecuteScalarAsync(cancellationToken);
            vehicleId = rawVehicleId is Guid id ? id : null;
        }

        if (!vehicleId.HasValue)
        {
            return TypedResults.NotFound($"No active vehicle binding found for traccarDeviceId {traccarDeviceId}.");
        }

        var imported = 0;
        var skipped = 0;

        foreach (var item in request.Events)
        {
            var code = item.Code?.Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(code))
            {
                continue;
            }

            await using (var upsertCatalogCommand = new NpgsqlCommand(
                             """
                             insert into dtc_catalog (code, description, severity, category, source, updated_at)
                             values (@code, @description, @severity, @category, @source, now())
                             on conflict (code)
                             do update set
                               description = coalesce(excluded.description, dtc_catalog.description),
                               severity = coalesce(excluded.severity, dtc_catalog.severity),
                               category = coalesce(excluded.category, dtc_catalog.category),
                               source = coalesce(excluded.source, dtc_catalog.source),
                               updated_at = now()
                             """, connection, tx))
            {
                upsertCatalogCommand.Parameters.AddWithValue("code", code);
                upsertCatalogCommand.Parameters.AddWithValue("description", (object?)item.Description ?? DBNull.Value);
                upsertCatalogCommand.Parameters.AddWithValue("severity", (object?)item.Severity ?? DBNull.Value);
                upsertCatalogCommand.Parameters.AddWithValue("category", (object?)item.Category ?? DBNull.Value);
                upsertCatalogCommand.Parameters.AddWithValue("source", (object?)item.Source ?? DBNull.Value);
                await upsertCatalogCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            bool exists;
            await using (var existsCommand = new NpgsqlCommand(
                             """
                             select 1
                             from dtc_events
                             where vehicle_id = @vehicleId
                               and traccar_device_id = @traccarDeviceId
                               and code = @code
                               and detected_at = @detectedAt
                               and coalesce(source_position_id, -1) = coalesce(@sourcePositionId, -1)
                                                             and coalesce(source_event_id, -1) = coalesce(@sourceEventId, -1)
                             limit 1
                             """, connection, tx))
            {
                existsCommand.Parameters.AddWithValue("vehicleId", vehicleId.Value);
                existsCommand.Parameters.AddWithValue("traccarDeviceId", traccarDeviceId);
                existsCommand.Parameters.AddWithValue("code", code);
                existsCommand.Parameters.AddWithValue("detectedAt", item.DetectedAt.UtcDateTime);
                existsCommand.Parameters.AddWithValue("sourcePositionId", (object?)item.SourcePositionId ?? DBNull.Value);
                                existsCommand.Parameters.AddWithValue("sourceEventId", (object?)item.SourceEventId ?? DBNull.Value);
                exists = await existsCommand.ExecuteScalarAsync(cancellationToken) is not null;
            }

            if (exists)
            {
                skipped += 1;
                continue;
            }

            var rawPayload = item.RawPayload.HasValue
                ? item.RawPayload.Value.GetRawText()
                : "{}";

            await using var insertCommand = new NpgsqlCommand(
                """
                insert into dtc_events (
                  vehicle_id,
                  trip_id,
                  traccar_device_id,
                  code,
                  status,
                  detected_at,
                  source_position_id,
                  source_event_id,
                  raw_payload,
                  notes
                ) values (
                  @vehicleId,
                  @tripId,
                  @traccarDeviceId,
                  @code,
                  @status,
                  @detectedAt,
                  @sourcePositionId,
                  @sourceEventId,
                  cast(@rawPayload as jsonb),
                  @notes
                )
                """, connection, tx);

            insertCommand.Parameters.AddWithValue("vehicleId", vehicleId.Value);
            insertCommand.Parameters.AddWithValue("tripId", (object?)item.TripId ?? DBNull.Value);
            insertCommand.Parameters.AddWithValue("traccarDeviceId", traccarDeviceId);
            insertCommand.Parameters.AddWithValue("code", code);
            insertCommand.Parameters.AddWithValue("status", (object?)item.Status ?? DBNull.Value);
            insertCommand.Parameters.AddWithValue("detectedAt", item.DetectedAt.UtcDateTime);
            insertCommand.Parameters.AddWithValue("sourcePositionId", (object?)item.SourcePositionId ?? DBNull.Value);
            insertCommand.Parameters.AddWithValue("sourceEventId", (object?)item.SourceEventId ?? DBNull.Value);
            insertCommand.Parameters.AddWithValue("rawPayload", rawPayload);
            insertCommand.Parameters.AddWithValue("notes", (object?)item.Notes ?? DBNull.Value);

            await insertCommand.ExecuteNonQueryAsync(cancellationToken);
            imported += 1;
        }

        await tx.CommitAsync(cancellationToken);
        return TypedResults.Ok(new ImportDtcEventsByDeviceResponse(vehicleId.Value, traccarDeviceId, imported, skipped));
    }
    catch (PostgresException ex) when (ex.SqlState == "42P01")
    {
        return BuildSchemaMissingDtcProblem();
    }
    catch (PostgresException ex)
    {
        return TypedResults.Problem(
            title: "DTC import database error",
            detail: $"PostgreSQL {ex.SqlState}: {ex.MessageText}",
            statusCode: StatusCodes.Status500InternalServerError);
    }
    catch (Exception ex)
    {
        return TypedResults.Problem(
            title: "DTC import failed",
            detail: ex.Message,
            statusCode: StatusCodes.Status500InternalServerError);
    }
}

const string DtcCodeExtractPattern = "\\b[A-Za-z][0-9A-Fa-f]{4}\\b";
const string DtcCodeExactPattern = "^[A-Za-z][0-9A-Fa-f]{4}$";

IReadOnlyList<ImportDtcEventItemRequest> DecodeDtcEventItems(ImportDtcSourceRecordRequest record)
{
    var detectedAt = record.DetectedAt ?? DateTimeOffset.UtcNow;
    var status = record.Status;

    var rawPayload = record.RawPayload ?? record.Attributes;
    var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    if (!string.IsNullOrWhiteSpace(record.Code))
    {
        candidates.Add(record.Code);
    }

    AddCodesFromJson(record.Attributes, candidates);
    AddCodesFromJson(record.RawPayload, candidates);

    if (candidates.Count == 0)
    {
        return [];
    }

    var decoded = new List<ImportDtcEventItemRequest>(candidates.Count);
    foreach (var rawCode in candidates)
    {
        var normalizedCode = NormalizeDtcCode(rawCode);
        if (string.IsNullOrWhiteSpace(normalizedCode))
        {
            continue;
        }

        decoded.Add(new ImportDtcEventItemRequest
        {
            Code = normalizedCode,
            DetectedAt = detectedAt,
            TripId = record.TripId,
            Source = "traccar",
            Status = status,
            SourcePositionId = record.SourcePositionId,
            SourceEventId = record.SourceEventId,
            RawPayload = rawPayload,
            Notes = record.Notes
        });
    }

    return decoded;
}

void AddCodesFromJson(JsonElement? payload, HashSet<string> output)
{
    if (!payload.HasValue || payload.Value.ValueKind == JsonValueKind.Undefined || payload.Value.ValueKind == JsonValueKind.Null)
    {
        return;
    }

    var element = payload.GetValueOrDefault();

    foreach (var key in new[]
             {
                 "dtc",
                 "dtcs",
                 "dtcCode",
                 "dtcCodes",
                 "obdDtc",
                 "obdDtcs",
                 "obdCodes",
                 "faultCode",
                 "faultCodes",
                 "diagnosticTroubleCode",
                 "diagnosticTroubleCodes",
                 "codes"
             })
    {
        if (TryGetPropertyIgnoreCase(element, key, out var value))
        {
            AddCodesFromValue(value, output);
        }
    }

    if (TryGetPropertyIgnoreCase(element, "attributes", out var attributes) && attributes.ValueKind == JsonValueKind.Object)
    {
        AddCodesFromJson(attributes, output);
    }
}

void AddCodesFromValue(JsonElement value, HashSet<string> output)
{
    switch (value.ValueKind)
    {
        case JsonValueKind.Array:
            foreach (var item in value.EnumerateArray())
            {
                AddCodesFromValue(item, output);
            }
            break;
        case JsonValueKind.Object:
            if (TryGetPropertyIgnoreCase(value, "code", out var codeProperty))
            {
                AddCodesFromValue(codeProperty, output);
            }

            if (TryGetPropertyIgnoreCase(value, "codes", out var codesProperty))
            {
                AddCodesFromValue(codesProperty, output);
            }

            foreach (var property in value.EnumerateObject())
            {
                var maybeCode = NormalizeDtcCode(property.Name);
                if (!string.IsNullOrWhiteSpace(maybeCode) && property.Value.ValueKind == JsonValueKind.True)
                {
                    output.Add(maybeCode);
                }
            }
            break;
        case JsonValueKind.String:
            AddCodesFromText(value.GetString(), output);
            break;
        case JsonValueKind.Number:
            AddCodesFromText(value.GetRawText(), output);
            break;
    }
}

void AddCodesFromText(string? text, HashSet<string> output)
{
    if (string.IsNullOrWhiteSpace(text))
    {
        return;
    }

    foreach (Match match in Regex.Matches(text, DtcCodeExtractPattern, RegexOptions.IgnoreCase))
    {
        var normalized = NormalizeDtcCode(match.Value);
        if (!string.IsNullOrWhiteSpace(normalized))
        {
            output.Add(normalized);
        }
    }
}

bool TryGetPropertyIgnoreCase(JsonElement element, string propertyName, out JsonElement value)
{
    if (element.ValueKind != JsonValueKind.Object)
    {
        value = default;
        return false;
    }

    foreach (var property in element.EnumerateObject())
    {
        if (string.Equals(property.Name, propertyName, StringComparison.OrdinalIgnoreCase))
        {
            value = property.Value;
            return true;
        }
    }

    value = default;
    return false;
}

string? NormalizeDtcCode(string? rawCode)
{
    if (string.IsNullOrWhiteSpace(rawCode))
    {
        return null;
    }

    var trimmed = rawCode.Trim().ToUpperInvariant();
    return Regex.IsMatch(trimmed, DtcCodeExactPattern, RegexOptions.IgnoreCase) ? trimmed : null;
}

int? TryGetIo30Count(ImportDtcSourceRecordRequest record)
{
    var fromAttributes = TryGetIo30FromJson(record.Attributes);
    if (fromAttributes.HasValue)
    {
        return fromAttributes;
    }

    return TryGetIo30FromJson(record.RawPayload);
}

int? TryGetIo30FromJson(JsonElement? payload)
{
    if (!payload.HasValue || payload.Value.ValueKind == JsonValueKind.Undefined || payload.Value.ValueKind == JsonValueKind.Null)
    {
        return null;
    }

    var element = payload.GetValueOrDefault();
    if (TryGetPropertyIgnoreCase(element, "io30", out var directIo30))
    {
        var parsed = ParseIntValue(directIo30);
        if (parsed.HasValue)
        {
            return parsed;
        }
    }

    if (TryGetPropertyIgnoreCase(element, "attributes", out var nestedAttributes) && nestedAttributes.ValueKind == JsonValueKind.Object)
    {
        if (TryGetPropertyIgnoreCase(nestedAttributes, "io30", out var nestedIo30))
        {
            return ParseIntValue(nestedIo30);
        }
    }

    return null;
}

int? ParseIntValue(JsonElement value)
{
    switch (value.ValueKind)
    {
        case JsonValueKind.Number:
            if (value.TryGetInt32(out var intValue))
            {
                return intValue;
            }
            if (value.TryGetDouble(out var doubleValue))
            {
                return (int)Math.Round(doubleValue);
            }
            return null;
        case JsonValueKind.String:
            return int.TryParse(value.GetString(), out var parsed) ? parsed : null;
        default:
            return null;
    }
}

bool IsIo30FallbackStatusAllowed(string? status, HashSet<string> allowedStatuses)
{
    if (allowedStatuses.Count == 0)
    {
        return true;
    }

    if (string.IsNullOrWhiteSpace(status))
    {
        return allowedStatuses.Contains("(empty)") || allowedStatuses.Contains("empty");
    }

    return allowedStatuses.Contains(status.Trim());
}

string? NormalizeStatusToken(string? rawToken)
{
    if (string.IsNullOrWhiteSpace(rawToken))
    {
        return null;
    }

    var trimmed = rawToken.Trim().Trim('"', '\'');
    return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
}

app.Run();

static async Task EnsureEnrichmentSchemaAsync(IServiceProvider services)
{
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("SchemaBootstrap");
        var dataSource = services.GetRequiredService<NpgsqlDataSource>();

        try
        {
                await using var connection = await dataSource.OpenConnectionAsync();
                await using var command = new NpgsqlCommand(
                        """
                        create table if not exists named_places (
                            id uuid primary key default gen_random_uuid(),
                            vehicle_id uuid references vehicles(id) on delete cascade,
                            name text not null,
                            latitude double precision not null,
                            longitude double precision not null,
                            radius_meters integer not null default 75,
                            notes text,
                            created_at timestamptz not null default now()
                        );

                        create index if not exists ix_named_places_vehicle
                        on named_places (vehicle_id, name);

                        create table if not exists app_users (
                            id uuid primary key default gen_random_uuid(),
                            username text not null unique,
                            password_hash text,
                            first_name text,
                            last_name text,
                            email text,
                            role text not null default 'regular' check (role in ('admin', 'regular')),
                            active boolean not null default true,
                            auto_access_new_devices boolean not null default false,
                            created_at timestamptz not null default now(),
                            updated_at timestamptz not null default now()
                        );

                        create table if not exists app_groups (
                            id uuid primary key default gen_random_uuid(),
                            name text not null unique,
                            auto_access_new_devices boolean not null default false,
                            created_at timestamptz not null default now(),
                            updated_at timestamptz not null default now()
                        );

                        create table if not exists app_group_memberships (
                            user_id uuid not null references app_users(id) on delete cascade,
                            group_id uuid not null references app_groups(id) on delete cascade,
                            created_at timestamptz not null default now(),
                            primary key (user_id, group_id)
                        );

                        create table if not exists app_user_vehicle_access (
                            user_id uuid not null references app_users(id) on delete cascade,
                            vehicle_id uuid not null references vehicles(id) on delete cascade,
                            created_at timestamptz not null default now(),
                            primary key (user_id, vehicle_id)
                        );

                        create table if not exists app_group_vehicle_access (
                            group_id uuid not null references app_groups(id) on delete cascade,
                            vehicle_id uuid not null references vehicles(id) on delete cascade,
                            created_at timestamptz not null default now(),
                            primary key (group_id, vehicle_id)
                        );

                        create table if not exists app_user_device_access (
                            user_id uuid not null references app_users(id) on delete cascade,
                            traccar_device_id integer not null,
                            created_at timestamptz not null default now(),
                            primary key (user_id, traccar_device_id)
                        );

                        create table if not exists app_group_device_access (
                            group_id uuid not null references app_groups(id) on delete cascade,
                            traccar_device_id integer not null,
                            created_at timestamptz not null default now(),
                            primary key (group_id, traccar_device_id)
                        );

                        create index if not exists ix_app_group_memberships_group
                        on app_group_memberships (group_id, user_id);

                        create index if not exists ix_app_user_vehicle_access_vehicle
                        on app_user_vehicle_access (vehicle_id, user_id);

                        create index if not exists ix_app_group_vehicle_access_vehicle
                        on app_group_vehicle_access (vehicle_id, group_id);

                        create index if not exists ix_app_user_device_access_device
                        on app_user_device_access (traccar_device_id, user_id);

                        create index if not exists ix_app_group_device_access_device
                        on app_group_device_access (traccar_device_id, group_id);

                        create table if not exists trip_tags (
                            id uuid primary key default gen_random_uuid(),
                            vehicle_id uuid references vehicles(id) on delete cascade,
                            name text not null,
                            color text,
                            created_at timestamptz not null default now(),
                            unique (vehicle_id, name)
                        );

                        create table if not exists trip_tag_map (
                            trip_id uuid not null references trips(id) on delete cascade,
                            tag_id uuid not null references trip_tags(id) on delete cascade,
                            created_at timestamptz not null default now(),
                            primary key (trip_id, tag_id)
                        );

                        create index if not exists ix_trip_tag_map_tag
                        on trip_tag_map (tag_id, trip_id);

                        alter table if exists trips
                        add column if not exists derivation_version text;

                        alter table if exists vehicles
                        add column if not exists profile_id text;

                        create table if not exists bouncie_credentials (
                            id smallint primary key check (id = 1),
                            client_id text not null,
                            client_secret_ciphertext text not null,
                            refresh_token_ciphertext text not null,
                            redirect_uri text not null,
                            user_label text,
                            updated_at timestamptz not null default now()
                        );

                        create table if not exists bouncie_import_checkpoints (
                            vehicle_imei text not null,
                            window_from timestamptz not null,
                            window_through timestamptz not null,
                            completed_at timestamptz not null default now(),
                            imported_count integer not null default 0,
                            skipped_count integer not null default 0,
                            imported_events integer not null default 0,
                            primary key (vehicle_imei, window_from, window_through)
                        );

                        create index if not exists ix_bouncie_import_checkpoints_completed
                        on bouncie_import_checkpoints (completed_at desc);

                        create table if not exists trip_route_points (
                            trip_id uuid not null references trips(id) on delete cascade,
                            point_index integer not null,
                            occurred_at timestamptz,
                            latitude double precision not null,
                            longitude double precision not null,
                            speed_mph double precision,
                            raw_evidence jsonb not null default '{}'::jsonb,
                            primary key (trip_id, point_index)
                        );

                        create index if not exists ix_trip_route_points_trip
                        on trip_route_points (trip_id, point_index);

                        create table if not exists vehicle_speed_bands (
                            vehicle_id uuid primary key references vehicles(id) on delete cascade,
                            bands jsonb not null,
                            inherited_from_vehicle_id uuid references vehicles(id) on delete set null,
                            updated_at timestamptz not null default now()
                        );

                        create table if not exists vehicle_status_card_preferences (
                            vehicle_id uuid primary key references vehicles(id) on delete cascade,
                            fields jsonb not null,
                            updated_at timestamptz not null default now()
                        );
                        """,
                        connection);

                await command.ExecuteNonQueryAsync();
                logger.LogInformation("Enrichment schema bootstrap completed.");
        }
        catch (Exception ex)
        {
                logger.LogWarning(ex, "Enrichment schema bootstrap failed. Named places and trip tags may return 503 until schema is applied.");
        }
}

static async Task EnsureInitialAdminAsync(IServiceProvider services, VehicleAppAuthOptions authOptions)
{
    if (!authOptions.Enabled || string.IsNullOrWhiteSpace(authOptions.Username))
    {
        return;
    }

    var dataSource = services.GetRequiredService<NpgsqlDataSource>();
    await using var connection = await dataSource.OpenConnectionAsync();
    await using var command = new NpgsqlCommand("""
        insert into app_users (username, first_name, role, active)
        values (@username, @firstName, 'admin', true)
        on conflict (username) do update
          set role = 'admin', active = true, updated_at = now()
        """, connection);
    command.Parameters.AddWithValue("username", authOptions.Username);
    command.Parameters.AddWithValue("firstName", authOptions.Username);
    await command.ExecuteNonQueryAsync();
}

/// <summary>API and database liveness status.</summary>
public sealed record HealthResponse(string Status, DateTimeOffset CheckedAtUtc);

/// <summary>Vehicle metadata managed by vehicle_app.</summary>
public sealed record VehicleResponse(
    Guid Id,
    string DisplayName,
    string? Vin,
    int? Year,
    string? Make,
    string? Model,
    string? Notes,
    string? ProfileId,
    int? TraccarDeviceId,
    bool Active,
    DateTimeOffset CreatedAt);

public sealed record UpsertVehicleRequest(
    Guid? Id,
    string DisplayName,
    string? Vin,
    int? Year,
    string? Make,
    string? Model,
    string? Notes,
    string? ProfileId,
    bool Active = true);

/// <summary>Active binding between a Traccar device and an app vehicle.</summary>
public sealed record DeviceBindingResponse(
    Guid Id,
    Guid VehicleId,
    string VehicleDisplayName,
    int TraccarDeviceId,
    DateTimeOffset StartsAt,
    DateTimeOffset? EndsAt,
    bool IsPrimary);

/// <summary>Derived trip summary from vehicle_app.</summary>
public sealed record TripResponse(
    Guid Id,
    Guid VehicleId,
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    int DurationSeconds,
    double DistanceMeters,
    double? AvgSpeedMph,
    double? MaxSpeedMph,
    string? Notes,
    string? DerivationVersion);

/// <summary>Day-level trip aggregate for dashboard displays.</summary>
public sealed record TripDaySummaryResponse(
    DateOnly DayUtc,
    long TripCount,
    double DistanceMeters);

/// <summary>Named place record.</summary>
public sealed record NamedPlaceResponse(
    Guid Id,
    Guid? VehicleId,
    string Name,
    double Latitude,
    double Longitude,
    int RadiusMeters,
    string? Notes,
    DateTimeOffset CreatedAt);

/// <summary>Trip tag record.</summary>
public sealed record TripTagResponse(
    Guid Id,
    Guid? VehicleId,
    string Name,
    string? Color);

/// <summary>Trip note update response.</summary>
public sealed record TripNoteResponse(
    Guid TripId,
    string? Notes);

public sealed record RecalculateTripRequest
{
    public required int DurationSeconds { get; init; }
    public required double DistanceMeters { get; init; }
    public double? AvgSpeedMph { get; init; }
    public double? MaxSpeedMph { get; init; }
    public int? IdleSeconds { get; init; }
    public double? FuelUsedGallons { get; init; }
    public double? EstimatedMpg { get; init; }
    public long? StartTraccarPositionId { get; init; }
    public long? EndTraccarPositionId { get; init; }
    public required string DerivationVersion { get; init; }
}

public sealed record RecalculatedTripResponse(
    Guid Id,
    Guid VehicleId,
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    string? Notes,
    string DerivationVersion);

/// <summary>DTC catalog metadata entry.</summary>
public sealed record DtcCatalogItemResponse(
    string Code,
    string? Description,
    string? Severity,
    string? Category,
    string? Source,
    DateTimeOffset UpdatedAt);

/// <summary>DTC event row enriched with catalog metadata.</summary>
public sealed record DtcEventResponse(
    Guid Id,
    Guid VehicleId,
    Guid? TripId,
    int TraccarDeviceId,
    string Code,
    string? Description,
    string? Severity,
    string? Status,
    DateTimeOffset DetectedAt,
    long? SourcePositionId,
    long? SourceEventId,
    string? Notes,
    DateTimeOffset CreatedAt);

/// <summary>Request payload for importing derived trips by Traccar device.</summary>
public sealed record ImportTripsByDeviceRequest
{
    [JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    public required long TraccarDeviceId { get; init; }

    public string? DerivationVersion { get; init; }

    /// <summary>
    /// Used only by offline raw-position restores. A single overlapping saved
    /// trip is treated as the existing record because exported positions do
    /// not carry the original Traccar position IDs and can produce slightly
    /// different boundaries. Normal imports keep strict overlap protection.
    /// </summary>
    public bool TreatOverlappingAsExisting { get; init; }

    public IReadOnlyList<ImportTripItemRequest> Trips { get; init; } = [];
}

/// <summary>One derived trip item to persist.</summary>
public sealed record ImportTripItemRequest
{
    public required DateTimeOffset StartedAt { get; init; }

    public required DateTimeOffset EndedAt { get; init; }

    public required int DurationSeconds { get; init; }

    public required double DistanceMeters { get; init; }

    public double? AvgSpeedMph { get; init; }

    public double? MaxSpeedMph { get; init; }

    public int? IdleSeconds { get; init; }

    public double? FuelUsedGallons { get; init; }

    public double? EstimatedMpg { get; init; }

    public long? StartTraccarPositionId { get; init; }

    public long? EndTraccarPositionId { get; init; }

    public string? StartLabel { get; init; }

    public string? EndLabel { get; init; }

    public string? Notes { get; init; }
}

/// <summary>Request payload for creating/updating named places.</summary>
public sealed record UpsertNamedPlaceRequest
{
    public Guid? Id { get; init; }

    public Guid? VehicleId { get; init; }

    public required string Name { get; init; }

    public required double Latitude { get; init; }

    public required double Longitude { get; init; }

    public int RadiusMeters { get; init; } = 75;

    public string? Notes { get; init; }
}

/// <summary>Request payload for creating/updating trip tags.</summary>
public sealed record UpsertTripTagRequest
{
    public Guid? Id { get; init; }

    public Guid? VehicleId { get; init; }

    public required string Name { get; init; }

    public string? Color { get; init; }
}

/// <summary>Request payload for trip notes updates.</summary>
public sealed record TripNoteUpdateRequest
{
    public string? Notes { get; init; }
}

/// <summary>Result of importing trips for a mapped Traccar device.</summary>
public sealed record ImportTripsByDeviceResponse(
    Guid? VehicleId,
    int TraccarDeviceId,
    int Imported,
    int Skipped,
    IReadOnlyList<ImportedTripIdentity> Trips);

public sealed record ImportedTripIdentity(Guid Id, Guid VehicleId,
    DateTimeOffset StartedAt, DateTimeOffset EndedAt, string Outcome);

/// <summary>Request payload for DTC catalog upsert.</summary>
public sealed record UpsertDtcCatalogItemRequest
{
    public required string Code { get; init; }

    public string? Description { get; init; }

    public string? Severity { get; init; }

    public string? Category { get; init; }

    public string? Source { get; init; }
}

/// <summary>Request payload for importing DTC events by Traccar device.</summary>
public sealed record ImportDtcEventsByDeviceRequest
{
    [JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    public required long TraccarDeviceId { get; init; }

    public IReadOnlyList<ImportDtcEventItemRequest> Events { get; init; } = [];
}

/// <summary>Request payload for importing DTC events from raw Traccar payload records.</summary>
public sealed record ImportDtcEventsFromTraccarRequest
{
    [JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    public required long TraccarDeviceId { get; init; }

    public IReadOnlyList<ImportDtcSourceRecordRequest> Records { get; init; } = [];

    public bool IncludeIo30Fallback { get; init; }

    public bool IncludeIo30ZeroBaseline { get; init; }

    public IReadOnlyList<string> Io30FallbackAllowedStatuses { get; init; } = [];
}

/// <summary>One raw Traccar payload record that may contain one or many DTC codes.</summary>
public sealed record ImportDtcSourceRecordRequest
{
    public string? Code { get; init; }

    public DateTimeOffset? DetectedAt { get; init; }

    public Guid? TripId { get; init; }

    public string? Status { get; init; }

    public long? SourcePositionId { get; init; }

    public long? SourceEventId { get; init; }

    public JsonElement? Attributes { get; init; }

    public JsonElement? RawPayload { get; init; }

    public string? Notes { get; init; }
}

/// <summary>One DTC event item to persist.</summary>
public sealed record ImportDtcEventItemRequest
{
    public required string Code { get; init; }

    public DateTimeOffset DetectedAt { get; init; } = DateTimeOffset.UtcNow;

    public Guid? TripId { get; init; }

    public string? Description { get; init; }

    public string? Severity { get; init; }

    public string? Category { get; init; }

    public string? Source { get; init; }

    public string? Status { get; init; }

    public long? SourcePositionId { get; init; }

    public long? SourceEventId { get; init; }

    public JsonElement? RawPayload { get; init; }

    public string? Notes { get; init; }
}

/// <summary>Result of importing DTC events for a mapped Traccar device.</summary>
public sealed record ImportDtcEventsByDeviceResponse(
    Guid VehicleId,
    int TraccarDeviceId,
    int Imported,
    int Skipped);

/// <summary>Request payload to bind a Traccar device id to an existing vehicle.</summary>
public sealed record UpsertDeviceBindingRequest
{
    public required Guid VehicleId { get; init; }

    public required int TraccarDeviceId { get; init; }

    public bool IsPrimary { get; init; } = true;

    public DateTimeOffset? EffectiveFrom { get; init; }
}

/// <summary>Result payload for device binding updates.</summary>
public sealed record UpsertDeviceBindingResponse(
    Guid BindingId,
    Guid VehicleId,
    int TraccarDeviceId,
    bool IsPrimary);

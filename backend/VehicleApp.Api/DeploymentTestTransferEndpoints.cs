using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;

public sealed record DeploymentTransferFileSummary(string Path, long Records, string Sha256);

public static class DeploymentTestTransferEndpoints
{
    private const int MaximumRangeDays = 184;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private sealed record TableExport(string Name, bool Required, string? FilterSql = null);

    private static readonly TableExport[] AppTables =
    [
        new("vehicles", true),
        new("traccar_sources", false),
        new("vehicle_device_bindings", true),
        new("trips", true, "ended_at >= @from and started_at < @to"),
        new("trip_route_points", false, "trip_id in (select id from trips where ended_at >= @from and started_at < @to)"),
        new("trip_tags", false),
        new("trip_tag_map", false, "trip_id in (select id from trips where ended_at >= @from and started_at < @to)"),
        new("trip_events", false, "occurred_at >= @from and occurred_at < @to"),
        new("trip_event_thresholds", false),
        new("named_places", false),
        new("fuel_fills", false, "filled_at >= @from and filled_at < @to"),
        new("maintenance_records", false, "service_date >= @from and service_date < @to"),
        new("alert_rules", false),
        new("alert_events", false, "triggered_at >= @from and triggered_at < @to"),
        new("telemetry_profiles", true),
        new("telemetry_profile_assignments", true),
        new("telemetry_profile_revisions", true),
        new("telemetry_source_mapping_revisions", true),
        new("vehicle_speed_bands", false),
        new("vehicle_status_card_preferences", false),
        new("trip_external_identities", false, "trip_id in (select id from trips where ended_at >= @from and started_at < @to)"),
    ];

    public static void MapDeploymentTestTransferEndpoints(this WebApplication app)
    {
        app.MapGet("/api/admin/deployment-transfer/status", StatusAsync);
        app.MapGet("/api/admin/deployment-transfer/export", ExportAsync);
    }

    private static async Task<IResult> StatusAsync(
        VehicleAppAuthOptions authOptions,
        NpgsqlDataSource dataSource,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (!authOptions.IsDevelopmentBypass(context)) return Results.NotFound();
        var authorization = await AuthorizeAdminAsync(dataSource, authOptions, context, cancellationToken);
        if (authorization is not null) return authorization;

        var now = DateTimeOffset.UtcNow;
        return Results.Ok(new
        {
            enabled = true,
            defaultFromUtc = now.AddMonths(-3),
            defaultToUtc = now,
            maximumRangeDays = MaximumRangeDays,
            formatVersion = 1,
        });
    }

    private static async Task<IResult> ExportAsync(
        DateTimeOffset? from,
        DateTimeOffset? to,
        VehicleAppAuthOptions authOptions,
        NpgsqlDataSource dataSource,
        GlobalGeneralSettingsStore generalSettingsStore,
        TraccarProxyOptions traccarOptions,
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        if (!authOptions.IsDevelopmentBypass(context)) return Results.NotFound();
        var authorization = await AuthorizeAdminAsync(dataSource, authOptions, context, cancellationToken);
        if (authorization is not null) return authorization;
        var logger = loggerFactory.CreateLogger("DeploymentTestTransfer");

        var toUtc = (to ?? DateTimeOffset.UtcNow).ToUniversalTime();
        var fromUtc = (from ?? toUtc.AddMonths(-3)).ToUniversalTime();
        if (fromUtc >= toUtc) return Results.BadRequest(new { detail = "The start must be earlier than the end." });
        if ((toUtc - fromUtc).TotalDays > MaximumRangeDays)
            return Results.BadRequest(new { detail = $"The selected range cannot exceed {MaximumRangeDays} days." });
        var latestExclusiveUtc = new DateTimeOffset(DateTime.UtcNow.Date.AddDays(1), TimeSpan.Zero);
        if (toUtc > latestExclusiveUtc)
            return Results.BadRequest(new { detail = "The end of the range cannot be in the future." });

        GlobalGeneralSettings settings;
        try
        {
            settings = await generalSettingsStore.GetAsync(cancellationToken);
        }
        catch (CredentialProtectionException)
        {
            return Results.Problem(title: "Traccar connection unavailable", detail: "The saved Traccar password cannot be decrypted. Check the API credential encryption key configuration.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        if (string.IsNullOrWhiteSpace(settings.Username) || string.IsNullOrEmpty(settings.Password))
            return Results.Problem(title: "Traccar connection not configured", detail: "An administrator must configure the shared Traccar API account before exporting history.", statusCode: StatusCodes.Status503ServiceUnavailable);

        var tempPath = Path.Combine(Path.GetTempPath(), $"vehicleapp-transfer-{Guid.NewGuid():N}.zip");
        FileStream? archiveStream = null;
        try
        {
            archiveStream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1024 * 128, FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.DeleteOnClose);
            var fileSummaries = new List<DeploymentTransferFileSummary>();
            string traccarVersion;
            int deviceCount;
            IReadOnlyList<string> appTableNames;
            using (var zip = new ZipArchive(archiveStream, ZipArchiveMode.Create, leaveOpen: true))
            {
                (traccarVersion, deviceCount) = await ExportTraccarAsync(zip, fileSummaries, settings, traccarOptions, httpClientFactory, fromUtc, toUtc, cancellationToken);
                appTableNames = await ExportVehicleAppAsync(zip, fileSummaries, dataSource, fromUtc, toUtc, cancellationToken);
                var manifest = new
                {
                    formatVersion = 1,
                    generatedAtUtc = DateTimeOffset.UtcNow,
                    range = new { fromInclusiveUtc = fromUtc, toExclusiveUtc = toUtc },
                    source = new
                    {
                        traccarVersion,
                        application = "Traccar React",
                        apiAssemblyVersion = typeof(DeploymentTestTransferEndpoints).Assembly.GetName().Version?.ToString(),
                        vehicleAppSchema = "allowlisted-jsonl-v1",
                    },
                    deviceCount,
                    files = fileSummaries,
                    includedVehicleAppTables = appTableNames,
                    remappingRequired = new[] { "Traccar device IDs", "Traccar position IDs" },
                };
                var entry = zip.CreateEntry("manifest.json", CompressionLevel.Fastest);
                await using var entryStream = entry.Open();
                await JsonSerializer.SerializeAsync(entryStream, manifest, JsonOptions, cancellationToken);
            }

            await archiveStream.FlushAsync(cancellationToken);
            archiveStream.Position = 0;
            var downloadName = $"vehicleapp-deployment-test-{fromUtc:yyyy-MM-dd}-to-{toUtc:yyyy-MM-dd}.zip";
            context.Response.Headers.CacheControl = "no-store, private";
            context.Response.Headers.Pragma = "no-cache";
            logger.LogInformation(
                "Deployment test export prepared for administrator {Administrator}, range {FromUtc} to {ToUtc}, {DeviceCount} devices, {RecordCount} records (requestId: {RequestId})",
                context.User.Identity?.Name,
                fromUtc,
                toUtc,
                deviceCount,
                fileSummaries.Sum(file => file.Records),
                context.TraceIdentifier);
            var resultStream = archiveStream;
            archiveStream = null;
            return Results.File(resultStream, "application/zip", downloadName, enableRangeProcessing: false);
        }
        catch (MissingExportSchemaException exception)
        {
            return Results.Problem(title: "VehicleApp schema is not ready for export", detail: exception.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (HttpRequestException exception)
        {
            logger.LogWarning(exception, "Deployment export could not retrieve a Traccar response (requestId: {RequestId})", context.TraceIdentifier);
            return Results.Problem(title: "Traccar server unavailable", detail: "VehicleApp could not retrieve the selected historical records from the configured Traccar server.", statusCode: StatusCodes.Status502BadGateway);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Deployment export received an invalid Traccar JSON response (requestId: {RequestId})", context.TraceIdentifier);
            return Results.Problem(title: "Traccar response could not be read", detail: "The Traccar API returned data in an unexpected format. No export was created.", statusCode: StatusCodes.Status502BadGateway);
        }
        catch (InvalidOperationException exception)
        {
            return Results.Problem(title: "Traccar connection is invalid", detail: exception.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException exception)
        {
            return Results.Problem(title: "VehicleApp data export failed", detail: $"PostgreSQL {exception.SqlState}: {exception.MessageText}", statusCode: StatusCodes.Status500InternalServerError);
        }
        finally
        {
            if (archiveStream is not null) await archiveStream.DisposeAsync();
            try { File.Delete(tempPath); } catch (IOException) { }
        }
    }

    private static async Task<(string Version, int DeviceCount)> ExportTraccarAsync(
        ZipArchive zip,
        List<DeploymentTransferFileSummary> summaries,
        GlobalGeneralSettings settings,
        TraccarProxyOptions options,
        IHttpClientFactory httpClientFactory,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken)
    {
        var baseUri = ResolveApiBaseUri(settings.ApiBaseUrl, options.ServerBaseUrl);
        using var client = httpClientFactory.CreateClient("TraccarProxy");
        client.Timeout = TimeSpan.FromMinutes(10);
        client.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
        var token = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.Username}:{settings.Password}"));
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", token);

        using var serverResponse = await client.GetAsync(new Uri(baseUri, "server"), HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        serverResponse.EnsureSuccessStatusCode();
        await using var serverStream = await serverResponse.Content.ReadAsStreamAsync(cancellationToken);
        using var serverDocument = await JsonDocument.ParseAsync(serverStream, cancellationToken: cancellationToken);
        var version = serverDocument.RootElement.TryGetProperty("version", out var versionValue) ? versionValue.GetString() : null;
        if (string.IsNullOrWhiteSpace(version)) throw new JsonException("Traccar server version is missing.");

        using var devicesResponse = await client.GetAsync(new Uri(baseUri, "devices"), HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        devicesResponse.EnsureSuccessStatusCode();
        await using var devicesStream = await devicesResponse.Content.ReadAsStreamAsync(cancellationToken);
        var devices = await JsonSerializer.DeserializeAsync<List<JsonElement>>(devicesStream, JsonOptions, cancellationToken) ?? [];
        if (devices.Any(device => !device.TryGetProperty("id", out var id) || !id.TryGetInt32(out _)))
            throw new JsonException("A Traccar device did not have a numeric ID.");

        await using (var writer = await JsonlZipWriter.CreateAsync(zip, "traccar/devices.jsonl", cancellationToken))
        {
            foreach (var device in devices)
            {
                var safeDevice = new
                {
                    id = device.GetProperty("id").GetInt32(),
                    name = OptionalString(device, "name"),
                    uniqueId = OptionalString(device, "uniqueId"),
                    model = OptionalString(device, "model"),
                    category = OptionalString(device, "category"),
                };
                await writer.WriteLineAsync(JsonSerializer.SerializeToUtf8Bytes(safeDevice, JsonOptions), cancellationToken);
            }
            summaries.Add(await writer.CompleteAsync(cancellationToken));
        }

        var queryFrom = Uri.EscapeDataString(fromUtc.ToString("O", CultureInfo.InvariantCulture));
        var queryTo = Uri.EscapeDataString(toUtc.ToString("O", CultureInfo.InvariantCulture));
        await using (var writer = await JsonlZipWriter.CreateAsync(zip, "traccar/positions.jsonl", cancellationToken))
        {
            foreach (var device in devices)
            {
                var deviceId = device.GetProperty("id").GetInt32();
                var positionsUri = new Uri(baseUri, $"positions?deviceId={deviceId}&from={queryFrom}&to={queryTo}");
                using var positionsResponse = await client.GetAsync(positionsUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                positionsResponse.EnsureSuccessStatusCode();
                await using var positionsStream = await positionsResponse.Content.ReadAsStreamAsync(cancellationToken);
                await foreach (var position in JsonSerializer.DeserializeAsyncEnumerable<JsonElement>(positionsStream, JsonOptions, cancellationToken))
                {
                    await writer.WriteLineAsync(Encoding.UTF8.GetBytes(position.GetRawText()), cancellationToken);
                }
            }
            summaries.Add(await writer.CompleteAsync(cancellationToken));
        }

        await using (var writer = await JsonlZipWriter.CreateAsync(zip, "traccar/events.jsonl", cancellationToken))
        {
            foreach (var device in devices)
            {
                var deviceId = device.GetProperty("id").GetInt32();
                var eventsUri = new Uri(baseUri, $"reports/events?deviceId={deviceId}&from={queryFrom}&to={queryTo}");
                using var eventsResponse = await client.GetAsync(eventsUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                eventsResponse.EnsureSuccessStatusCode();
                await using var eventsStream = await eventsResponse.Content.ReadAsStreamAsync(cancellationToken);
                await foreach (var traccarEvent in JsonSerializer.DeserializeAsyncEnumerable<JsonElement>(eventsStream, JsonOptions, cancellationToken))
                {
                    await writer.WriteLineAsync(Encoding.UTF8.GetBytes(traccarEvent.GetRawText()), cancellationToken);
                }
            }
            summaries.Add(await writer.CompleteAsync(cancellationToken));
        }

        return (version, devices.Count);
    }

    private static async Task<IReadOnlyList<string>> ExportVehicleAppAsync(
        ZipArchive zip,
        List<DeploymentTransferFileSummary> summaries,
        NpgsqlDataSource dataSource,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken)
    {
        var included = new List<string>();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, cancellationToken);

        var existing = new HashSet<string>(StringComparer.Ordinal);
        await using (var tablesCommand = new NpgsqlCommand("select table_name from information_schema.tables where table_schema=current_schema() and table_type='BASE TABLE'", connection, transaction))
        await using (var tablesReader = await tablesCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await tablesReader.ReadAsync(cancellationToken)) existing.Add(tablesReader.GetString(0));
        }

        foreach (var table in AppTables)
        {
            if (!existing.Contains(table.Name))
            {
                if (table.Required) throw new MissingExportSchemaException($"Required table '{table.Name}' is missing. Apply the current VehicleApp schema migrations before exporting.");
                continue;
            }

            var jsonExpression = table.Name switch
            {
                "traccar_sources" => "to_jsonb(t) - 'base_url'",
                "telemetry_profile_revisions" or "telemetry_source_mapping_revisions" => "to_jsonb(t) - 'changed_by'",
                _ => "to_jsonb(t)",
            };
            var sql = $"select ({jsonExpression})::text from \"{table.Name}\" as t" + (table.FilterSql is null ? string.Empty : $" where {table.FilterSql}");
            await using var command = new NpgsqlCommand(sql, connection, transaction);
            if (table.FilterSql is not null)
            {
                command.Parameters.AddWithValue("from", fromUtc);
                command.Parameters.AddWithValue("to", toUtc);
            }
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            await using var writer = await JsonlZipWriter.CreateAsync(zip, $"vehicle-app/{table.Name}.jsonl", cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                await writer.WriteLineAsync(Encoding.UTF8.GetBytes(reader.GetString(0)), cancellationToken);
            summaries.Add(await writer.CompleteAsync(cancellationToken));
            included.Add(table.Name);
        }

        await transaction.CommitAsync(cancellationToken);
        return included;
    }

    private static Uri ResolveApiBaseUri(string apiBaseUrl, string? serverBaseUrl)
    {
        if (Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var absolute))
        {
            if (absolute.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(absolute.UserInfo))
                throw new InvalidOperationException("The configured Traccar API URL is invalid.");
            return new Uri(absolute.ToString().TrimEnd('/') + "/", UriKind.Absolute);
        }

        if (string.IsNullOrWhiteSpace(serverBaseUrl) || !Uri.TryCreate(serverBaseUrl.TrimEnd('/') + "/", UriKind.Absolute, out var serverBase)
            || serverBase.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(serverBase.UserInfo))
            throw new InvalidOperationException("The Traccar server target is invalid.");

        var apiPath = apiBaseUrl.Trim();
        var combined = apiPath.StartsWith('/')
            ? new Uri(serverBase.GetLeftPart(UriPartial.Authority) + apiPath.TrimEnd('/') + "/", UriKind.Absolute)
            : new Uri(serverBase, apiPath.TrimEnd('/') + "/");
        return combined;
    }

    private static string? OptionalString(JsonElement value, string propertyName) =>
        value.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static async Task<IResult?> AuthorizeAdminAsync(NpgsqlDataSource dataSource, VehicleAppAuthOptions authOptions, HttpContext context, CancellationToken cancellationToken)
    {
        if (authOptions.IsDevelopmentBypass(context)
            && context.User.Identities.Any(identity => string.Equals(identity.AuthenticationType, "DevelopmentBypass", StringComparison.Ordinal)))
            return context.User.IsInRole("admin") ? null : Results.Forbid();

        var username = context.User.Identity?.Name;
        if (string.IsNullOrWhiteSpace(username)) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select role from app_users where username=@username and active", connection);
        command.Parameters.AddWithValue("username", username);
        var role = await command.ExecuteScalarAsync(cancellationToken) as string;
        if (role is null) return Results.Unauthorized();
        return string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase) ? null : Results.Forbid();
    }

    private sealed class MissingExportSchemaException(string message) : Exception(message);

    private sealed class JsonlZipWriter : IAsyncDisposable
    {
        private readonly ZipArchiveEntry _entry;
        private readonly Stream _stream;
        private readonly IncrementalHash _hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        private long _records;
        private bool _completed;

        private JsonlZipWriter(ZipArchiveEntry entry)
        {
            _entry = entry;
            _stream = entry.Open();
        }

        public static Task<JsonlZipWriter> CreateAsync(ZipArchive zip, string path, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(new JsonlZipWriter(zip.CreateEntry(path, CompressionLevel.Fastest)));
        }

        public async Task WriteLineAsync(ReadOnlyMemory<byte> json, CancellationToken cancellationToken)
        {
            if (_completed) throw new InvalidOperationException("The JSONL entry is already complete.");
            _hash.AppendData(json.Span);
            _hash.AppendData("\n"u8);
            await _stream.WriteAsync(json, cancellationToken);
            await _stream.WriteAsync("\n"u8.ToArray(), cancellationToken);
            _records++;
        }

        public async Task<DeploymentTransferFileSummary> CompleteAsync(CancellationToken cancellationToken)
        {
            if (!_completed)
            {
                await _stream.DisposeAsync();
                _completed = true;
            }
            var digest = Convert.ToHexString(_hash.GetHashAndReset()).ToLowerInvariant();
            _hash.Dispose();
            return new DeploymentTransferFileSummary(_entry.FullName, _records, digest);
        }

        public async ValueTask DisposeAsync()
        {
            if (!_completed) await _stream.DisposeAsync();
            _hash.Dispose();
        }
    }
}

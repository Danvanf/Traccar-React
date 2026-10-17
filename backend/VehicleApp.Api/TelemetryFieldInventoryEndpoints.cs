using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Npgsql;
using NpgsqlTypes;

public sealed record TelemetryFieldInventoryField(
    string Key,
    long PositionCount,
    DateTimeOffset FirstSeenAt,
    DateTimeOffset LastSeenAt,
    string[] ValueTypes);

public sealed record TelemetryFieldInventoryResponse(
    int TraccarDeviceId,
    string Status,
    DateTimeOffset? GeneratedAt,
    DateTimeOffset? ScanStartUtc,
    DateTimeOffset? ScanEndUtc,
    DateTimeOffset? ScannedThroughUtc,
    double? ProgressPercent,
    string? Error,
    IReadOnlyList<TelemetryFieldInventoryField> Fields);

public sealed class TelemetryFieldInventoryService(
    NpgsqlDataSource dataSource,
    GlobalGeneralSettingsStore generalSettingsStore,
    TraccarProxyOptions traccarProxyOptions,
    IHttpClientFactory httpClientFactory,
    ILogger<TelemetryFieldInventoryService> logger) : BackgroundService
{
    private static readonly TimeSpan RefreshAfter = TimeSpan.FromHours(24);
    private static readonly TimeSpan WindowLength = TimeSpan.FromDays(30);
    private static readonly TimeSpan MinimumSplitWindow = TimeSpan.FromHours(1);
    private const int SplitAtPositionCount = 50000;
    private const long SplitAtPayloadBytes = 12 * 1024 * 1024;
    private const long MaxPayloadBytes = 40 * 1024 * 1024;
    private const int MaxPositionsAtMinimumWindow = 100000;
    private static readonly DateTimeOffset EarliestFallback = new(2000, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private readonly Channel<int> _queue = Channel.CreateUnbounded<int>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
    private readonly ConcurrentDictionary<int, byte> _queuedOrRunning = new();

    public async Task EnsureSchemaAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            create table if not exists telemetry_field_inventory_cache_state (
                traccar_device_id integer primary key,
                generated_at timestamptz not null default now(),
                status text not null default 'complete',
                scan_start_at timestamptz null,
                scan_end_at timestamptz null,
                scanned_through timestamptz null,
                last_error text null,
                updated_at timestamptz not null default now()
            );
            alter table telemetry_field_inventory_cache_state add column if not exists status text not null default 'complete';
            alter table telemetry_field_inventory_cache_state add column if not exists scan_start_at timestamptz null;
            alter table telemetry_field_inventory_cache_state add column if not exists scan_end_at timestamptz null;
            alter table telemetry_field_inventory_cache_state add column if not exists scanned_through timestamptz null;
            alter table telemetry_field_inventory_cache_state add column if not exists last_error text null;
            alter table telemetry_field_inventory_cache_state add column if not exists updated_at timestamptz not null default now();
            create table if not exists telemetry_field_inventory_cache (
                traccar_device_id integer not null,
                field_key text not null,
                position_count bigint not null,
                first_seen_at timestamptz not null,
                last_seen_at timestamptz not null,
                value_types text[] not null default '{}',
                primary key (traccar_device_id, field_key)
            );
            """, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<TelemetryFieldInventoryResponse> GetAsync(int deviceId, CancellationToken cancellationToken)
    {
        var response = await ReadAsync(deviceId, cancellationToken);
        if (response.Status == "notStarted")
        {
            await QueueAsync(deviceId, cancellationToken);
            return await ReadAsync(deviceId, cancellationToken);
        }

        if (response.Status == "complete" && (
            response.ScanStartUtc is null
            || response.GeneratedAt is { } generatedAt && DateTimeOffset.UtcNow - generatedAt > RefreshAfter))
        {
            await QueueAsync(deviceId, cancellationToken);
            return await ReadAsync(deviceId, cancellationToken);
        }

        return response;
    }

    public async Task<TelemetryFieldInventoryResponse> RetryAsync(int deviceId, CancellationToken cancellationToken)
    {
        var current = await ReadAsync(deviceId, cancellationToken);
        if (current.Status is not ("queued" or "scanning")) await QueueAsync(deviceId, cancellationToken);
        return await ReadAsync(deviceId, cancellationToken);
    }

    private async Task QueueAsync(int deviceId, CancellationToken cancellationToken)
    {
        if (!_queuedOrRunning.TryAdd(deviceId, 0)) return;
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using (var command = new NpgsqlCommand("""
                insert into telemetry_field_inventory_cache_state
                    (traccar_device_id, generated_at, status, updated_at)
                values (@deviceId, now(), 'queued', now())
                on conflict (traccar_device_id) do update set
                    status = case when telemetry_field_inventory_cache_state.status = 'scanning' then 'scanning' else 'queued' end,
                    last_error = null,
                    updated_at = now()
                """, connection))
            {
                command.Parameters.AddWithValue("deviceId", deviceId);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            await _queue.Writer.WriteAsync(deviceId, cancellationToken);
        }
        catch
        {
            _queuedOrRunning.TryRemove(deviceId, out _);
            throw;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await RecoverQueuedScansAsync(stoppingToken);
            await foreach (var deviceId in _queue.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    await ScanDeviceAsync(deviceId, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    logger.LogError(exception, "Telemetry field inventory scan failed for Traccar device {DeviceId}", deviceId);
                    await MarkFailedAsync(deviceId, SafeErrorMessage(exception), stoppingToken);
                }
                finally
                {
                    _queuedOrRunning.TryRemove(deviceId, out _);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task RecoverQueuedScansAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select traccar_device_id from telemetry_field_inventory_cache_state where status in ('queued', 'scanning') order by updated_at", connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var ids = new List<int>();
        while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetInt32(0));
        foreach (var id in ids)
        {
            if (_queuedOrRunning.TryAdd(id, 0)) await _queue.Writer.WriteAsync(id, cancellationToken);
        }
    }

    private async Task ScanDeviceAsync(int deviceId, CancellationToken cancellationToken)
    {
        var state = await ReadScanStateAsync(deviceId, cancellationToken);
        if (state is null) return;

        var settings = await generalSettingsStore.GetAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(settings.Username) || string.IsNullOrEmpty(settings.Password))
            throw new InvalidOperationException("The shared Traccar username and password must be configured in General settings.");

        var apiBase = BuildApiBase(settings.ApiBaseUrl, traccarProxyOptions.ServerBaseUrl);
        using var client = httpClientFactory.CreateClient("TraccarProxy");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.Username}:{settings.Password}")));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var creationTime = await ReadDeviceCreationTimeAsync(client, apiBase, deviceId, cancellationToken);
        var scanStart = state.ScanStartUtc ?? creationTime ?? EarliestFallback;
        var scanEnd = DateTimeOffset.UtcNow;
        var cursor = state.ScannedThroughUtc?.AddMilliseconds(1) ?? scanStart;
        if (state.ScanStartUtc is null && state.ScannedThroughUtc is null)
            await ClearCachedFieldsAsync(deviceId, cancellationToken);
        await UpdateProgressAsync(deviceId, "scanning", scanStart, scanEnd, state.ScannedThroughUtc, null, cancellationToken);

        while (cursor < scanEnd)
        {
            var windowEnd = cursor + WindowLength < scanEnd ? cursor + WindowLength : scanEnd;
            var fields = await ReadWindowAsync(client, apiBase, deviceId, cursor, windowEnd, cancellationToken);
            await SaveFieldsAndProgressAsync(deviceId, fields, scanStart, scanEnd, windowEnd, cancellationToken);
            cursor = windowEnd.AddMilliseconds(1);
        }

        await UpdateProgressAsync(deviceId, "complete", scanStart, scanEnd, scanEnd, null, cancellationToken, completed: true);
    }

    private static Uri BuildApiBase(string apiBaseUrl, string? serverBaseUrl)
    {
        var configured = apiBaseUrl.Trim();
        Uri? result = null;
        if (Uri.TryCreate(configured, UriKind.Absolute, out var absolute))
        {
            result = absolute;
        }
        else if (!string.IsNullOrWhiteSpace(serverBaseUrl) && Uri.TryCreate(serverBaseUrl.TrimEnd('/'), UriKind.Absolute, out var server))
        {
            var apiPath = string.IsNullOrWhiteSpace(configured) ? "/api" : (configured.StartsWith('/') ? configured : "/" + configured);
            result = new Uri(server.ToString().TrimEnd('/') + apiPath.TrimEnd('/') + "/", UriKind.Absolute);
        }

        if (result is null || result.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(result.UserInfo))
            throw new InvalidOperationException("The Traccar API base URL or API server target is invalid.");
        return new Uri(result.ToString().TrimEnd('/') + "/", UriKind.Absolute);
    }

    private static async Task<DateTimeOffset?> ReadDeviceCreationTimeAsync(HttpClient client, Uri apiBase, int deviceId, CancellationToken cancellationToken)
    {
        using var response = await client.GetAsync(new Uri(apiBase, $"devices/{deviceId}"), HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(response.StatusCode is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Forbidden
                ? "The Traccar device was not found or is not visible to the shared Traccar account."
                : $"Traccar device lookup returned HTTP {(int)response.StatusCode}.");
        using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        return ParseTimestamp(document.RootElement, "creationTime");
    }

    private static async Task<Dictionary<string, FieldAccumulator>> ReadWindowAsync(
        HttpClient client, Uri apiBase, int deviceId, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        var span = to - from;
        var fromText = Uri.EscapeDataString(from.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
        var toText = Uri.EscapeDataString(to.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
        var requestUri = new Uri(apiBase, $"positions?deviceId={deviceId}&from={fromText}&to={toText}");
        using var response = await client.GetAsync(requestUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Traccar position scan returned HTTP {(int)response.StatusCode}.");

        if (response.Content.Headers.ContentLength is > SplitAtPayloadBytes && span > MinimumSplitWindow)
            return await SplitWindowAsync(client, apiBase, deviceId, from, to, cancellationToken);
        if (response.Content.Headers.ContentLength is > MaxPayloadBytes)
            throw new InvalidOperationException("A one-hour Traccar history window exceeds the safe scan size.");

        using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("Traccar returned an unexpected response while scanning positions.");
        var positions = document.RootElement;
        if (positions.GetArrayLength() > SplitAtPositionCount && span > MinimumSplitWindow)
            return await SplitWindowAsync(client, apiBase, deviceId, from, to, cancellationToken);
        if (positions.GetArrayLength() > MaxPositionsAtMinimumWindow)
            throw new InvalidOperationException("A one-hour Traccar history window exceeds the safe scan limit.");

        var fields = new Dictionary<string, FieldAccumulator>(StringComparer.Ordinal);
        foreach (var position in positions.EnumerateArray())
        {
            if (!position.TryGetProperty("attributes", out var attributes) || attributes.ValueKind != JsonValueKind.Object) continue;
            var timestamp = ParseTimestamp(position, "fixTime")
                ?? ParseTimestamp(position, "deviceTime")
                ?? ParseTimestamp(position, "serverTime")
                ?? from;
            foreach (var attribute in attributes.EnumerateObject())
            {
                if (string.IsNullOrWhiteSpace(attribute.Name)) continue;
                if (!fields.TryGetValue(attribute.Name, out var accumulator))
                {
                    accumulator = new FieldAccumulator(attribute.Name);
                    fields.Add(attribute.Name, accumulator);
                }
                accumulator.Observe(timestamp, GetValueType(attribute.Value));
            }
        }
        return fields;
    }

    private static async Task<Dictionary<string, FieldAccumulator>> SplitWindowAsync(
        HttpClient client, Uri apiBase, int deviceId, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        var midpoint = from + TimeSpan.FromTicks((to - from).Ticks / 2);
        if (midpoint - from < MinimumSplitWindow || to - midpoint < MinimumSplitWindow)
            throw new InvalidOperationException("A Traccar history window exceeds the safe scan size and cannot be divided further.");
        var left = await ReadWindowAsync(client, apiBase, deviceId, from, midpoint, cancellationToken);
        var right = await ReadWindowAsync(client, apiBase, deviceId, midpoint.AddMilliseconds(1), to, cancellationToken);
        foreach (var entry in right)
        {
            if (!left.TryGetValue(entry.Key, out var existing)) left[entry.Key] = entry.Value;
            else existing.Merge(entry.Value);
        }
        return left;
    }

    private async Task SaveFieldsAndProgressAsync(
        int deviceId, Dictionary<string, FieldAccumulator> fields, DateTimeOffset scanStart, DateTimeOffset scanEnd,
        DateTimeOffset scannedThrough, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        foreach (var field in fields.Values)
        {
            await using var command = new NpgsqlCommand("""
                insert into telemetry_field_inventory_cache
                    (traccar_device_id, field_key, position_count, first_seen_at, last_seen_at, value_types)
                values (@deviceId, @key, @count, @firstSeen, @lastSeen, @types)
                on conflict (traccar_device_id, field_key) do update set
                    position_count = telemetry_field_inventory_cache.position_count + excluded.position_count,
                    first_seen_at = least(telemetry_field_inventory_cache.first_seen_at, excluded.first_seen_at),
                    last_seen_at = greatest(telemetry_field_inventory_cache.last_seen_at, excluded.last_seen_at),
                    value_types = (select coalesce(array_agg(distinct value_type order by value_type), '{}'::text[])
                        from unnest(telemetry_field_inventory_cache.value_types || excluded.value_types) as value_type)
                """, connection, transaction);
            command.Parameters.AddWithValue("deviceId", deviceId);
            command.Parameters.AddWithValue("key", field.Key);
            command.Parameters.AddWithValue("count", field.Count);
            command.Parameters.AddWithValue("firstSeen", field.FirstSeenAt.ToUniversalTime());
            command.Parameters.AddWithValue("lastSeen", field.LastSeenAt.ToUniversalTime());
            command.Parameters.Add("types", NpgsqlDbType.Array | NpgsqlDbType.Text).Value = field.ValueTypes.ToArray();
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var progress = new NpgsqlCommand("""
            update telemetry_field_inventory_cache_state
            set status='scanning', scan_start_at=@scanStart, scan_end_at=@scanEnd,
                scanned_through=@scannedThrough, last_error=null, updated_at=now()
            where traccar_device_id=@deviceId
            """, connection, transaction))
        {
            progress.Parameters.AddWithValue("deviceId", deviceId);
            progress.Parameters.AddWithValue("scanStart", scanStart.ToUniversalTime());
            progress.Parameters.AddWithValue("scanEnd", scanEnd.ToUniversalTime());
            progress.Parameters.AddWithValue("scannedThrough", scannedThrough.ToUniversalTime());
            await progress.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task ClearCachedFieldsAsync(int deviceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("delete from telemetry_field_inventory_cache where traccar_device_id=@deviceId", connection);
        command.Parameters.AddWithValue("deviceId", deviceId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task UpdateProgressAsync(
        int deviceId, string status, DateTimeOffset scanStart, DateTimeOffset scanEnd,
        DateTimeOffset? scannedThrough, string? error, CancellationToken cancellationToken, bool completed = false)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            update telemetry_field_inventory_cache_state
            set status=@status, scan_start_at=@scanStart, scan_end_at=@scanEnd,
                scanned_through=@scannedThrough, last_error=@error, updated_at=now(),
                generated_at=case when @completed then now() else generated_at end
            where traccar_device_id=@deviceId
            """, connection);
        command.Parameters.AddWithValue("deviceId", deviceId);
        command.Parameters.AddWithValue("status", status);
        command.Parameters.AddWithValue("scanStart", scanStart.ToUniversalTime());
        command.Parameters.AddWithValue("scanEnd", scanEnd.ToUniversalTime());
        command.Parameters.AddWithValue("scannedThrough", (object?)scannedThrough?.ToUniversalTime() ?? DBNull.Value);
        command.Parameters.AddWithValue("error", (object?)error ?? DBNull.Value);
        command.Parameters.AddWithValue("completed", completed);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task MarkFailedAsync(int deviceId, string message, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("update telemetry_field_inventory_cache_state set status='error', last_error=@message, updated_at=now() where traccar_device_id=@deviceId", connection);
            command.Parameters.AddWithValue("deviceId", deviceId);
            command.Parameters.AddWithValue("message", message);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Could not save telemetry inventory scan failure state for device {DeviceId}", deviceId);
        }
    }

    private async Task<TelemetryFieldInventoryResponse> ReadAsync(int deviceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        string? status = null;
        DateTimeOffset? generatedAt = null, scanStart = null, scanEnd = null, scannedThrough = null;
        string? error = null;
        await using (var command = new NpgsqlCommand("""
            select status, generated_at, scan_start_at, scan_end_at, scanned_through, last_error
            from telemetry_field_inventory_cache_state where traccar_device_id=@deviceId
            """, connection))
        {
            command.Parameters.AddWithValue("deviceId", deviceId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                status = reader.GetString(0);
                generatedAt = ReadUtc(reader, 1);
                scanStart = ReadUtc(reader, 2);
                scanEnd = ReadUtc(reader, 3);
                scannedThrough = ReadUtc(reader, 4);
                error = reader.IsDBNull(5) ? null : reader.GetString(5);
            }
        }

        var fields = new List<TelemetryFieldInventoryField>();
        await using (var command = new NpgsqlCommand("""
            select field_key, position_count, first_seen_at, last_seen_at, value_types
            from telemetry_field_inventory_cache where traccar_device_id=@deviceId order by field_key
            """, connection))
        {
            command.Parameters.AddWithValue("deviceId", deviceId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                fields.Add(new TelemetryFieldInventoryField(reader.GetString(0), reader.GetInt64(1), ReadUtc(reader, 2)!.Value, ReadUtc(reader, 3)!.Value, reader.GetFieldValue<string[]>(4)));
        }

        double? progress = null;
        if (scanStart is { } start && scanEnd is { } end && end > start)
        {
            var through = scannedThrough ?? start;
            progress = Math.Clamp((through - start).TotalMilliseconds / (end - start).TotalMilliseconds * 100, 0, 100);
            if (status == "complete") progress = 100;
        }
        return new TelemetryFieldInventoryResponse(deviceId, status ?? "notStarted", generatedAt, scanStart, scanEnd, scannedThrough, progress, error, fields);
    }

    private async Task<ScanState?> ReadScanStateAsync(int deviceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select scan_start_at, scan_end_at, scanned_through from telemetry_field_inventory_cache_state where traccar_device_id=@deviceId", connection);
        command.Parameters.AddWithValue("deviceId", deviceId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new ScanState(ReadUtc(reader, 0), ReadUtc(reader, 1), ReadUtc(reader, 2));
    }

    private static DateTimeOffset? ReadUtc(NpgsqlDataReader reader, int ordinal)
    {
        if (reader.IsDBNull(ordinal)) return null;
        var value = reader.GetDateTime(ordinal);
        return new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc));
    }

    private static DateTimeOffset? ParseTimestamp(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String) return null;
        return DateTimeOffset.TryParse(value.GetString(), CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed) ? parsed : null;
    }

    private static string GetValueType(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => "string",
        JsonValueKind.Number => "number",
        JsonValueKind.True or JsonValueKind.False => "boolean",
        JsonValueKind.Object => "object",
        JsonValueKind.Array => "array",
        _ => "null",
    };

    private static string SafeErrorMessage(Exception exception) => exception switch
    {
        HttpRequestException => "The Vehicle App API could not reach Traccar. Check its API URL and network connection, then retry.",
        JsonException => "Traccar returned position data that could not be read. Retry the scan.",
        CredentialProtectionException => "The saved Traccar password could not be decrypted. Check the API credential encryption key.",
        _ => exception.Message.Length <= 500 ? exception.Message : exception.Message[..500],
    };

    private sealed record ScanState(DateTimeOffset? ScanStartUtc, DateTimeOffset? ScanEndUtc, DateTimeOffset? ScannedThroughUtc);

    private sealed class FieldAccumulator(string key)
    {
        private readonly HashSet<string> _types = new(StringComparer.Ordinal);
        public string Key { get; } = key;
        public long Count { get; private set; }
        public DateTimeOffset FirstSeenAt { get; private set; }
        public DateTimeOffset LastSeenAt { get; private set; }
        public IReadOnlyCollection<string> ValueTypes => _types;

        public void Observe(DateTimeOffset at, string type)
        {
            if (Count == 0) FirstSeenAt = LastSeenAt = at;
            else
            {
                if (at < FirstSeenAt) FirstSeenAt = at;
                if (at > LastSeenAt) LastSeenAt = at;
            }
            Count++;
            _types.Add(type);
        }

        public void Merge(FieldAccumulator other)
        {
            if (Count == 0) { FirstSeenAt = other.FirstSeenAt; LastSeenAt = other.LastSeenAt; }
            else { if (other.FirstSeenAt < FirstSeenAt) FirstSeenAt = other.FirstSeenAt; if (other.LastSeenAt > LastSeenAt) LastSeenAt = other.LastSeenAt; }
            Count += other.Count;
            _types.UnionWith(other._types);
        }
    }
}

public static class TelemetryFieldInventoryEndpoints
{
    private static readonly ConcurrentDictionary<string, DateTimeOffset> LastRetryByUserAndDevice = new(StringComparer.OrdinalIgnoreCase);
    private static readonly TimeSpan RetryThrottle = TimeSpan.FromMinutes(5);

    public static void MapTelemetryFieldInventoryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/telemetry-field-inventory/{deviceId:int}", async (
            int deviceId, TelemetryFieldInventoryService service, NpgsqlDataSource dataSource, VehicleAppAuthOptions options, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (deviceId <= 0) return Results.BadRequest("Traccar device id must be a positive integer.");
            if (!await VehicleAccess.CanReadDeviceAsync(deviceId, dataSource, options, context, cancellationToken)) return Results.NotFound();
            return Results.Ok(await service.GetAsync(deviceId, cancellationToken));
        })
        .WithName("GetTelemetryFieldInventory")
        .WithSummary("Returns field-only metadata from a server-side scan of a device's Traccar history.")
        .RequireAuthorization();

        app.MapPost("/api/telemetry-field-inventory/{deviceId:int}/retry", async (
            int deviceId, TelemetryFieldInventoryService service, NpgsqlDataSource dataSource, VehicleAppAuthOptions options, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (deviceId <= 0) return Results.BadRequest("Traccar device id must be a positive integer.");
            if (!await VehicleAccess.CanReadDeviceAsync(deviceId, dataSource, options, context, cancellationToken)) return Results.NotFound();
            var retryKey = $"{context.User.Identity?.Name ?? "anonymous"}:{deviceId}";
            var now = DateTimeOffset.UtcNow;
            if (LastRetryByUserAndDevice.TryGetValue(retryKey, out var previous) && now - previous < RetryThrottle)
                return Results.Problem(title: "Inventory retry is throttled", detail: "Wait five minutes before retrying this device's history scan.", statusCode: StatusCodes.Status429TooManyRequests);
            LastRetryByUserAndDevice[retryKey] = now;
            return Results.Ok(await service.RetryAsync(deviceId, cancellationToken));
        })
        .WithName("RetryTelemetryFieldInventoryScan")
        .WithSummary("Retries a failed or incomplete Traccar history scan for one device.")
        .RequireAuthorization();
    }
}

using System.Net.Http.Headers;
using System.Net;
using System.Text;
using System.Text.Json;

public sealed record TraccarDiagnosticsOptions(string? BaseUrl, string? Username, string? Password)
{
    public bool Configured => Uri.TryCreate(BaseUrl, UriKind.Absolute, out _) 
        && !string.IsNullOrWhiteSpace(Username)
        && !string.IsNullOrEmpty(Password);
}

public static class DeviceProtocolDiagnosticsEndpoints
{
    private const int MaxPositions = 2000;
    private static readonly string[] TelemetryKeys =
    [
        "rpm", "coolantTemp", "fuelUsed", "fuelConsumption", "batteryLevel", "ignition",
        "io", "battery", "power", "odometer", "tripOdometer", "hours", "distance", "totalDistance",
        "axisX", "axisY", "axisZ", "bleTemp1", "bleTemp2", "bleTemp3", "bleTemp4", "operator",
        "iccid", "fuel", "temperature"
    ];

    public static void MapDeviceProtocolDiagnosticsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/device-protocol-diagnostics/{deviceId:int}", CaptureAsync)
            .WithName("CaptureDeviceProtocolDiagnostics")
            .WithSummary("Captures Traccar version, device model, and decoded position attributes using the configured read-only Traccar account.");
    }

    private static async Task<IResult> CaptureAsync(
        int deviceId,
        DateTimeOffset fromUtc,
        DateTimeOffset throughUtc,
        TraccarDiagnosticsOptions options,
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (deviceId <= 0) return Results.BadRequest("deviceId must be a positive Traccar device ID.");
        if (throughUtc <= fromUtc) return Results.BadRequest("throughUtc must be later than fromUtc.");
        if (throughUtc - fromUtc > TimeSpan.FromDays(1)) return Results.BadRequest("The diagnostic window is limited to 24 hours.");
        if (!options.Configured)
            return Results.Problem(
                title: "Traccar diagnostics are not configured",
                detail: "Configure Traccar:BaseUrl, Traccar:Username, and Traccar:Password on the VehicleApp API server.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Vary = "Authorization";
        if (!IsAuthorized(context.Request)) return Results.Forbid();

        using var client = httpClientFactory.CreateClient(nameof(DeviceProtocolDiagnosticsEndpoints));
        client.BaseAddress = new Uri(options.BaseUrl!.TrimEnd('/') + "/");
        var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.Username}:{options.Password}"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        try
        {
            using var serverResponse = await client.GetAsync("api/server", cancellationToken);
            if (!serverResponse.IsSuccessStatusCode)
                return TraccarFailure(serverResponse.StatusCode, "Traccar server version lookup failed.");
            using var serverJson = await JsonDocument.ParseAsync(await serverResponse.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
            var version = serverJson.RootElement.TryGetProperty("version", out var versionElement) ? versionElement.GetString() : null;

            using var deviceResponse = await client.GetAsync($"api/devices/{deviceId}", cancellationToken);
            if (!deviceResponse.IsSuccessStatusCode)
                return TraccarFailure(deviceResponse.StatusCode, "Traccar device lookup failed.");
            using var deviceJson = await JsonDocument.ParseAsync(await deviceResponse.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
            var device = deviceJson.RootElement;
            var model = GetString(device, "model");
            var category = GetString(device, "category");

            var from = Uri.EscapeDataString(fromUtc.ToUniversalTime().ToString("O"));
            var through = Uri.EscapeDataString(throughUtc.ToUniversalTime().ToString("O"));
            using var positionsResponse = await client.GetAsync(
                $"api/positions?deviceId={deviceId}&from={from}&to={through}", cancellationToken);
            if (!positionsResponse.IsSuccessStatusCode)
                return TraccarFailure(positionsResponse.StatusCode, "Traccar position lookup failed.");
            using var positionsJson = await JsonDocument.ParseAsync(await positionsResponse.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
            if (positionsJson.RootElement.ValueKind != JsonValueKind.Array)
                return Results.Problem(title: "Unexpected Traccar response", detail: "The positions endpoint did not return an array.", statusCode: StatusCodes.Status502BadGateway);

            var positions = new List<object>();
            foreach (var position in positionsJson.RootElement.EnumerateArray().Take(MaxPositions + 1))
            {
                var attributes = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
                if (position.TryGetProperty("attributes", out var sourceAttributes)
                    && sourceAttributes.ValueKind == JsonValueKind.Object)
                {
                    foreach (var attribute in sourceAttributes.EnumerateObject())
                    {
                        if (IsTelemetryKey(attribute.Name)) attributes[attribute.Name] = attribute.Value.Clone();
                    }
                }

                positions.Add(new
                {
                    positionId = GetInt64(position, "id"),
                    fixTime = GetString(position, "fixTime"),
                    deviceTime = GetString(position, "deviceTime"),
                    valid = position.TryGetProperty("valid", out var valid) && valid.ValueKind == JsonValueKind.True,
                    attributes
                });
            }

            if (positions.Count > MaxPositions)
                return Results.Problem(title: "Diagnostic sample is too large", detail: "Narrow the requested time window so it contains no more than 2,000 positions.", statusCode: StatusCodes.Status413PayloadTooLarge);

            return Results.Ok(new
            {
                capturedAtUtc = DateTimeOffset.UtcNow,
                traccar = new { version },
                device = new { id = deviceId, model, category },
                requestedRangeUtc = new { from = fromUtc.ToUniversalTime(), through = throughUtc.ToUniversalTime() },
                positionCount = positions.Count,
                positions,
                evidenceLimits = new
                {
                    positionsAreDecoded = true,
                    originalTrackerPacketIncluded = false,
                    note = "Traccar positions expose decoded attributes only. Raw AVL packet provenance and the tracker's enabled AVL configuration must be collected separately."
                }
            });
        }
        catch (HttpRequestException)
        {
            return Results.Problem(title: "Traccar is unreachable", detail: "The VehicleApp API could not connect to the configured Traccar server.", statusCode: StatusCodes.Status502BadGateway);
        }
        catch (JsonException)
        {
            return Results.Problem(title: "Invalid Traccar response", detail: "Traccar returned data that could not be read as JSON.", statusCode: StatusCodes.Status502BadGateway);
        }
    }

    private static bool IsTelemetryKey(string key) =>
        key.StartsWith("io", StringComparison.OrdinalIgnoreCase)
        || TelemetryKeys.Contains(key, StringComparer.OrdinalIgnoreCase);

    private static string? GetString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static long? GetInt64(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.TryGetInt64(out var value) ? value : null;

    private static bool IsAuthorized(HttpRequest request)
    {
        var remoteIp = request.HttpContext.Connection.RemoteIpAddress;
        return remoteIp is not null
            && (IPAddress.IsLoopback(remoteIp)
                || (remoteIp.IsIPv4MappedToIPv6 && IPAddress.IsLoopback(remoteIp.MapToIPv4())));
    }

    private static IResult TraccarFailure(System.Net.HttpStatusCode status, string message) =>
        Results.Problem(title: message, detail: $"Traccar returned HTTP {(int)status}.", statusCode: StatusCodes.Status502BadGateway);
}

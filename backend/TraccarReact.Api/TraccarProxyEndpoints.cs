using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Npgsql;

public sealed record TraccarProxyOptions(string? ServerBaseUrl);

public static class TraccarProxyEndpoints
{
    private static readonly string[] ProxyMethods = ["GET"];

    public static void MapTraccarProxyEndpoints(this WebApplication app)
    {
        app.MapMethods("/api/traccar/{**path}", ProxyMethods, ForwardAsync)
            .RequireAuthorization();
    }

    private static async Task ForwardAsync(
        string? path,
        GlobalGeneralSettingsStore store,
        TraccarProxyOptions options,
        NpgsqlDataSource dataSource,
        TraccarReactApiAuthOptions authOptions,
        IHttpClientFactory clientFactory,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var normalizedPath = (path ?? string.Empty).Trim('/').ToLowerInvariant();
        if (normalizedPath is not ("server" or "devices" or "positions"))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        var readableDeviceIds = await VehicleAccess.GetReadableDeviceIdsAsync(dataSource, authOptions, context, cancellationToken);
        if (normalizedPath == "positions" && context.Request.Query.TryGetValue("deviceId", out var requestedDeviceIds))
        {
            var parsedIds = requestedDeviceIds.SelectMany(value => (value ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries))
                .Select(value => int.TryParse(value, out var id) ? id : 0).ToArray();
            if (parsedIds.Length == 0 || parsedIds.Any(id => id <= 0))
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            foreach (var id in parsedIds)
            {
                if (!await VehicleAccess.CanReadDeviceAsync(id, dataSource, authOptions, context, cancellationToken))
                {
                    context.Response.StatusCode = StatusCodes.Status404NotFound;
                    return;
                }
            }
        }

        GlobalGeneralSettings settings;
        try
        {
            settings = await store.GetAsync(cancellationToken);
        }
        catch (CredentialProtectionException)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new { title = "Traccar connection unavailable", detail = "The saved Traccar password cannot be decrypted. Check the API credential encryption key configuration." }, cancellationToken);
            return;
        }

        if (string.IsNullOrWhiteSpace(settings.Username) || string.IsNullOrEmpty(settings.Password))
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new { title = "Traccar connection not configured", detail = "An administrator must configure the shared Traccar username and password in General settings." }, cancellationToken);
            return;
        }

        if (!TryBuildTargetUri(settings.ApiBaseUrl, options.ServerBaseUrl, path, context.Request.QueryString, out var targetUri))
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new { title = "Traccar connection unavailable", detail = "The Traccar API base URL or API server target is invalid." }, cancellationToken);
            return;
        }

        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUri);
        var basicToken = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.Username}:{settings.Password}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", basicToken);
        if (context.Request.Headers.Accept.Count > 0)
            request.Headers.Accept.ParseAdd(string.Join(",", context.Request.Headers.Accept.ToArray()));
        if (context.Request.Headers.TryGetValue("If-None-Match", out var etag))
            request.Headers.TryAddWithoutValidation("If-None-Match", etag.ToArray());
        if (context.Request.Headers.TryGetValue("If-Modified-Since", out var modifiedSince))
            request.Headers.TryAddWithoutValidation("If-Modified-Since", modifiedSince.ToArray());

        if (context.Request.ContentLength is > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
        {
            request.Content = new StreamContent(context.Request.Body);
            if (MediaTypeHeaderValue.TryParse(context.Request.ContentType, out var contentType))
                request.Content.Headers.ContentType = contentType;
        }

        try
        {
            using var response = await clientFactory.CreateClient("TraccarProxy")
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            context.Response.StatusCode = (int)response.StatusCode;
            foreach (var header in response.Headers)
            {
                if (header.Key is "Transfer-Encoding" or "Connection" or "Keep-Alive" or "Upgrade" or "Set-Cookie" or "WWW-Authenticate") continue;
                context.Response.Headers[header.Key] = header.Value.ToArray();
            }
            foreach (var header in response.Content.Headers)
            {
                if (header.Key is "Transfer-Encoding" or "Connection" or "Keep-Alive" or "Upgrade") continue;
                context.Response.Headers[header.Key] = header.Value.ToArray();
            }
            context.Response.Headers.Remove("transfer-encoding");
            if (context.Response.StatusCode != StatusCodes.Status204NoContent && context.Response.StatusCode != StatusCodes.Status304NotModified && context.Request.Method != "HEAD")
            {
                var shouldFilter = readableDeviceIds is not null && (normalizedPath is "devices" or "positions") && response.Content.Headers.ContentType?.MediaType?.Contains("json", StringComparison.OrdinalIgnoreCase) == true;
                if (!shouldFilter)
                {
                    await response.Content.CopyToAsync(context.Response.Body, cancellationToken);
                }
                else
                {
                    var body = await response.Content.ReadAsStringAsync(cancellationToken);
                    var json = JsonNode.Parse(body);
                    if (json is JsonArray rows)
                    {
                        for (var index = rows.Count - 1; index >= 0; index--)
                        {
                            var row = rows[index];
                            var rawId = normalizedPath == "devices" ? row?["id"] : row?["deviceId"];
                            if (!int.TryParse(rawId?.ToString(), out var rowId) || !readableDeviceIds!.Contains(rowId)) rows.RemoveAt(index);
                        }
                    }
                    context.Response.Headers.Remove("content-length");
                    await context.Response.WriteAsJsonAsync(json, cancellationToken);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException)
        {
            context.Response.StatusCode = StatusCodes.Status502BadGateway;
            await context.Response.WriteAsJsonAsync(new { title = "Traccar server unavailable", detail = "Traccar React API could not reach the configured Traccar server." }, cancellationToken);
        }
    }

    private static bool TryBuildTargetUri(string apiBaseUrl, string? serverBaseUrl, string? path, QueryString query, out Uri target)
    {
        target = null!;
        var apiPath = apiBaseUrl.Trim();
        var escapedPath = string.Join("/", (path ?? string.Empty).Split('/', StringSplitOptions.RemoveEmptyEntries).Select(Uri.EscapeDataString));
        if (Uri.TryCreate(apiPath, UriKind.Absolute, out var absoluteApiBase))
        {
            if (absoluteApiBase.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(absoluteApiBase.UserInfo)) return false;
            target = new Uri($"{absoluteApiBase.ToString().TrimEnd('/')}/{escapedPath}{query}", UriKind.Absolute);
            return true;
        }

        if (string.IsNullOrWhiteSpace(serverBaseUrl) || !Uri.TryCreate(serverBaseUrl.TrimEnd('/'), UriKind.Absolute, out var serverBase)
            || serverBase.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(serverBase.UserInfo)) return false;
        if (!apiPath.StartsWith('/')) apiPath = "/" + apiPath;
        var targetBase = new Uri($"{serverBase.ToString().TrimEnd('/')}{apiPath.TrimEnd('/')}/", UriKind.Absolute);
        target = new Uri(targetBase, escapedPath + query);
        return true;
    }
}

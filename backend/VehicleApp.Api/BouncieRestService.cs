using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;
using Npgsql;

public sealed class BouncieRestService
{
    private static readonly Uri TokenUri = new("https://auth.bouncie.com/oauth/token");
    private static readonly Uri ApiBaseUri = new("https://api.bouncie.dev/v1/");
    private readonly object gate = new();
    private readonly NpgsqlDataSource dataSource;
    private readonly ILogger<BouncieRestService> logger;
    private readonly byte[]? encryptionKey;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(45) };
    private readonly SemaphoreSlim tokenRefreshGate = new(1, 1);
    private readonly ConcurrentDictionary<string, PendingBouncieAuthorization> pendingAuthorizations = new();
    private BouncieConnection? connection;
    private bool hasStoredCredentials;
    private BouncieSyncProgress progress = BouncieSyncProgress.Disconnected();
    private CancellationTokenSource? syncCancellation;

    public BouncieRestService(NpgsqlDataSource dataSource, ILogger<BouncieRestService> logger, IConfiguration configuration)
    {
        this.dataSource = dataSource;
        this.logger = logger;
        var encodedKey = configuration["VehicleApp:Bouncie:EncryptionKey"]
            ?? Environment.GetEnvironmentVariable("VEHICLE_APP_BOUNCIE_ENCRYPTION_KEY");
        if (!string.IsNullOrWhiteSpace(encodedKey))
        {
            try
            {
                var decoded = Convert.FromBase64String(encodedKey.Trim());
                if (decoded.Length == 32) encryptionKey = decoded;
            }
            catch (FormatException)
            {
                // The missing/invalid key is reported when a connection is attempted.
            }
        }
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (encryptionKey is null) return;
        try
        {
            var stored = await LoadStoredCredentialsAsync(cancellationToken);
            if (stored is null) return;
            lock (gate) hasStoredCredentials = true;
            var clientSecret = Unprotect(stored.ClientSecretCiphertext);
            var refreshToken = Unprotect(stored.RefreshTokenCiphertext);
            var restored = await RefreshConnectionAsync(stored.ClientId, clientSecret, refreshToken, stored.RedirectUri, cancellationToken);
            lock (gate)
            {
                connection = restored with { UserLabel = stored.UserLabel ?? restored.UserLabel };
                progress = BouncieSyncProgress.Connected(restored.Vehicles.Count);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Stored Bouncie credentials could not be restored; reconnect is required.");
            lock (gate) progress = BouncieSyncProgress.Disconnected("Stored Bouncie credentials could not be restored; reconnect in Settings.");
        }
    }

    public async Task<BouncieConnectionStatus> ConnectAsync(BouncieConnectRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.ClientId)
            || string.IsNullOrWhiteSpace(request.ClientSecret)
            || string.IsNullOrWhiteSpace(request.AuthorizationCode)
            || string.IsNullOrWhiteSpace(request.RedirectUri))
            throw new ArgumentException("Client ID, client secret, authorization code, and redirect URL are required.");
        EnsureEncryptionKey();

        using var tokenResponse = await http.PostAsJsonAsync(TokenUri, new
        {
            client_id = request.ClientId.Trim(),
            client_secret = request.ClientSecret,
            grant_type = "authorization_code",
            code = request.AuthorizationCode.Trim(),
            redirect_uri = request.RedirectUri.Trim()
        }, cancellationToken);
        if (!tokenResponse.IsSuccessStatusCode)
        {
            var detail = await ReadSafeErrorAsync(tokenResponse, cancellationToken);
            logger.LogWarning("Bouncie token exchange failed with HTTP {Status}: {Detail}", (int)tokenResponse.StatusCode, detail);
            throw new InvalidOperationException($"Bouncie token exchange failed with HTTP {(int)tokenResponse.StatusCode} {tokenResponse.ReasonPhrase}{FormatDetail(detail)}");
        }

        using var tokenJson = await tokenResponse.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Bouncie token exchange returned an empty response.");
        var accessToken = StringValue(tokenJson.RootElement, "access_token");
        var refreshToken = StringValue(tokenJson.RootElement, "refresh_token");
        var expiresIn = NumberValue(tokenJson.RootElement, "expires_in") ?? 3600;
        if (string.IsNullOrWhiteSpace(accessToken) || string.IsNullOrWhiteSpace(refreshToken))
            throw new InvalidOperationException("Bouncie token exchange did not return the required tokens.");

        var newConnection = new BouncieConnection(request.ClientId.Trim(), request.ClientSecret, refreshToken, accessToken, DateTimeOffset.UtcNow.AddSeconds(expiresIn), null, []);
        // Persist the refreshable credential immediately after a successful
        // exchange so a later user/vehicle lookup failure does not consume the
        // one-time authorization code without leaving a recoverable connection.
        await SaveStoredCredentialsAsync(newConnection, request.RedirectUri.Trim(), cancellationToken);
        var user = await GetJsonAsync(newConnection, "user", cancellationToken);
        var vehicles = ParseVehicles(await GetJsonAsync(newConnection, "vehicles", cancellationToken));
        newConnection = newConnection with { UserLabel = StringValue(user, "name", "email", "id"), Vehicles = vehicles };
        await SaveStoredCredentialsAsync(newConnection, request.RedirectUri.Trim(), cancellationToken);
        lock (gate)
        {
            connection = newConnection;
            progress = BouncieSyncProgress.Connected(vehicles.Count);
        }
        return GetStatus();
    }

    public BouncieConnectionStatus GetStatus()
    {
        lock (gate)
        {
            return new BouncieConnectionStatus(
                connection is not null,
                hasStoredCredentials,
                connection?.UserLabel,
                connection?.ExpiresAtUtc,
                connection?.Vehicles.Select(vehicle => new BouncieRemoteVehicleStatus(vehicle.Imei, vehicle.Vin, vehicle.DisplayName)).ToArray() ?? [],
                progress);
        }
    }

    public async Task<IReadOnlyList<BouncieBackfillCoverage>> GetBackfillCoverageAsync(DateTimeOffset? from, DateTimeOffset? through, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select vehicle_imei, count(*)::int, min(window_from), max(window_through), max(completed_at)
            from bouncie_import_checkpoints
            where (cast(@from as timestamptz) is null or window_through > cast(@from as timestamptz))
              and (cast(@through as timestamptz) is null or window_from < cast(@through as timestamptz))
            group by vehicle_imei
            order by vehicle_imei
            """, connection);
        command.Parameters.AddWithValue("from", (object?)from?.UtcDateTime ?? DBNull.Value);
        command.Parameters.AddWithValue("through", (object?)through?.UtcDateTime ?? DBNull.Value);
        var rows = new List<BouncieBackfillCoverage>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(new BouncieBackfillCoverage(reader.GetString(0), reader.GetInt32(1), reader.GetFieldValue<DateTimeOffset>(2), reader.GetFieldValue<DateTimeOffset>(3), reader.GetFieldValue<DateTimeOffset>(4)));
        return rows;
    }

    public BouncieAuthorizationStart BeginAuthorization(BouncieAuthorizationStartRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.ClientId)
            || string.IsNullOrWhiteSpace(request.ClientSecret)
            || string.IsNullOrWhiteSpace(request.RedirectUri))
            throw new ArgumentException("Client ID, client secret, and redirect URL are required.");

        if (!Uri.TryCreate(request.RedirectUri.Trim(), UriKind.Absolute, out var redirect)
            || !string.Equals(redirect.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(redirect.Host, "localhost", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(redirect.AbsolutePath, "/signin-bouncie", StringComparison.Ordinal))
            throw new ArgumentException("The redirect URL must be the registered local callback http://localhost:5124/signin-bouncie.");

        var state = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(10);
        pendingAuthorizations[state] = new PendingBouncieAuthorization(request.ClientId.Trim(), request.ClientSecret, request.RedirectUri.Trim(), expiresAt);
        var authorizationUrl = $"https://auth.bouncie.com/dialog/authorize?response_type=code&client_id={Uri.EscapeDataString(request.ClientId.Trim())}&redirect_uri={Uri.EscapeDataString(request.RedirectUri.Trim())}&state={Uri.EscapeDataString(state)}";
        return new BouncieAuthorizationStart(authorizationUrl, expiresAt);
    }

    public async Task<BouncieConnectionStatus> CompleteAuthorizationAsync(string state, string code, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(state) || !pendingAuthorizations.TryRemove(state, out var pending) || pending.ExpiresAtUtc <= DateTimeOffset.UtcNow)
            throw new InvalidOperationException("The Bouncie authorization session expired or is unknown. Start Connect again.");
        if (string.IsNullOrWhiteSpace(code)) throw new ArgumentException("Bouncie did not return an authorization code.");
        return await ConnectAsync(new BouncieConnectRequest(pending.ClientId, pending.ClientSecret, code.Trim(), pending.RedirectUri), cancellationToken);
    }

    public void RecordConnectionFailure(string message)
    {
        lock (gate)
            progress = BouncieSyncProgress.Failed(message);
    }

    public async Task<BouncieConnectionStatus> RestoreAsync(CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken);
        return GetStatus();
    }

    public Guid StartImport(BouncieImportRangeRequest request)
    {
        var from = request.From.ToUniversalTime();
        var through = request.Through.ToUniversalTime();
        if (from >= through) throw new ArgumentException("The Bouncie import start must be before the through date.");

        lock (gate)
        {
            if (connection is null) throw new InvalidOperationException("Connect to Bouncie before starting an import.");
            if (progress.State == "running") throw new InvalidOperationException("A Bouncie import is already running.");
            syncCancellation?.Dispose();
            syncCancellation = new CancellationTokenSource();
            var jobId = Guid.NewGuid();
            progress = BouncieSyncProgress.Started(jobId, from, through, connection.Vehicles.Count);
            var cancellation = syncCancellation;
            _ = Task.Run(() => RunImportAsync(jobId, from, through, cancellation.Token), CancellationToken.None);
            return jobId;
        }
    }

    public void CancelImport()
    {
        lock (gate) syncCancellation?.Cancel();
    }

    public async Task ForgetAsync(CancellationToken cancellationToken = default)
    {
        lock (gate)
        {
            syncCancellation?.Cancel();
            connection = null;
            hasStoredCredentials = false;
            progress = BouncieSyncProgress.Disconnected("Stored Bouncie connection forgotten.");
        }
        await using var databaseConnection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("delete from bouncie_credentials where id = 1", databaseConnection);
        await command.ExecuteNonQueryAsync(cancellationToken);
        lock (gate) hasStoredCredentials = true;
    }

    private void EnsureEncryptionKey()
    {
        if (encryptionKey is null)
            throw new InvalidOperationException("Bouncie credential encryption is not configured. Set VEHICLE_APP_BOUNCIE_ENCRYPTION_KEY to a base64-encoded 32-byte key before connecting.");
    }

    private static string FormatDetail(string? detail) => string.IsNullOrWhiteSpace(detail) ? "." : $" Bouncie response: {detail}.";

    private static async Task<string> ReadSafeErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(body)) return "no response body";
        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            foreach (var name in new[] { "error_description", "error", "message", "errors" })
            {
                if (!Property(root, name, out var value)) continue;
                var text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
                if (!string.IsNullOrWhiteSpace(text)) return text.Trim()[..Math.Min(400, text.Trim().Length)];
            }
        }
        catch (JsonException)
        {
            // Fall through to a bounded, whitespace-normalized diagnostic.
        }
        return "upstream returned an unstructured error response";
    }

    private async Task<BouncieConnection> RefreshConnectionAsync(string clientId, string clientSecret, string refreshToken, string redirectUri, CancellationToken cancellationToken)
    {
        using var response = await http.PostAsJsonAsync(TokenUri, new
        {
            client_id = clientId,
            client_secret = clientSecret,
            grant_type = "refresh_token",
            refresh_token = refreshToken,
            redirect_uri = redirectUri
        }, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var detail = await ReadSafeErrorAsync(response, cancellationToken);
            logger.LogWarning("Bouncie token refresh failed with HTTP {Status}: {Detail}", (int)response.StatusCode, detail);
            throw new InvalidOperationException($"Bouncie token refresh failed with HTTP {(int)response.StatusCode} {response.ReasonPhrase}{FormatDetail(detail)} Reconnect Bouncie in Settings to authorize a new refresh token.");
        }
        using var document = await response.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Bouncie token refresh returned an empty response.");
        var accessToken = StringValue(document.RootElement, "access_token");
        var rotatedRefreshToken = StringValue(document.RootElement, "refresh_token") ?? refreshToken;
        var expiresIn = NumberValue(document.RootElement, "expires_in") ?? 3600;
        if (string.IsNullOrWhiteSpace(accessToken)) throw new InvalidOperationException("Bouncie token refresh did not return an access token.");
        var restored = new BouncieConnection(clientId, clientSecret, rotatedRefreshToken, accessToken, DateTimeOffset.UtcNow.AddSeconds(expiresIn), null, []);
        var user = await GetJsonAsync(restored, "user", cancellationToken);
        var vehicles = ParseVehicles(await GetJsonAsync(restored, "vehicles", cancellationToken));
        var complete = restored with { UserLabel = StringValue(user, "name", "email", "id"), Vehicles = vehicles };
        if (!string.Equals(rotatedRefreshToken, refreshToken, StringComparison.Ordinal))
            await SaveStoredCredentialsAsync(complete, redirectUri, cancellationToken);
        return complete;
    }

    private async Task<StoredBouncieCredentials?> LoadStoredCredentialsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select client_id, client_secret_ciphertext, refresh_token_ciphertext, redirect_uri, user_label from bouncie_credentials where id = 1", connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new StoredBouncieCredentials(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetString(4));
    }

    private async Task SaveStoredCredentialsAsync(BouncieConnection value, string redirectUri, CancellationToken cancellationToken)
    {
        EnsureEncryptionKey();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            insert into bouncie_credentials (id, client_id, client_secret_ciphertext, refresh_token_ciphertext, redirect_uri, user_label, updated_at)
            values (1, @clientId, @clientSecret, @refreshToken, @redirectUri, @userLabel, now())
            on conflict (id) do update set
              client_id = excluded.client_id,
              client_secret_ciphertext = excluded.client_secret_ciphertext,
              refresh_token_ciphertext = excluded.refresh_token_ciphertext,
              redirect_uri = excluded.redirect_uri,
              user_label = excluded.user_label,
              updated_at = now()
            """, connection);
        command.Parameters.AddWithValue("clientId", value.ClientId);
        command.Parameters.AddWithValue("clientSecret", Protect(value.ClientSecret));
        command.Parameters.AddWithValue("refreshToken", Protect(value.RefreshToken));
        command.Parameters.AddWithValue("redirectUri", redirectUri);
        command.Parameters.AddWithValue("userLabel", (object?)value.UserLabel ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private string Protect(string plaintext)
    {
        EnsureEncryptionKey();
        var plaintextBytes = Encoding.UTF8.GetBytes(plaintext);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var tag = new byte[16];
        var ciphertext = new byte[plaintextBytes.Length];
        using var aes = new AesGcm(encryptionKey!, 16);
        aes.Encrypt(nonce, plaintextBytes, ciphertext, tag);
        CryptographicOperations.ZeroMemory(plaintextBytes);
        var envelope = new byte[1 + nonce.Length + tag.Length + ciphertext.Length];
        envelope[0] = 1;
        Buffer.BlockCopy(nonce, 0, envelope, 1, nonce.Length);
        Buffer.BlockCopy(tag, 0, envelope, 1 + nonce.Length, tag.Length);
        Buffer.BlockCopy(ciphertext, 0, envelope, 1 + nonce.Length + tag.Length, ciphertext.Length);
        CryptographicOperations.ZeroMemory(ciphertext);
        return Convert.ToBase64String(envelope);
    }

    private string Unprotect(string encoded)
    {
        EnsureEncryptionKey();
        var envelope = Convert.FromBase64String(encoded);
        if (envelope.Length < 29 || envelope[0] != 1) throw new InvalidOperationException("Stored Bouncie credential encryption envelope is invalid.");
        var nonce = envelope.AsSpan(1, 12).ToArray();
        var tag = envelope.AsSpan(13, 16).ToArray();
        var ciphertext = envelope.AsSpan(29).ToArray();
        var plaintext = new byte[ciphertext.Length];
        using var aes = new AesGcm(encryptionKey!, 16);
        aes.Decrypt(nonce, ciphertext, tag, plaintext);
        var value = Encoding.UTF8.GetString(plaintext);
        CryptographicOperations.ZeroMemory(plaintext);
        CryptographicOperations.ZeroMemory(ciphertext);
        return value;
    }

    private async Task RunImportAsync(Guid jobId, DateTimeOffset from, DateTimeOffset through, CancellationToken cancellationToken)
    {
        try
        {
            var catalog = await LoadCatalogVehiclesAsync(cancellationToken);
            BouncieConnection active;
            lock (gate) active = connection ?? throw new InvalidOperationException("Bouncie connection is no longer available.");
            var windows = SplitWindows(from, through).ToArray();
            SetProgress(jobId, state: "running", message: "Preparing the rate-limited Bouncie import.", totalWindows: windows.Length * active.Vehicles.Count);

            foreach (var remote in active.Vehicles)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var target = FindCatalogVehicle(remote, catalog);
                if (target is null)
                {
                    SetProgress(
                        jobId,
                        unmatched: 1,
                        unmatchedVehicle: new BouncieUnmatchedVehicle(
                            remote.Imei,
                            remote.Vin,
                            remote.DisplayName,
                            remote.Make,
                            remote.Model,
                            remote.Year,
                            "No active Vehicle Catalog record matched VIN or make/model/year."),
                        message: $"No catalog vehicle matched Bouncie vehicle {remote.DisplayName ?? remote.Imei}; its data was not imported.");
                    continue;
                }

                foreach (var window in windows)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (await IsWindowCompletedAsync(remote.Imei, window.From, window.Through, cancellationToken))
                    {
                        SetProgress(jobId, completedWindows: 1, message: $"Skipped completed window for {remote.DisplayName ?? remote.Imei}: {window.From:yyyy-MM-dd} through {window.Through.AddTicks(-1):yyyy-MM-dd}.");
                        continue;
                    }
                    var endpoint = BuildTripsPath(remote.Imei, window.From, window.Through);
                    JsonElement payload;
                    try
                    {
                        payload = await GetJsonWithRetryAsync(active, endpoint, cancellationToken);
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "Bouncie window failed for {Vehicle} {From:o}..{Through:o}; continuing with later windows.", remote.DisplayName ?? remote.Imei, window.From, window.Through);
                        SetProgress(jobId, completedWindows: 1, failedWindows: 1, message: $"Window failed for {remote.DisplayName ?? remote.Imei}: {ex.Message}");
                        continue;
                    }
                    var rows = ParseTripRows(payload, remote, target, window.From, window.Through);
                    logger.LogInformation("Bouncie trips response for {Vehicle}: {PayloadShape}; {ParsedCount} trip row(s) remained inside the requested window.", remote.DisplayName ?? remote.Imei, DescribePayload(payload), rows.Count);
                    if (rows.Count > 0)
                    {
                        var first = rows.Min(row => row.StartedAt);
                        var last = rows.Max(row => row.StartedAt);
                        logger.LogInformation("Bouncie returned {Count} trips for {Vehicle} in requested window {From:o}..{Through:o}; parsed start range {First:o}..{Last:o}.", rows.Count, remote.DisplayName ?? remote.Imei, window.From, window.Through, first, last);
                    }
                    else
                    {
                        logger.LogInformation("Bouncie returned no trips for {Vehicle} in requested window {From:o}..{Through:o}.", remote.DisplayName ?? remote.Imei, window.From, window.Through);
                    }
                    if (rows.Count > 0)
                    {
                        BouncieImportResult result;
                        try
                        {
                            result = await BouncieImportEndpoints.ImportRowsAsync(rows, dataSource, cancellationToken);
                        }
                        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                        {
                            throw;
                        }
                        catch (Exception ex)
                        {
                            logger.LogWarning(ex, "Bouncie persistence failed for {Vehicle} {From:o}..{Through:o}; continuing with later windows.", remote.DisplayName ?? remote.Imei, window.From, window.Through);
                            SetProgress(jobId, completedWindows: 1, failedWindows: 1, message: $"Window persistence failed for {remote.DisplayName ?? remote.Imei}: {ex.Message}");
                            continue;
                        }
                        await MarkWindowCompletedAsync(remote.Imei, window.From, window.Through, result, cancellationToken);
                        SetProgress(jobId, imported: result.Imported, skipped: result.Skipped, importedEvents: result.ImportedEvents, message: $"Imported {remote.DisplayName ?? remote.Imei}: {rows.Count} trip(s) in {window.From:yyyy-MM-dd} through {window.Through.AddTicks(-1):yyyy-MM-dd}.");
                    }
                    else
                    {
                        await MarkWindowCompletedAsync(remote.Imei, window.From, window.Through, new BouncieImportResult(0, 0, 0), cancellationToken);
                        SetProgress(jobId, message: $"No trips returned for {remote.DisplayName ?? remote.Imei} through {window.Through:yyyy-MM-dd}.");
                    }

                    SetProgress(jobId, completedWindows: 1);
                    // Keep requests deliberately sparse. Bouncie trip windows are
                    // limited to one week, so a year is roughly 53 sequential calls.
                    await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
                }
            }

            int failedWindows;
            lock (gate) failedWindows = progress.JobId == jobId ? progress.FailedWindows : 0;
            SetProgress(
                jobId,
                state: "completed",
                message: failedWindows > 0
                    ? $"Bouncie import completed with {failedWindows} failed window(s); rerun the same range to retry them."
                    : "Bouncie import completed.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            SetProgress(jobId, state: "canceled", message: "Bouncie import canceled; completed batches were preserved.");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Bouncie REST import failed for job {JobId}", jobId);
            SetProgress(jobId, state: "failed", message: ex.Message);
        }
    }

    private async Task<JsonElement> GetJsonAsync(BouncieConnection current, string endpoint, CancellationToken cancellationToken)
    {
        var token = await EnsureAccessTokenAsync(current, cancellationToken);
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(ApiBaseUri, endpoint));
        // Bouncie's API expects the access token as the complete Authorization
        // header value (the docs do not use a Bearer prefix).
        request.Headers.TryAddWithoutValidation("Authorization", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var detail = await ReadSafeErrorAsync(response, cancellationToken);
            logger.LogWarning("Bouncie API request {Endpoint} failed with HTTP {Status}: {Detail}", endpoint, (int)response.StatusCode, detail);
            throw new InvalidOperationException($"Bouncie API request failed for {endpoint}: HTTP {(int)response.StatusCode} {response.ReasonPhrase}{FormatDetail(detail)}");
        }
        using var document = await response.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException($"Bouncie API returned an empty response for {endpoint}.");
        return document.RootElement.Clone();
    }

    private async Task<JsonElement> GetJsonWithRetryAsync(BouncieConnection current, string endpoint, CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await GetJsonAsync(current, endpoint, cancellationToken);
            }
            catch (InvalidOperationException ex) when (attempt < 2 && (ex.Message.Contains("HTTP 429", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("HTTP 5", StringComparison.OrdinalIgnoreCase)))
            {
                var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt + 1));
                logger.LogWarning("Retrying Bouncie request {Endpoint} after transient failure (attempt {Attempt}/3).", endpoint, attempt + 1);
                await Task.Delay(delay, cancellationToken);
            }
        }
    }

    private async Task<bool> IsWindowCompletedAsync(string vehicleImei, DateTimeOffset from, DateTimeOffset through, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select exists (select 1 from bouncie_import_checkpoints where vehicle_imei = @imei and window_from = @from and window_through = @through)", connection);
        command.Parameters.AddWithValue("imei", vehicleImei);
        command.Parameters.AddWithValue("from", from.UtcDateTime);
        command.Parameters.AddWithValue("through", through.UtcDateTime);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    private async Task MarkWindowCompletedAsync(string vehicleImei, DateTimeOffset from, DateTimeOffset through, BouncieImportResult result, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            insert into bouncie_import_checkpoints (vehicle_imei, window_from, window_through, completed_at, imported_count, skipped_count, imported_events)
            values (@imei, @from, @through, now(), @imported, @skipped, @events)
            on conflict (vehicle_imei, window_from, window_through) do update set
              completed_at = excluded.completed_at,
              imported_count = excluded.imported_count,
              skipped_count = excluded.skipped_count,
              imported_events = excluded.imported_events
            """, connection);
        command.Parameters.AddWithValue("imei", vehicleImei);
        command.Parameters.AddWithValue("from", from.UtcDateTime);
        command.Parameters.AddWithValue("through", through.UtcDateTime);
        command.Parameters.AddWithValue("imported", result.Imported);
        command.Parameters.AddWithValue("skipped", result.Skipped);
        command.Parameters.AddWithValue("events", result.ImportedEvents);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<string> EnsureAccessTokenAsync(BouncieConnection current, CancellationToken cancellationToken)
    {
        if (current.ExpiresAtUtc > DateTimeOffset.UtcNow.AddMinutes(1)) return current.AccessToken;
        await tokenRefreshGate.WaitAsync(cancellationToken);
        try
        {
            BouncieConnection latest;
            lock (gate) latest = connection ?? current;
            if (latest.ExpiresAtUtc > DateTimeOffset.UtcNow.AddMinutes(1)) return latest.AccessToken;
            var stored = await LoadStoredCredentialsAsync(cancellationToken)
                ?? throw new InvalidOperationException("No stored Bouncie credentials are available; reconnect in Settings.");
            var updated = await RefreshConnectionAsync(
                latest.ClientId,
                latest.ClientSecret,
                latest.RefreshToken,
                stored.RedirectUri,
                cancellationToken);
            lock (gate) connection = updated;
            return updated.AccessToken;
        }
        finally
        {
            tokenRefreshGate.Release();
        }
    }

    private async Task<List<CatalogVehicle>> LoadCatalogVehiclesAsync(CancellationToken cancellationToken)
    {
        var result = new List<CatalogVehicle>();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select v.id, v.vin, v.year, v.make, v.model,
                   (select b.traccar_device_id
                    from vehicle_device_bindings b
                    where b.vehicle_id = v.id
                      and b.starts_at <= now()
                      and (b.ends_at is null or b.ends_at > now())
                    order by b.starts_at desc
                    limit 1) as traccar_device_id
            from vehicles v
            where v.active
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            result.Add(new CatalogVehicle(reader.GetGuid(0), reader.IsDBNull(1) ? null : reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetInt32(2), reader.IsDBNull(3) ? null : reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetInt32(5)));
        return result;
    }

    private void SetProgress(Guid jobId, string? state = null, string? message = null, int? totalWindows = null, int? completedWindows = null, int? failedWindows = null, int? imported = null, int? skipped = null, int? importedEvents = null, int? unmatched = null, BouncieUnmatchedVehicle? unmatchedVehicle = null)
    {
        lock (gate)
        {
            if (progress.JobId != jobId) return;
            progress = progress with
            {
                State = state ?? progress.State,
                Message = message ?? progress.Message,
                TotalWindows = totalWindows ?? progress.TotalWindows,
                CompletedWindows = progress.CompletedWindows + (completedWindows ?? 0),
                FailedWindows = progress.FailedWindows + (failedWindows ?? 0),
                Imported = progress.Imported + (imported ?? 0),
                Skipped = progress.Skipped + (skipped ?? 0),
                ImportedEvents = progress.ImportedEvents + (importedEvents ?? 0),
                UnmatchedVehicles = progress.UnmatchedVehicles + (unmatched ?? 0),
                UnmatchedVehicleDetails = unmatchedVehicle is null ? progress.UnmatchedVehicleDetails : progress.UnmatchedVehicleDetails.Append(unmatchedVehicle).ToArray(),
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };
        }
    }

    private static IEnumerable<(DateTimeOffset From, DateTimeOffset Through)> SplitWindows(DateTimeOffset from, DateTimeOffset through)
    {
        for (var cursor = from; cursor < through;)
        {
            var next = cursor.AddDays(7);
            if (next > through) next = through;
            yield return (cursor, next);
            cursor = next;
        }
    }

    private static string BuildTripsPath(string imei, DateTimeOffset from, DateTimeOffset through)
    {
        static string ApiTime(DateTimeOffset value) => Uri.EscapeDataString(value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
        return $"trips?imei={Uri.EscapeDataString(imei)}&includeGps=true&gpsFormat=geojson&startsAfter={ApiTime(from)}&endsBefore={ApiTime(through)}";
    }

    private static CatalogVehicle? FindCatalogVehicle(BouncieRemoteVehicle remote, IReadOnlyList<CatalogVehicle> catalog)
        => catalog.FirstOrDefault(vehicle => !string.IsNullOrWhiteSpace(remote.Vin) && NormalizeIdentity(vehicle.Vin) == NormalizeIdentity(remote.Vin))
           ?? catalog.FirstOrDefault(vehicle => vehicle.Year == remote.Year && Same(vehicle.Make, remote.Make) && Same(vehicle.Model, remote.Model));

    private static bool Same(string? left, string? right) => !string.IsNullOrWhiteSpace(left) && !string.IsNullOrWhiteSpace(right) && NormalizeIdentity(left) == NormalizeIdentity(right);
    private static string NormalizeIdentity(string? value) => string.Concat((value ?? string.Empty).Where(char.IsLetterOrDigit)).ToUpperInvariant();

    private static List<BouncieRemoteVehicle> ParseVehicles(JsonElement root)
        => ArrayElements(root, "vehicles", "data", "results").Select(element => new BouncieRemoteVehicle(StringValue(element, "imei", "deviceImei", "id") ?? "", StringValue(element, "vin"), StringValue(element, "name", "nickname", "displayName"), StringValue(element, "make"), StringValue(element, "model"), IntValue(element, "year"))).Where(vehicle => vehicle.Imei.Length > 0).ToList();

    private static string DescribePayload(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array) return $"array[{root.GetArrayLength()}]";
        if (root.ValueKind != JsonValueKind.Object) return root.ValueKind.ToString();
        var properties = root.EnumerateObject().Select(property => property.Value.ValueKind == JsonValueKind.Array ? $"{property.Name}[{property.Value.GetArrayLength()}]" : property.Name);
        return string.Join(", ", properties.Take(12));
    }

    private static List<BouncieImportRow> ParseTripRows(JsonElement root, BouncieRemoteVehicle remote, CatalogVehicle target, DateTimeOffset from, DateTimeOffset through)
    {
        var rows = new List<BouncieImportRow>();
        foreach (var trip in ArrayElements(root, "trips", "data", "results", "tripData"))
        {
            var started = DateValue(trip, "startedAt", "startTime", "startDateTime", "tripStart", "started", "start");
            var ended = DateValue(trip, "endedAt", "endTime", "endDateTime", "tripEnd", "ended", "end");
            if (!started.HasValue || !ended.HasValue || ended <= started) continue;
            if (started.Value < from || started.Value >= through) continue;
            var coordinates = ExtractCoordinates(trip);
            var start = ReadLocation(trip, "startLocation", "start", "origin") ?? coordinates.FirstOrDefault();
            var end = ReadLocation(trip, "endLocation", "end", "destination") ?? coordinates.LastOrDefault();
            var distance = NumberValue(trip, "distanceMiles", "miles", "distanceDriven", "distance") ?? 0;
            var distanceMeters = NumberValue(trip, "distanceMeters") ?? (distance * 1609.344);
            var maxSpeed = NumberValue(trip, "maxSpeedMph", "maximumSpeed", "maxSpeed") ?? NumberValue(trip, "metrics", "maxSpeedMph", "maxSpeed");
            var average = NumberValue(trip, "averageSpeedMph", "avgSpeedMph", "averageSpeed") ?? NumberValue(trip, "metrics", "averageSpeedMph", "averageSpeed");
            var sourceEvents = ParseEvents(trip, started.Value, start, maxSpeed);
            var ignition = NullableBooleanValue(trip, "ignition", "ignitionOn", "engineOn");
            var hasSourceEvent = ArrayElements(trip, "events", "tripEvents", "alerts").Any()
                || new[] { "hardBraking", "hardBrake", "rapidAcceleration", "hardAcceleration" }.Any(name => BooleanValue(trip, name));
            var hasMotionEvidence = hasSourceEvent || (maxSpeed.HasValue && maxSpeed.Value > 5);
            // GPS drift while parked can be reported as a long, tiny trip. Keep
            // short movement when there is meaningful speed or an event (such
            // as towing/theft), but discard explicit ignition-off drift.
            if (!hasMotionEvidence && distanceMeters < 400 && (ignition == false || (ignition is null && maxSpeed.GetValueOrDefault() <= 3)))
                continue;
            var startOdometer = NumberValue(trip, "startOdometer", "odometerStart");
            var endOdometer = NumberValue(trip, "endOdometer", "odometerEnd");
            var key = StringValue(trip, "transactionId", "tripId", "id") ?? string.Join('|', remote.Vin ?? remote.Imei, started.Value.ToString("O"), ended.Value.ToString("O"), startOdometer?.ToString(CultureInfo.InvariantCulture) ?? "", endOdometer?.ToString(CultureInfo.InvariantCulture) ?? "");
            var routePoints = coordinates.Select((coordinate, index) => new BouncieRoutePoint(index, null, coordinate.Latitude, coordinate.Longitude, null, null)).ToList();
            rows.Add(new BouncieImportRow(target.Id, target.TraccarDeviceId, key, started.Value, ended.Value, Math.Max(1, (int)Math.Round((ended.Value - started.Value).TotalSeconds)), distanceMeters / 1609.344, average, maxSpeed, NumberValue(trip, "fuelUsedGallons", "fuelUsed"), NumberValue(trip, "fuelEconomyMpg", "estimatedMpg", "mpg"), start?.Latitude, start?.Longitude, end?.Latitude, end?.Longitude, StringValue(trip, "startAddress", "originAddress"), StringValue(trip, "endAddress", "destinationAddress"), new Dictionary<string, string?> { ["source"] = "bouncie-rest-v1", ["rawPayload"] = trip.GetRawText() }, sourceEvents, routePoints));
        }
        return rows;
    }

    private static List<BouncieImportEvent> ParseEvents(JsonElement trip, DateTimeOffset started, Coordinate? fallback, double? maxSpeed)
    {
        var events = new List<BouncieImportEvent>();
        foreach (var item in ArrayElements(trip, "events", "tripEvents", "alerts"))
        {
            var type = NormalizeEventType(StringValue(item, "eventType", "type", "name", "event"));
            if (type is null) continue;
            events.Add(new BouncieImportEvent(type, DateValue(item, "occurredAt", "timestamp", "time") ?? started, ReadLocation(item, "location", "position")?.Latitude ?? fallback?.Latitude, ReadLocation(item, "location", "position")?.Longitude ?? fallback?.Longitude, NumberValue(item, "measuredValue", "value", "speed", "magnitude"), StringValue(item, "unit", "units"), new Dictionary<string, object?> { ["raw"] = item.GetRawText() }));
        }
        if (events.Count == 0)
        {
            foreach (var (name, type) in new[] { ("hardBraking", "hard_braking"), ("hard_brake", "hard_braking"), ("rapidAcceleration", "hard_acceleration"), ("hardAcceleration", "hard_acceleration") })
                if (BooleanValue(trip, name)) events.Add(new BouncieImportEvent(type, started, fallback?.Latitude, fallback?.Longitude, null, null, new Dictionary<string, object?> { ["source"] = name }));
        }
        if (maxSpeed.HasValue && !events.Any(item => item.EventType == "maximum_speed")) events.Add(new BouncieImportEvent("maximum_speed", started, fallback?.Latitude, fallback?.Longitude, maxSpeed, "mph", new Dictionary<string, object?> { ["source"] = "maxSpeed" }));
        return events;
    }

    private static string? NormalizeEventType(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var token = value.Trim().ToLowerInvariant().Replace(' ', '_').Replace('-', '_');
        if (token.Contains("brak")) return "hard_braking";
        if (token.Contains("accel")) return "hard_acceleration";
        if (token.Contains("speed")) return "maximum_speed";
        if (token.Contains("idle")) return "long_idle";
        return token.StartsWith("bouncie_", StringComparison.Ordinal) ? token : $"bouncie_{token}";
    }

    private static List<Coordinate> ExtractCoordinates(JsonElement element)
    {
        var output = new List<Coordinate>();
        WalkCoordinates(element, output);
        return output;
    }

    private static void WalkCoordinates(JsonElement element, List<Coordinate> output)
    {
        if (element.ValueKind == JsonValueKind.Object)
            foreach (var property in element.EnumerateObject()) WalkCoordinates(property.Value, output);
        else if (element.ValueKind == JsonValueKind.Array)
        {
            var values = element.EnumerateArray().ToArray();
            if (values.Length >= 2 && values[0].ValueKind == JsonValueKind.Number && values[1].ValueKind == JsonValueKind.Number && values[0].TryGetDouble(out var longitude) && values[1].TryGetDouble(out var latitude) && Math.Abs(latitude) <= 90 && Math.Abs(longitude) <= 180)
                output.Add(new Coordinate(latitude, longitude));
            else foreach (var value in values) WalkCoordinates(value, output);
        }
    }

    private static Coordinate? ReadLocation(JsonElement element, params string[] names)
    {
        foreach (var name in names)
            if (Property(element, name, out var location))
            {
                var latitude = NumberValue(location, "latitude", "lat");
                var longitude = NumberValue(location, "longitude", "lng", "lon");
                if (latitude.HasValue && longitude.HasValue) return new Coordinate(latitude.Value, longitude.Value);
                var coordinates = ExtractCoordinates(location);
                if (coordinates.Count > 0) return coordinates[0];
            }
        return null;
    }

    private static IEnumerable<JsonElement> ArrayElements(JsonElement root, params string[] names)
    {
        if (root.ValueKind == JsonValueKind.Array) return root.EnumerateArray().ToArray();
        foreach (var name in names) if (Property(root, name, out var value) && value.ValueKind == JsonValueKind.Array) return value.EnumerateArray().ToArray();
        return [];
    }

    private static bool Property(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object) foreach (var property in element.EnumerateObject()) if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase)) { value = property.Value; return true; }
        value = default; return false;
    }

    private static string? StringValue(JsonElement element, params string[] names)
    {
        foreach (var name in names) if (Property(element, name, out var value)) return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
        return null;
    }

    private static double? NumberValue(JsonElement element, params string[] names)
    {
        if (names.Length > 1 && Property(element, names[0], out var nested)) return NumberValue(nested, names[1..]);
        foreach (var name in names) if (Property(element, name, out var value)) { if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) return number; if (double.TryParse(value.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number)) return number; }
        return null;
    }

    private static int? IntValue(JsonElement element, params string[] names) => NumberValue(element, names) is double value ? (int)Math.Round(value) : null;
    private static bool BooleanValue(JsonElement element, string name) => Property(element, name, out var value) && ((value.ValueKind == JsonValueKind.True) || (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var result) && result));

    private static bool? NullableBooleanValue(JsonElement element, params string[] names)
    {
        foreach (var name in names)
            if (Property(element, name, out var value))
            {
                if (value.ValueKind == JsonValueKind.True) return true;
                if (value.ValueKind == JsonValueKind.False) return false;
                if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed)) return parsed;
                if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number != 0;
            }
        return null;
    }
    private static DateTimeOffset? DateValue(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (!Property(element, name, out var value)) continue;
            if (value.ValueKind == JsonValueKind.Object)
            {
                var nested = DateValue(value, "timestamp", "dateTime", "datetime", "date", "time", "at");
                if (nested.HasValue) return nested;
                continue;
            }
            var text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            if (DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed)) return parsed;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var epoch))
            {
                try { return DateTimeOffset.FromUnixTimeMilliseconds(epoch).ToUniversalTime(); }
                catch (ArgumentOutOfRangeException) { }
            }
        }
        return null;
    }

    private sealed record BouncieConnection(
        string ClientId,
        string ClientSecret,
        string RefreshToken,
        string AccessToken,
        DateTimeOffset ExpiresAtUtc,
        string? UserLabel,
        IReadOnlyList<BouncieRemoteVehicle> Vehicles);
    private sealed record StoredBouncieCredentials(string ClientId, string ClientSecretCiphertext, string RefreshTokenCiphertext, string RedirectUri, string? UserLabel);
    private sealed record BouncieRemoteVehicle(string Imei, string? Vin, string? DisplayName, string? Make, string? Model, int? Year);
    private sealed record PendingBouncieAuthorization(string ClientId, string ClientSecret, string RedirectUri, DateTimeOffset ExpiresAtUtc);
    private sealed record CatalogVehicle(Guid Id, string? Vin, int? Year, string? Make, string? Model, int? TraccarDeviceId);
    private sealed record Coordinate(double Latitude, double Longitude);
}

public sealed record BouncieConnectRequest(string ClientId, string ClientSecret, string AuthorizationCode, string RedirectUri);
public sealed record BouncieAuthorizationStartRequest(string ClientId, string ClientSecret, string RedirectUri);
public sealed record BouncieAuthorizationStart(string AuthorizationUrl, DateTimeOffset ExpiresAtUtc);
public sealed record BouncieBackfillCoverage(string VehicleImei, int CompletedWindows, DateTimeOffset FirstWindowFrom, DateTimeOffset LastWindowThrough, DateTimeOffset LastCompletedAt);
public sealed record BouncieImportRangeRequest(DateTimeOffset From, DateTimeOffset Through);
public sealed record BouncieRemoteVehicleStatus(string Imei, string? Vin, string? DisplayName);
public sealed record BouncieUnmatchedVehicle(string Imei, string? Vin, string? DisplayName, string? Make, string? Model, int? Year, string Reason);
public sealed record BouncieConnectionStatus(bool Connected, bool StoredCredentials, string? UserLabel, DateTimeOffset? TokenExpiresAtUtc, IReadOnlyList<BouncieRemoteVehicleStatus> Vehicles, BouncieSyncProgress Import);
public sealed record BouncieSyncProgress(Guid? JobId, string State, string Message, DateTimeOffset UpdatedAtUtc, DateTimeOffset? From, DateTimeOffset? Through, int TotalWindows, int CompletedWindows, int FailedWindows, int Imported, int Skipped, int ImportedEvents, int UnmatchedVehicles)
{
    public IReadOnlyList<BouncieUnmatchedVehicle> UnmatchedVehicleDetails { get; init; } = [];
    public static BouncieSyncProgress Disconnected() => new(null, "disconnected", "Not connected to Bouncie.", DateTimeOffset.UtcNow, null, null, 0, 0, 0, 0, 0, 0, 0);
    public static BouncieSyncProgress Disconnected(string message) => new(null, "disconnected", message, DateTimeOffset.UtcNow, null, null, 0, 0, 0, 0, 0, 0, 0);
    public static BouncieSyncProgress Connected(int vehicles) => new(null, "connected", $"Connected to Bouncie ({vehicles} vehicle(s)).", DateTimeOffset.UtcNow, null, null, 0, 0, 0, 0, 0, 0, 0);
    public static BouncieSyncProgress Failed(string message) => new(null, "failed", message, DateTimeOffset.UtcNow, null, null, 0, 0, 0, 0, 0, 0, 0);
    public static BouncieSyncProgress Started(Guid id, DateTimeOffset from, DateTimeOffset through, int vehicles) => new(id, "running", "Preparing import.", DateTimeOffset.UtcNow, from, through, 0, 0, 0, 0, 0, 0, 0);
}

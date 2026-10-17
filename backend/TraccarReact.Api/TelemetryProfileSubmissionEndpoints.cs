using System.IO.Compression;
using System.Net.Mail;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

public static class TelemetryProfileSubmissionEndpoints
{
    private const string SupportAddress = "support@rvthinker.com";
    private const int MaximumDateRangeDays = 14;
    private const int MaximumTrackingPoints = 100_000;
    private const int MaximumExcludedFieldPaths = 20_000;
    private const long MaximumSubmissionBodyBytes = 100_000_000;
    private const int GraphSimpleAttachmentLimitBytes = 2_900_000;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private static readonly string[] IdentifierKeyParts =
    [
        "vin", "vehicleidentificationnumber", "mac", "imei", "imsi", "iccid", "serialnumber", "serial",
        "deviceid", "devicename", "deviceuniqueid", "vehicleid", "vehiclename",
        "trackerid", "trackername", "uniqueid", "hardwareid", "driverid",
        "drivername", "licenseplate", "platenumber", "registration", "userid", "tripid", "triptag", "tagname",
        "identifier", "phone", "email", "username", "accountid", "password",
        "secret", "token",
    ];
    private static readonly HashSet<string> LocationKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "latitude", "longitude", "lat", "lon", "lng", "gps", "location",
        "address", "geofence", "network", "coordinate", "coordinates",
    };
    private static readonly HashSet<string> RootCoordinateKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "latitude", "longitude", "lat", "lon", "lng",
    };

    public static void MapTelemetryProfileSubmissionEndpoints(this WebApplication app)
    {
        app.MapGet("/api/telemetry-profile-submissions/status", async (
            EmailDeliveryService email,
            NpgsqlDataSource dataSource,
            HttpContext context,
            CancellationToken cancellationToken) =>
        {
            var status = await email.GetStatusAsync(cancellationToken);
            var missing = status.MissingSettings.ToList();
            var sender = status.Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase)
                ? await GetDefaultSenderAsync(dataSource, cancellationToken)
                : null;
            if (status.Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(sender))
                missing.Add("Graph sender mailbox (Settings > Email Alerts)");

            var contact = await GetUserContactAsync(dataSource, context.User.Identity?.Name, cancellationToken);
            return Results.Ok(new
            {
                ready = status.Ready && missing.Count == 0,
                provider = status.Provider,
                missingSettings = missing,
                supportsSelectableTelemetryFields = true,
                recipient = SupportAddress,
                contactName = contact?.Name,
                contactEmail = contact?.Email,
            });
        }).RequireAuthorization();

        app.MapPost("/api/telemetry-profile-submissions/archive", async (
            TelemetryProfileSubmissionRequest request,
            NpgsqlDataSource dataSource,
            HttpContext context,
            CancellationToken cancellationToken) =>
        {
            var error = ValidateRequest(request);
            if (error is not null) return Results.BadRequest(new { error });

            var prepared = await PrepareSubmissionAsync(request, dataSource, context.User.Identity?.Name, cancellationToken);
            if (prepared.Error is not null) return Results.BadRequest(new { error = prepared.Error });
            return Results.File(prepared.ArchiveBytes!, "application/zip", prepared.FileName);
        })
            .RequireAuthorization()
            .RequireRateLimiting("telemetryProfileSubmission")
            .WithMetadata(new RequestSizeLimitAttribute(MaximumSubmissionBodyBytes));

        app.MapPost("/api/telemetry-profile-submissions", async (
            TelemetryProfileSubmissionRequest request,
            EmailDeliveryService email,
            NpgsqlDataSource dataSource,
            HttpContext context,
            CancellationToken cancellationToken) =>
        {
            var error = ValidateRequest(request);
            if (error is not null) return Results.BadRequest(new { error });

            var status = await email.GetStatusAsync(cancellationToken);
            var sender = status.Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase)
                ? await GetDefaultSenderAsync(dataSource, cancellationToken)
                : null;
            var missing = status.MissingSettings.ToList();
            if (status.Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(sender))
                missing.Add("Graph sender mailbox (Settings > Email Alerts)");
            if (!status.Ready || missing.Count > 0)
                return Results.Problem(
                    "App email is unavailable: " + string.Join(", ", missing),
                    statusCode: StatusCodes.Status503ServiceUnavailable);

            var prepared = await PrepareSubmissionAsync(request, dataSource, context.User.Identity?.Name, cancellationToken);
            if (prepared.Error is not null) return Results.BadRequest(new { error = prepared.Error });
            if (status.Provider.Equals("Graph", StringComparison.OrdinalIgnoreCase)
                && prepared.ArchiveBytes!.Length > GraphSimpleAttachmentLimitBytes)
                return Results.Problem(
                    "The ZIP is too large for a standard Microsoft Graph attachment. Download the ZIP and attach it to the prepared email, or choose a shorter date range.",
                    statusCode: StatusCodes.Status413PayloadTooLarge);

            var body = BuildEmailBody(prepared);
            var result = await email.SendAsync(
                SupportAddress,
                prepared.Subject,
                body,
                cancellationToken,
                idempotencyKey: Guid.NewGuid().ToString("N"),
                senderUserId: sender,
                attachments: [new EmailAttachment(prepared.FileName, "application/zip", prepared.ArchiveBytes!)]);
            return result.Accepted
                ? Results.Ok(new { accepted = true, attachment = prepared.FileName, pointCount = prepared.PointCount })
                : Results.Problem("The configured email provider did not accept the message. Download the ZIP, then copy the prepared fields and attach it to a manual email.", statusCode: StatusCodes.Status502BadGateway);
        })
            .RequireAuthorization()
            .RequireRateLimiting("telemetryProfileSubmission")
            .WithMetadata(new RequestSizeLimitAttribute(MaximumSubmissionBodyBytes));
    }

    private static string? ValidateRequest(TelemetryProfileSubmissionRequest request)
    {
        if (request.Profile is null
            || string.IsNullOrWhiteSpace(request.Profile.Id)
            || request.Profile.Id.Length > 200
            || string.IsNullOrWhiteSpace(request.Profile.Name)
            || request.Profile.Name.Length > 200
            || request.Profile.AttributeMap.ValueKind != JsonValueKind.Object)
            return "A valid device profile is required.";
        if (!DateOnly.TryParse(request.FromDate, out var fromDate)
            || !DateOnly.TryParse(request.ThroughDate, out var throughDate)
            || throughDate < fromDate
            || throughDate.DayNumber - fromDate.DayNumber + 1 > MaximumDateRangeDays)
            return "Choose a valid date range of 14 days or fewer.";
        if (request.Positions.ValueKind != JsonValueKind.Array
            || request.Positions.GetArrayLength() is < 1 or > MaximumTrackingPoints)
            return $"The submission must include between 1 and {MaximumTrackingPoints:N0} tracking points. Reduce the date range if needed; no points are sampled or discarded.";
        if (request.Positions.EnumerateArray().Any(position => position.ValueKind != JsonValueKind.Object))
            return "Every tracking point must be a JSON object. Reload the points and try again.";
        if (request.TotalPointCount != request.Positions.GetArrayLength())
            return "The prepared point count does not match the number of points being submitted. Reload the tracking points and try again.";
        if ((request.Note?.Length ?? 0) > 2000)
            return "The support note must be 2,000 characters or fewer.";
        if (request.ExcludedPositionFields is { Length: > MaximumExcludedFieldPaths }
            || request.ExcludedPositionFields?.Any(path => string.IsNullOrWhiteSpace(path) || path[0] != '/' || path.Length > 2048) == true)
            return "The telemetry field selection is invalid. Reload the tracking points and try again.";
        return null;
    }

    private static async Task<PreparedTelemetrySubmission> PrepareSubmissionAsync(
        TelemetryProfileSubmissionRequest request,
        NpgsqlDataSource dataSource,
        string? username,
        CancellationToken cancellationToken)
    {
        var profile = request.Profile;
        if (profile is null || request.Positions.ValueKind != JsonValueKind.Array)
            return PreparedTelemetrySubmission.Failure("A valid device profile and tracking point list are required.");
        if (!DateOnly.TryParse(request.FromDate, out var fromDate)
            || !DateOnly.TryParse(request.ThroughDate, out var throughDate))
            return PreparedTelemetrySubmission.Failure("Choose a valid date range.");

        var fullProfileMap = JsonNode.Parse(profile.AttributeMap.GetRawText()) ?? new JsonObject();
        var legacyPrivacyFilter = request.ExcludedPositionFields is null;
        var excludedFields = request.ExcludedPositionFields ?? Array.Empty<string>();
        var selectedPositions = legacyPrivacyFilter
            ? SanitizePositions(request.Positions, request.IncludeGps)
            : SelectPositions(request.Positions, excludedFields);
        if (selectedPositions.Count == 0)
            return PreparedTelemetrySubmission.Failure("The submission must contain at least one valid tracking point.");

        var safeProfile = new
        {
            id = profile.Id.Trim(),
            name = profile.Name.Trim(),
            schemaVersion = Math.Max(1, profile.SchemaVersion),
            isDraft = profile.IsDraft,
            attributeMap = fullProfileMap,
        };
        var contact = request.IncludeSenderDetails
            ? await GetUserContactAsync(dataSource, username, cancellationToken)
            : null;
        var note = request.Note?.Trim() ?? string.Empty;
        var payload = new Dictionary<string, object?>
        {
            ["profile"] = safeProfile,
            ["dateRange"] = new { from = fromDate.ToString("yyyy-MM-dd"), through = throughDate.ToString("yyyy-MM-dd") },
            ["pointCount"] = selectedPositions.Count,
            ["totalPointCount"] = request.TotalPointCount,
            ["excludedPositionFields"] = excludedFields,
            ["allTelemetryFieldsIncluded"] = !legacyPrivacyFilter && excludedFields.Length == 0,
            ["purpose"] = "Support will use this information only to create or update shared device profiles.",
            ["submittedBy"] = contact is null ? null : new { name = contact.Name, email = contact.Email },
            ["note"] = note,
            ["positions"] = selectedPositions,
        };
        var safeName = Regex.Replace(profile.Name, @"[^a-zA-Z0-9]+", "-").Trim('-').ToLowerInvariant();
        if (safeName.Length > 60) safeName = safeName[..60].TrimEnd('-');
        if (safeName.Length == 0) safeName = "device-profile";
        var fileName = $"telemetry-profile-{safeName}-{fromDate:yyyy-MM-dd}-to-{throughDate:yyyy-MM-dd}.zip";
        var subjectName = Regex.Replace(profile.Name, @"[\x00-\x1F\x7F]+", " ").Trim();
        if (subjectName.Length > 100) subjectName = subjectName[..100];
        var subject = $"Traccar React: Profile review - {subjectName} ({fromDate:yyyy-MM-dd} to {throughDate:yyyy-MM-dd})";
        var json = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        var allTelemetryFieldsIncluded = !legacyPrivacyFilter && excludedFields.Length == 0;
        var archive = BuildArchive(json, fileName, excludedFields, allTelemetryFieldsIncluded, legacyPrivacyFilter);
        return new PreparedTelemetrySubmission(
            null,
            fileName,
            subject,
            fromDate.ToString("yyyy-MM-dd"),
            throughDate.ToString("yyyy-MM-dd"),
            contact,
            note,
            excludedFields,
            allTelemetryFieldsIncluded,
            legacyPrivacyFilter,
            selectedPositions.Count,
            request.TotalPointCount,
            archive);
    }

    private static byte[] BuildArchive(byte[] json, string fileName, string[] excludedFields, bool allTelemetryFieldsIncluded, bool legacyPrivacyFilter)
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            var dataEntry = archive.CreateEntry("submission.json", CompressionLevel.Optimal);
            using (var stream = dataEntry.Open()) stream.Write(json);

            var readmeEntry = archive.CreateEntry("README.txt", CompressionLevel.Optimal);
            using var readme = new StreamWriter(readmeEntry.Open(), new UTF8Encoding(false));
            readme.WriteLine("Traccar React device profile review");
            readme.WriteLine();
            readme.WriteLine("submission.json contains the proposed profile and every tracking point returned for the selected date range.");
            readme.WriteLine(legacyPrivacyFilter
                ? "An older app version applied its default identifier and location filters to the tracking fields."
                : allTelemetryFieldsIncluded
                    ? "All telemetry fields were included by the user."
                    : $"The user excluded {excludedFields.Length:N0} telemetry field path(s); see excludedPositionFields in submission.json.");
            readme.WriteLine("Support will use this information only to create or update shared device profiles.");
            readme.WriteLine("Attach this ZIP to the prepared email to support@rvthinker.com.");
            readme.WriteLine("Archive: " + fileName);
        }
        return output.ToArray();
    }

    private static string BuildEmailBody(PreparedTelemetrySubmission prepared)
    {
        var lines = new List<string>
        {
            "A user is suggesting this device protocol profile for review.",
            $"Tracking point range: {prepared.FromDateText} through {prepared.ThroughDateText} (dates inclusive).",
            $"Tracking points included: {prepared.PointCount:N0} of {prepared.TotalPointCount:N0}; every point returned for this range is included.",
            prepared.LegacyPrivacyFilter
                ? "Telemetry fields: default privacy filtering was applied by an older app version."
                : prepared.AllTelemetryFieldsIncluded
                    ? "Telemetry fields: all available fields were included by the user."
                    : $"Telemetry fields: {prepared.ExcludedPositionFields.Length:N0} field path(s) were excluded by the user; see excludedPositionFields in the ZIP.",
            "Purpose: Support will use this information only to create or update shared device profiles.",
        };
        if (prepared.Contact is not null)
            lines.Add($"Submitted by: {prepared.Contact.Name} <{prepared.Contact.Email}>");
        else
            lines.Add("Submitter name and email: excluded by user choice or unavailable on the account.");
        lines.Add(prepared.Note.Length == 0 ? "User note: (none)." : "User note: " + prepared.Note);
        lines.Add("");
        lines.Add("The proposed profile and selected tracking sample are attached as " + prepared.FileName + ". Extract submission.json to review the data.");
        return string.Join("\n", lines);
    }

    private static async Task<string?> GetDefaultSenderAsync(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select default_sender_user_id from traccar_react_api_email_settings where id = 1", connection);
        return (await command.ExecuteScalarAsync(cancellationToken) as string)?.Trim();
    }

    private static async Task<SubmissionContact?> GetUserContactAsync(
        NpgsqlDataSource dataSource,
        string? username,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(username)) return null;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select first_name, last_name, email from app_users where username = @username and active", connection);
        command.Parameters.AddWithValue("username", username);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var first = reader.IsDBNull(0) ? "" : reader.GetString(0).Trim();
        var last = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim();
        var email = reader.IsDBNull(2) ? "" : reader.GetString(2).Trim();
        var name = string.Join(" ", new[] { first, last }.Where(part => part.Length > 0));
        if (name.Length > 200) name = name[..200];
        if (email.Length > 320 || !MailAddress.TryCreate(email, out var parsed) || parsed.Address != email)
            email = "";
        return name.Length == 0 || email.Length == 0 ? null : new SubmissionContact(name, email);
    }

    private static List<JsonNode?> SanitizePositions(JsonElement positions, bool includeGps)
    {
        var result = new List<JsonNode?>(positions.GetArrayLength());
        foreach (var position in positions.EnumerateArray())
        {
            if (position.ValueKind != JsonValueKind.Object) continue;
            result.Add(SanitizeElement(position, includeGps, positionRoot: true, stripLocation: true));
        }
        return result;
    }

    private static List<JsonNode?> SelectPositions(JsonElement positions, IReadOnlyCollection<string> excludedFields)
    {
        var excluded = new HashSet<string>(excludedFields, StringComparer.Ordinal);
        var result = new List<JsonNode?>(positions.GetArrayLength());
        foreach (var position in positions.EnumerateArray())
        {
            if (position.ValueKind != JsonValueKind.Object) continue;
            result.Add(SelectElement(position, "", excluded));
        }
        return result;
    }

    private static JsonNode? SelectElement(JsonElement element, string currentPath, HashSet<string> excluded)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var result = new JsonObject();
            foreach (var property in element.EnumerateObject())
            {
                var propertyPath = AppendJsonPointer(currentPath, property.Name);
                if (excluded.Contains(propertyPath)) continue;
                if (property.Value.ValueKind == JsonValueKind.Array && excluded.Contains(AppendJsonPointer(propertyPath, "*"))) continue;
                result[property.Name] = SelectElement(property.Value, propertyPath, excluded);
            }
            return result;
        }
        if (element.ValueKind == JsonValueKind.Array)
        {
            var result = new JsonArray();
            foreach (var item in element.EnumerateArray())
            {
                var itemPath = AppendJsonPointer(currentPath, "*");
                if (excluded.Contains(itemPath) || item.ValueKind == JsonValueKind.Array && excluded.Contains(AppendJsonPointer(itemPath, "*")))
                {
                    result.Add((JsonNode?)null);
                    continue;
                }
                result.Add(SelectElement(item, itemPath, excluded));
            }
            return result;
        }
        return JsonNode.Parse(element.GetRawText());
    }

    private static string AppendJsonPointer(string currentPath, string segment) =>
        currentPath + "/" + segment.Replace("~", "~0").Replace("/", "~1");

    private static JsonNode? SanitizeElement(JsonElement element, bool includeGps, bool positionRoot, bool stripLocation)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var result = new JsonObject();
            foreach (var property in element.EnumerateObject())
            {
                var key = property.Name;
                var normalized = NormalizeKey(key);
                if (IsIdentifierKey(key)) continue;
                if (stripLocation && normalized == "id") continue;
                if (stripLocation && IsLocationKey(normalized))
                {
                    var rootCoordinate = positionRoot && RootCoordinateKeys.Contains(normalized);
                    if (!(includeGps && rootCoordinate)) continue;
                }
                result[key] = SanitizeElement(property.Value, includeGps, positionRoot: false, stripLocation: stripLocation);
            }
            return result;
        }
        if (element.ValueKind == JsonValueKind.Array)
        {
            var result = new JsonArray();
            foreach (var item in element.EnumerateArray())
                result.Add(SanitizeElement(item, includeGps, positionRoot: false, stripLocation: stripLocation));
            return result;
        }
        return JsonNode.Parse(element.GetRawText());
    }

    private static string NormalizeKey(string key) => Regex.Replace(key, @"[^a-zA-Z0-9]", "").ToLowerInvariant();

    private static bool IsLocationKey(string normalized) =>
        LocationKeys.Contains(normalized)
        || normalized.EndsWith("latitude", StringComparison.Ordinal)
        || normalized.StartsWith("latitude", StringComparison.Ordinal)
        || normalized.EndsWith("longitude", StringComparison.Ordinal)
        || normalized.StartsWith("longitude", StringComparison.Ordinal)
        || normalized.StartsWith("gps", StringComparison.Ordinal)
        || normalized.EndsWith("gps", StringComparison.Ordinal)
        || normalized.StartsWith("address", StringComparison.Ordinal)
        || normalized.EndsWith("address", StringComparison.Ordinal)
        || normalized.StartsWith("location", StringComparison.Ordinal)
        || normalized.EndsWith("location", StringComparison.Ordinal)
        || normalized.StartsWith("geofence", StringComparison.Ordinal)
        || normalized.EndsWith("geofence", StringComparison.Ordinal);

    private static bool IsIdentifierKey(string key)
    {
        var normalized = NormalizeKey(key);
        return IdentifierKeyParts.Any(part => normalized.Contains(part, StringComparison.Ordinal));
    }

    private sealed record SubmissionContact(string Name, string Email);

    private sealed record PreparedTelemetrySubmission(
        string? Error,
        string FileName,
        string Subject,
        string FromDateText,
        string ThroughDateText,
        SubmissionContact? Contact,
        string Note,
        string[] ExcludedPositionFields,
        bool AllTelemetryFieldsIncluded,
        bool LegacyPrivacyFilter,
        int PointCount,
        int TotalPointCount,
        byte[]? ArchiveBytes)
    {
        public static PreparedTelemetrySubmission Failure(string error) =>
            new(error, "", "", "", "", null, "", Array.Empty<string>(), false, false, 0, 0, null);
    }
}

public sealed record TelemetryProfileSubmissionRequest(
    TelemetryProfileSubmissionProfile? Profile,
    string? FromDate,
    string? ThroughDate,
    JsonElement Positions,
    int TotalPointCount,
    bool IncludeGps = false,
    string? Note = null,
    bool IncludeSenderDetails = false,
    string[]? ExcludedPositionFields = null);

public sealed record TelemetryProfileSubmissionProfile(
    string Id,
    string Name,
    int SchemaVersion,
    bool IsDraft,
    JsonElement AttributeMap);

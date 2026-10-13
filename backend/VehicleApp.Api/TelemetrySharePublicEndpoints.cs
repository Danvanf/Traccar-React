using System.Text.Json;
using System.Text;
using Npgsql;
using NpgsqlTypes;

public static class TelemetrySharePublicEndpoints
{
    public static void MapTelemetrySharePublicEndpoints(this WebApplication app)
    {
        app.MapGet("/api/public/telemetry-shares/{token}", GetShareAsync)
            .RequireRateLimiting("publicTelemetryShares")
            .WithName("GetPublicTelemetryShare");
        app.MapGet("/api/public/telemetry-shares/{token}/trips/{tripKey:guid}", GetTripAsync)
            .RequireRateLimiting("publicTelemetryShares")
            .WithName("GetPublicTelemetryShareTrip");
        app.MapGet("/api/public/telemetry-shares/{token}/trips/{tripKey:guid}/export.csv", ExportTripAsync)
            .RequireRateLimiting("publicTelemetryShares")
            .WithName("ExportPublicTelemetryShareTrip");
        app.MapGet("/api/public/telemetry-shares/{token}/trips/{tripKey:guid}/export.json", ExportTripJsonAsync)
            .RequireRateLimiting("publicTelemetryShares")
            .WithName("ExportPublicTelemetryShareTripJson");
    }

    private static async Task<IResult> GetShareAsync(
        string token,
        NpgsqlDataSource dataSource,
        TelemetryShareTokenService tokenService,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        PreparePublicResponse(context);
        if (!TelemetryShareTokenService.IsValidToken(token)) return Results.NotFound();
        var tokenHash = tokenService.HashToken(token);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var share = await LoadShareAsync(connection, tokenHash, cancellationToken);
        if (share is null) return Results.NotFound();
        await TouchAsync(connection, share.Id, cancellationToken);

        var trips = new List<object>();
        await using (var command = new NpgsqlCommand("""
            select trip_key, display_order, started_at, ended_at, duration_seconds, distance_meters
            from telemetry_share_trips
            where share_id=@shareId
            order by display_order, started_at
            """, connection))
        {
            command.Parameters.AddWithValue("shareId", share.Id);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                trips.Add(new
                {
                    tripKey = reader.GetGuid(0),
                    displayOrder = reader.GetInt32(1),
                    startedAt = reader.GetFieldValue<DateTimeOffset>(2),
                    endedAt = reader.GetFieldValue<DateTimeOffset>(3),
                    durationSeconds = reader.IsDBNull(4) ? (int?)null : reader.GetInt32(4),
                    distanceMeters = reader.IsDBNull(5) ? (double?)null : reader.GetDouble(5),
                });
            }
        }

        var series = new List<object>();
        await using (var command = new NpgsqlCommand("""
            select field_key, label_snapshot, unit_snapshot, color, display_order
            from telemetry_share_series
            where share_id=@shareId
            order by display_order, field_key
            """, connection))
        {
            command.Parameters.AddWithValue("shareId", share.Id);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                series.Add(new
                {
                    fieldKey = reader.GetString(0),
                    label = reader.GetString(1),
                    unit = reader.IsDBNull(2) ? null : reader.GetString(2),
                    color = reader.GetString(3),
                    displayOrder = reader.GetInt32(4),
                });
            }
        }

        return Results.Ok(new
        {
            mode = share.Mode,
            title = share.Title,
            message = share.Message,
            vehicle = share.VehicleLabel,
            fromUtc = share.FromUtc,
            throughUtc = share.ThroughUtc,
            timeZone = share.TimeZone,
            allowExport = share.AllowExport,
            expiresAt = share.ExpiresAt,
            trips,
            series,
        });
    }

    private static async Task<IResult> GetTripAsync(
        string token,
        Guid tripKey,
        NpgsqlDataSource dataSource,
        TelemetryShareTokenService tokenService,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        PreparePublicResponse(context);
        if (!TelemetryShareTokenService.IsValidToken(token)) return Results.NotFound();
        var tokenHash = tokenService.HashToken(token);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var share = await LoadShareAsync(connection, tokenHash, cancellationToken);
        if (share is null) return Results.NotFound();
        await TouchAsync(connection, share.Id, cancellationToken);

        await using var command = new NpgsqlCommand("""
            select started_at, ended_at, duration_seconds, distance_meters
            from telemetry_share_trips
            where share_id=@shareId and trip_key=@tripKey
            """, connection);
        command.Parameters.AddWithValue("shareId", share.Id);
        command.Parameters.AddWithValue("tripKey", tripKey);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return Results.NotFound();
        var trip = new
        {
            tripKey,
            startedAt = reader.GetFieldValue<DateTimeOffset>(0),
            endedAt = reader.GetFieldValue<DateTimeOffset>(1),
            durationSeconds = reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2),
            distanceMeters = reader.IsDBNull(3) ? (double?)null : reader.GetDouble(3),
        };
        await reader.CloseAsync();

        var points = new List<object>();
        await using (var pointsCommand = new NpgsqlCommand("""
            select point_index, occurred_at, elapsed_milliseconds, point_values
            from telemetry_share_points
            where share_id=@shareId and trip_key=@tripKey
            order by point_index
            """, connection))
        {
            pointsCommand.Parameters.AddWithValue("shareId", share.Id);
            pointsCommand.Parameters.AddWithValue("tripKey", tripKey);
            await using var pointsReader = await pointsCommand.ExecuteReaderAsync(cancellationToken);
            while (await pointsReader.ReadAsync(cancellationToken))
            {
                using var document = pointsReader.GetFieldValue<JsonDocument>(3);
                points.Add(new
                {
                    pointIndex = pointsReader.GetInt32(0),
                    occurredAt = pointsReader.GetFieldValue<DateTimeOffset>(1),
                    elapsedMilliseconds = pointsReader.GetInt64(2),
                    values = document.RootElement.Clone(),
                });
            }
        }

        return Results.Ok(new { trip, points });
    }

    private static async Task<IResult> ExportTripAsync(string token, Guid tripKey, NpgsqlDataSource dataSource, TelemetryShareTokenService tokenService, HttpContext context, CancellationToken cancellationToken)
    {
        PreparePublicResponse(context);
        if (!TelemetryShareTokenService.IsValidToken(token)) return Results.NotFound();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var share = await LoadShareAsync(connection, tokenService.HashToken(token), cancellationToken);
        if (share is null || !share.AllowExport) return Results.NotFound();
        await TouchAsync(connection, share.Id, cancellationToken);
        var fields = new List<string>();
        await using (var seriesCommand = new NpgsqlCommand("select field_key from telemetry_share_series where share_id=@shareId order by display_order, field_key", connection))
        {
            seriesCommand.Parameters.AddWithValue("shareId", share.Id);
            await using var reader = await seriesCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) fields.Add(reader.GetString(0));
        }
        var csv = new StringBuilder();
        csv.Append("occurred_at,elapsed_milliseconds");
        foreach (var field in fields) csv.Append(',').Append(Csv(field));
        csv.AppendLine();
        await using (var pointsCommand = new NpgsqlCommand("select occurred_at, elapsed_milliseconds, point_values from telemetry_share_points where share_id=@shareId and trip_key=@tripKey order by point_index", connection))
        {
            pointsCommand.Parameters.AddWithValue("shareId", share.Id);
            pointsCommand.Parameters.AddWithValue("tripKey", tripKey);
            await using var reader = await pointsCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var values = reader.GetFieldValue<JsonDocument>(2).RootElement;
                csv.Append(Csv(reader.GetFieldValue<DateTimeOffset>(0).ToString("O"))).Append(',').Append(reader.GetInt64(1));
                foreach (var field in fields) csv.Append(',').Append(values.TryGetProperty(field, out var value) ? Csv(value.ToString()) : "");
                csv.AppendLine();
            }
        }
        return Results.File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", $"telemetry-{tripKey}.csv");
    }

    private static async Task<IResult> ExportTripJsonAsync(string token, Guid tripKey, NpgsqlDataSource dataSource, TelemetryShareTokenService tokenService, HttpContext context, CancellationToken cancellationToken)
    {
        PreparePublicResponse(context);
        if (!TelemetryShareTokenService.IsValidToken(token)) return Results.NotFound();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var share = await LoadShareAsync(connection, tokenService.HashToken(token), cancellationToken);
        if (share is null || !share.AllowExport) return Results.NotFound();
        await TouchAsync(connection, share.Id, cancellationToken);
        var points = new List<object>();
        await using var command = new NpgsqlCommand("select point_index, occurred_at, elapsed_milliseconds, point_values from telemetry_share_points where share_id=@shareId and trip_key=@tripKey order by point_index", connection);
        command.Parameters.AddWithValue("shareId", share.Id);
        command.Parameters.AddWithValue("tripKey", tripKey);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            points.Add(new
            {
                pointIndex = reader.GetInt32(0),
                occurredAt = reader.GetFieldValue<DateTimeOffset>(1),
                elapsedMilliseconds = reader.GetInt64(2),
                values = reader.GetFieldValue<JsonDocument>(3).RootElement.Clone(),
            });
        }
        return Results.Json(new { tripKey, points }, contentType: "application/json");
    }

    private static string Csv(string value) => value.Contains(',', StringComparison.Ordinal) || value.Contains('"', StringComparison.Ordinal) || value.Contains('\n', StringComparison.Ordinal)
        ? $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\""
        : value;

    private static async Task<ShareInfo?> LoadShareAsync(NpgsqlConnection connection, byte[] tokenHash, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("""
            select id, mode, title, message, vehicle_label_snapshot, from_utc,
                   through_utc, time_zone, allow_export, expires_at
            from telemetry_shares
            where token_hash=@tokenHash and status='active' and expires_at > now()
            """, connection);
        command.Parameters.Add("tokenHash", NpgsqlDbType.Bytea).Value = tokenHash;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new ShareInfo(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.GetString(4),
            reader.GetFieldValue<DateTimeOffset>(5),
            reader.GetFieldValue<DateTimeOffset>(6),
            reader.GetString(7),
            reader.GetBoolean(8),
            reader.GetFieldValue<DateTimeOffset>(9));
    }

    private static async Task TouchAsync(NpgsqlConnection connection, Guid shareId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("update telemetry_shares set last_accessed_at=now(), access_count=access_count+1 where id=@shareId", connection);
        command.Parameters.AddWithValue("shareId", shareId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void PreparePublicResponse(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Pragma = "no-cache";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    }

    private sealed record ShareInfo(Guid Id, string Mode, string? Title, string? Message, string VehicleLabel, DateTimeOffset FromUtc, DateTimeOffset ThroughUtc, string TimeZone, bool AllowExport, DateTimeOffset ExpiresAt);
}

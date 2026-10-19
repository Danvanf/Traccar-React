using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

public static class UserPreferenceEndpoints
{
    public static void MapUserPreferenceEndpoints(this WebApplication app)
    {
        app.MapGet("/api/user/preferences/{preferenceKey}", async (
            string preferenceKey,
            NpgsqlDataSource dataSource,
            HttpContext context,
            CancellationToken cancellationToken) =>
        {
            if (!IsValidKey(preferenceKey)) return Results.BadRequest("Invalid preference key.");
            var username = context.User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(username)) return Results.NotFound();

            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand(
                """
                select p.preference_value::text
                from app_user_preferences p
                join app_users u on u.id = p.user_id
                where u.username = @username and u.active and p.preference_key = @preferenceKey
                """, connection);
            command.Parameters.AddWithValue("username", username);
            command.Parameters.AddWithValue("preferenceKey", preferenceKey);
            var rawValue = await command.ExecuteScalarAsync(cancellationToken) as string;
            if (rawValue is null) return Results.NotFound();

            using var document = JsonDocument.Parse(rawValue);
            return Results.Ok(new { key = preferenceKey, value = document.RootElement.Clone() });
        });

        app.MapPut("/api/user/preferences/{preferenceKey}", async (
            string preferenceKey,
            UserPreferenceRequest request,
            NpgsqlDataSource dataSource,
            HttpContext context,
            CancellationToken cancellationToken) =>
        {
            if (!IsValidKey(preferenceKey)) return Results.BadRequest("Invalid preference key.");
            if (request.Value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
                return Results.BadRequest("A preference value is required.");
            var rawValue = request.Value.GetRawText();
            if (rawValue.Length > 4096) return Results.BadRequest("Preference value is too large.");

            var username = context.User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(username)) return Results.Unauthorized();

            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand(
                """
                insert into app_user_preferences (user_id, preference_key, preference_value, updated_at)
                select id, @preferenceKey, @preferenceValue, now()
                from app_users
                where username = @username and active
                on conflict (user_id, preference_key) do update
                set preference_value = excluded.preference_value, updated_at = now()
                """, connection);
            command.Parameters.AddWithValue("username", username);
            command.Parameters.AddWithValue("preferenceKey", preferenceKey);
            command.Parameters.Add("preferenceValue", NpgsqlDbType.Jsonb).Value = rawValue;
            var affected = await command.ExecuteNonQueryAsync(cancellationToken);
            return affected == 0 ? Results.NotFound() : Results.Ok(new { key = preferenceKey });
        });
    }

    private static bool IsValidKey(string key) =>
        !string.IsNullOrWhiteSpace(key)
        && key.Length <= 100
        && key.All(character => char.IsLetterOrDigit(character) || character is '.' or '_' or '-');
}

public sealed record UserPreferenceRequest(JsonElement Value);

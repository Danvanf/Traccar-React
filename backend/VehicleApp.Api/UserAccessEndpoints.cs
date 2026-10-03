using System.Security.Cryptography;
using System.Text;
using System.Security.Claims;

public static class UserAccessEndpoints
{
    public static void MapUserAccessEndpoints(this WebApplication app)
    {
        app.MapGet("/api/admin/users", async (Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("select id, username, first_name, last_name, email, role, active, auto_access_new_devices from app_users order by username", connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var users = new List<UserAccessResponse>();
            while (await reader.ReadAsync(cancellationToken))
            {
                users.Add(new UserAccessResponse(reader.GetGuid(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetString(5), reader.GetBoolean(6), reader.GetBoolean(7)));
            }
            return Results.Ok(users);
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPost("/api/admin/users", async (CreateUserRequest request, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
                return Results.BadRequest("Username and password are required.");
            var username = request.Username.Trim();
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("""
                insert into app_users (username, password_hash, first_name, last_name, email, role, active, auto_access_new_devices)
                values (@username, @passwordHash, @firstName, @lastName, @email, @role, @active, @autoAccess)
                returning id
                """, connection);
            command.Parameters.AddWithValue("username", username);
            command.Parameters.AddWithValue("passwordHash", PasswordHashing.Hash(request.Password));
            command.Parameters.AddWithValue("firstName", (object?)request.FirstName ?? DBNull.Value);
            command.Parameters.AddWithValue("lastName", (object?)request.LastName ?? DBNull.Value);
            command.Parameters.AddWithValue("email", (object?)request.Email ?? DBNull.Value);
            command.Parameters.AddWithValue("role", request.Role is "admin" ? "admin" : "regular");
            command.Parameters.AddWithValue("active", request.Active);
            command.Parameters.AddWithValue("autoAccess", request.AutoAccessNewDevices);
            try
            {
                var id = (Guid)(await command.ExecuteScalarAsync(cancellationToken) ?? throw new InvalidOperationException("User was not created."));
                return Results.Created($"/api/admin/users/{id}", new { id, username });
            }
            catch (Npgsql.PostgresException ex) when (ex.SqlState == "23505")
            {
                return Results.Conflict("A user with that username already exists.");
            }
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPost("/api/admin/groups", async (CreateGroupRequest request, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name)) return Results.BadRequest("Group name is required.");
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("insert into app_groups (name, auto_access_new_devices) values (@name, @autoAccess) returning id", connection);
            command.Parameters.AddWithValue("name", request.Name.Trim());
            command.Parameters.AddWithValue("autoAccess", request.AutoAccessNewDevices);
            try
            {
                var id = (Guid)(await command.ExecuteScalarAsync(cancellationToken) ?? throw new InvalidOperationException("Group was not created."));
                return Results.Created($"/api/admin/groups/{id}", new { id, name = request.Name.Trim() });
            }
            catch (Npgsql.PostgresException ex) when (ex.SqlState == "23505")
            {
                return Results.Conflict("A group with that name already exists.");
            }
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPatch("/api/admin/users/{userId:guid}", async (Guid userId, UpdateUserRequest request, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("update app_users set first_name=@firstName,last_name=@lastName,email=@email,role=@role,active=@active,auto_access_new_devices=@autoAccess, password_hash=coalesce(@passwordHash,password_hash), updated_at=now() where id=@userId", connection);
            command.Parameters.AddWithValue("userId", userId); command.Parameters.AddWithValue("firstName", (object?)request.FirstName ?? DBNull.Value); command.Parameters.AddWithValue("lastName", (object?)request.LastName ?? DBNull.Value); command.Parameters.AddWithValue("email", (object?)request.Email ?? DBNull.Value); command.Parameters.AddWithValue("role", request.Role is "admin" ? "admin" : "regular"); command.Parameters.AddWithValue("active", request.Active); command.Parameters.AddWithValue("autoAccess", request.AutoAccessNewDevices); command.Parameters.AddWithValue("passwordHash", string.IsNullOrWhiteSpace(request.Password) ? DBNull.Value : PasswordHashing.Hash(request.Password));
            return await command.ExecuteNonQueryAsync(cancellationToken) == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapDelete("/api/admin/users/{userId:guid}", async (Guid userId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken); await using var command = new Npgsql.NpgsqlCommand("delete from app_users where id=@userId", connection); command.Parameters.AddWithValue("userId", userId); return await command.ExecuteNonQueryAsync(cancellationToken) == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPatch("/api/admin/groups/{groupId:guid}", async (Guid groupId, UpdateGroupRequest request, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken); await using var command = new Npgsql.NpgsqlCommand("update app_groups set name=@name,auto_access_new_devices=@autoAccess,updated_at=now() where id=@groupId", connection); command.Parameters.AddWithValue("groupId", groupId); command.Parameters.AddWithValue("name", request.Name.Trim()); command.Parameters.AddWithValue("autoAccess", request.AutoAccessNewDevices); return await command.ExecuteNonQueryAsync(cancellationToken) == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapDelete("/api/admin/groups/{groupId:guid}", async (Guid groupId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken); await using var command = new Npgsql.NpgsqlCommand("delete from app_groups where id=@groupId", connection); command.Parameters.AddWithValue("groupId", groupId); return await command.ExecuteNonQueryAsync(cancellationToken) == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/groups", async (Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("select id, name, auto_access_new_devices from app_groups order by name", connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var groups = new List<GroupAccessResponse>();
            while (await reader.ReadAsync(cancellationToken))
                groups.Add(new GroupAccessResponse(reader.GetGuid(0), reader.GetString(1), reader.GetBoolean(2)));
            return Results.Ok(groups);
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPatch("/api/admin/users/{userId:guid}/auto-access", async (Guid userId, AutoAccessRequest request, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("update app_users set auto_access_new_devices = @enabled, updated_at = now() where id = @userId", connection);
            command.Parameters.AddWithValue("enabled", request.Enabled);
            command.Parameters.AddWithValue("userId", userId);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPatch("/api/admin/groups/{groupId:guid}/auto-access", async (Guid groupId, AutoAccessRequest request, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("update app_groups set auto_access_new_devices = @enabled, updated_at = now() where id = @groupId", connection);
            command.Parameters.AddWithValue("enabled", request.Enabled);
            command.Parameters.AddWithValue("groupId", groupId);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPut("/api/admin/groups/{groupId:guid}/users/{userId:guid}", async (Guid groupId, Guid userId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("insert into app_group_memberships (group_id, user_id) values (@groupId, @userId) on conflict do nothing", connection);
            command.Parameters.AddWithValue("groupId", groupId);
            command.Parameters.AddWithValue("userId", userId);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapDelete("/api/admin/groups/{groupId:guid}/users/{userId:guid}", async (Guid groupId, Guid userId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("delete from app_group_memberships where group_id = @groupId and user_id = @userId", connection);
            command.Parameters.AddWithValue("groupId", groupId);
            command.Parameters.AddWithValue("userId", userId);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/groups/{groupId:guid}/users", async (Guid groupId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken); await using var command = new Npgsql.NpgsqlCommand("select user_id from app_group_memberships where group_id=@groupId order by user_id", connection); command.Parameters.AddWithValue("groupId", groupId); await using var reader = await command.ExecuteReaderAsync(cancellationToken); var ids = new List<Guid>(); while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetGuid(0)); return Results.Ok(ids);
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/users/{userId:guid}/groups", async (Guid userId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken); await using var command = new Npgsql.NpgsqlCommand("select group_id from app_group_memberships where user_id=@userId order by group_id", connection); command.Parameters.AddWithValue("userId", userId); await using var reader = await command.ExecuteReaderAsync(cancellationToken); var ids = new List<Guid>(); while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetGuid(0)); return Results.Ok(ids);
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPut("/api/admin/groups/{groupId:guid}/vehicles/{vehicleId:guid}", async (Guid groupId, Guid vehicleId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("insert into app_group_vehicle_access (group_id, vehicle_id) values (@groupId, @vehicleId) on conflict do nothing", connection);
            command.Parameters.AddWithValue("groupId", groupId);
            command.Parameters.AddWithValue("vehicleId", vehicleId);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapDelete("/api/admin/groups/{groupId:guid}/vehicles/{vehicleId:guid}", async (Guid groupId, Guid vehicleId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("delete from app_group_vehicle_access where group_id = @groupId and vehicle_id = @vehicleId", connection);
            command.Parameters.AddWithValue("groupId", groupId);
            command.Parameters.AddWithValue("vehicleId", vehicleId);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPut("/api/admin/users/{userId:guid}/vehicles/{vehicleId:guid}", async (Guid userId, Guid vehicleId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("insert into app_user_vehicle_access (user_id, vehicle_id) values (@userId, @vehicleId) on conflict do nothing", connection);
            command.Parameters.AddWithValue("userId", userId);
            command.Parameters.AddWithValue("vehicleId", vehicleId);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/users/{userId:guid}/vehicles", async (Guid userId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("select vehicle_id from app_user_vehicle_access where user_id = @userId order by vehicle_id", connection);
            command.Parameters.AddWithValue("userId", userId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var ids = new List<Guid>();
            while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetGuid(0));
            return Results.Ok(ids);
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/groups/{groupId:guid}/vehicles", async (Guid groupId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("select vehicle_id from app_group_vehicle_access where group_id = @groupId order by vehicle_id", connection);
            command.Parameters.AddWithValue("groupId", groupId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var ids = new List<Guid>();
            while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetGuid(0));
            return Results.Ok(ids);
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapDelete("/api/admin/users/{userId:guid}/vehicles/{vehicleId:guid}", async (Guid userId, Guid vehicleId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("delete from app_user_vehicle_access where user_id = @userId and vehicle_id = @vehicleId", connection);
            command.Parameters.AddWithValue("userId", userId);
            command.Parameters.AddWithValue("vehicleId", vehicleId);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPut("/api/admin/users/{userId:guid}/devices/{deviceId:int}", async (Guid userId, int deviceId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("insert into app_user_device_access (user_id, traccar_device_id) values (@userId, @deviceId) on conflict do nothing", connection);
            command.Parameters.AddWithValue("userId", userId); command.Parameters.AddWithValue("deviceId", deviceId);
            await command.ExecuteNonQueryAsync(cancellationToken); return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapDelete("/api/admin/users/{userId:guid}/devices/{deviceId:int}", async (Guid userId, int deviceId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("delete from app_user_device_access where user_id = @userId and traccar_device_id = @deviceId", connection);
            command.Parameters.AddWithValue("userId", userId); command.Parameters.AddWithValue("deviceId", deviceId);
            await command.ExecuteNonQueryAsync(cancellationToken); return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/users/{userId:guid}/devices", async (Guid userId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("select traccar_device_id from app_user_device_access where user_id = @userId order by traccar_device_id", connection);
            command.Parameters.AddWithValue("userId", userId); await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var ids = new List<int>(); while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetInt32(0)); return Results.Ok(ids);
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapPut("/api/admin/groups/{groupId:guid}/devices/{deviceId:int}", async (Guid groupId, int deviceId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("insert into app_group_device_access (group_id, traccar_device_id) values (@groupId, @deviceId) on conflict do nothing", connection);
            command.Parameters.AddWithValue("groupId", groupId); command.Parameters.AddWithValue("deviceId", deviceId);
            await command.ExecuteNonQueryAsync(cancellationToken); return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapDelete("/api/admin/groups/{groupId:guid}/devices/{deviceId:int}", async (Guid groupId, int deviceId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("delete from app_group_device_access where group_id = @groupId and traccar_device_id = @deviceId", connection);
            command.Parameters.AddWithValue("groupId", groupId); command.Parameters.AddWithValue("deviceId", deviceId);
            await command.ExecuteNonQueryAsync(cancellationToken); return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole("admin"));

        app.MapGet("/api/admin/groups/{groupId:guid}/devices", async (Guid groupId, Npgsql.NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("select traccar_device_id from app_group_device_access where group_id = @groupId order by traccar_device_id", connection);
            command.Parameters.AddWithValue("groupId", groupId); await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var ids = new List<int>(); while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetInt32(0)); return Results.Ok(ids);
        }).RequireAuthorization(policy => policy.RequireRole("admin"));
    }
}

public sealed record UserAccessResponse(Guid Id, string Username, string? FirstName, string? LastName, string? Email, string Role, bool Active, bool AutoAccessNewDevices);
public sealed record GroupAccessResponse(Guid Id, string Name, bool AutoAccessNewDevices);
public sealed record CreateUserRequest(string Username, string Password, string? FirstName, string? LastName, string? Email, string? Role, bool Active = true, bool AutoAccessNewDevices = false);
public sealed record CreateGroupRequest(string Name, bool AutoAccessNewDevices = false);
public sealed record UpdateUserRequest(string? Password, string? FirstName, string? LastName, string? Email, string? Role, bool Active, bool AutoAccessNewDevices);
public sealed record UpdateGroupRequest(string Name, bool AutoAccessNewDevices);
public sealed record AutoAccessRequest(bool Enabled);

public static class PasswordHashing
{
    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, 120_000, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2-sha256$120000${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public static bool Verify(string password, string encoded)
    {
        var parts = encoded.Split('$');
        if (parts.Length != 4 || !int.TryParse(parts[1], out var iterations)) return false;
        var salt = Convert.FromBase64String(parts[2]);
        var expected = Convert.FromBase64String(parts[3]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}

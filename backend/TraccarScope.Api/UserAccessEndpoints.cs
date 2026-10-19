using System.Security.Cryptography;
using System.Text;
using System.Security.Claims;

public static class UserAccessEndpoints
{
    public static void MapUserAccessEndpoints(this WebApplication app)
    {
        app.MapGet("/api/user/profile", async Task<IResult> (Npgsql.NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            var username = context.User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(username)) return Results.Unauthorized();

            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            Guid userId;
            string profileUsername;
            string? firstName;
            string? lastName;
            string? email;
            string role;
            bool active;
            bool autoAccessNewDevices;
            await using (var command = new Npgsql.NpgsqlCommand("select id, username, first_name, last_name, email, role, active, auto_access_new_devices from app_users where username = @username", connection))
            {
                command.Parameters.AddWithValue("username", username);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken)) return Results.NotFound();
                userId = reader.GetGuid(0);
                profileUsername = reader.GetString(1);
                firstName = reader.IsDBNull(2) ? null : reader.GetString(2);
                lastName = reader.IsDBNull(3) ? null : reader.GetString(3);
                email = reader.IsDBNull(4) ? null : reader.GetString(4);
                role = reader.GetString(5);
                active = reader.GetBoolean(6);
                autoAccessNewDevices = reader.GetBoolean(7);
            }

            var groups = new List<SelfUserProfileGroup>();
            await using (var command = new Npgsql.NpgsqlCommand("select g.id, g.name, g.auto_access_new_devices from app_group_memberships gm join app_groups g on g.id = gm.group_id where gm.user_id = @userId order by g.name", connection))
            {
                command.Parameters.AddWithValue("userId", userId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                    groups.Add(new SelfUserProfileGroup(reader.GetGuid(0), reader.GetString(1), reader.GetBoolean(2)));
            }

            var vehicles = new List<SelfUserProfileVehicle>();
            await using (var command = new Npgsql.NpgsqlCommand("""
                select v.id, v.display_name, v.active, ua.user_id is not null,
                       coalesce(array_agg(distinct g.name) filter (where g.name is not null), ARRAY[]::text[])
                from vehicles v
                left join app_user_vehicle_access ua on ua.vehicle_id = v.id and ua.user_id = @userId
                left join app_group_memberships gm on gm.user_id = @userId
                left join app_group_vehicle_access ga on ga.group_id = gm.group_id and ga.vehicle_id = v.id
                left join app_groups g on g.id = ga.group_id
                where @isAdmin or ua.user_id is not null or ga.group_id is not null
                group by v.id, v.display_name, v.active, ua.user_id
                order by v.display_name
                """, connection))
            {
                command.Parameters.AddWithValue("userId", userId);
                command.Parameters.AddWithValue("isAdmin", context.User.IsInRole("admin"));
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                    vehicles.Add(new SelfUserProfileVehicle(reader.GetGuid(0), reader.GetString(1), reader.GetBoolean(2), reader.GetBoolean(3), reader.GetFieldValue<string[]>(4)));
            }

            var devices = new List<SelfUserProfileDevice>();
            await using (var command = new Npgsql.NpgsqlCommand("""
                select access.device_id, bool_or(access.is_direct),
                       coalesce(array_agg(distinct access.group_name) filter (where access.group_name is not null), ARRAY[]::text[])
                from (
                    select traccar_device_id as device_id, true as is_direct, null::text as group_name
                    from app_user_device_access where user_id = @userId
                    union all
                    select ga.traccar_device_id as device_id, false as is_direct, g.name as group_name
                    from app_group_memberships gm
                    join app_groups g on g.id = gm.group_id
                    join app_group_device_access ga on ga.group_id = gm.group_id
                    where gm.user_id = @userId
                ) access
                group by access.device_id
                order by access.device_id
                """, connection))
            {
                command.Parameters.AddWithValue("userId", userId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                    devices.Add(new SelfUserProfileDevice(reader.GetInt32(0), reader.GetBoolean(1), reader.GetFieldValue<string[]>(2)));
            }

            return Results.Ok(new SelfUserProfileResponse(userId, profileUsername, firstName, lastName, email, role, active, autoAccessNewDevices, groups, vehicles, devices));
        }).RequireAuthorization();

        app.MapPatch("/api/user/profile", async Task<IResult> (UpdateSelfUserProfileRequest request, Npgsql.NpgsqlDataSource dataSource, HttpContext context, CancellationToken cancellationToken) =>
        {
            var username = context.User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(username)) return Results.Unauthorized();
            var firstName = string.IsNullOrWhiteSpace(request.FirstName) ? null : request.FirstName.Trim();
            var lastName = string.IsNullOrWhiteSpace(request.LastName) ? null : request.LastName.Trim();
            var email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim();
            if (firstName?.Length > 100 || lastName?.Length > 100 || email?.Length > 320)
                return Results.BadRequest("Names must be 100 characters or fewer and email must be 320 characters or fewer.");
            if (email is not null && (!System.Net.Mail.MailAddress.TryCreate(email, out var parsedEmail) || parsedEmail.Address != email))
                return Results.BadRequest("Enter a valid email address or leave the field blank.");

            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new Npgsql.NpgsqlCommand("update app_users set first_name = @firstName, last_name = @lastName, email = @email, updated_at = now() where username = @username", connection);
            command.Parameters.AddWithValue("firstName", (object?)firstName ?? DBNull.Value);
            command.Parameters.AddWithValue("lastName", (object?)lastName ?? DBNull.Value);
            command.Parameters.AddWithValue("email", (object?)email ?? DBNull.Value);
            command.Parameters.AddWithValue("username", username);
            return await command.ExecuteNonQueryAsync(cancellationToken) == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization();

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
public sealed record SelfUserProfileResponse(Guid Id, string Username, string? FirstName, string? LastName, string? Email, string Role, bool Active, bool AutoAccessNewDevices, IReadOnlyList<SelfUserProfileGroup> Groups, IReadOnlyList<SelfUserProfileVehicle> Vehicles, IReadOnlyList<SelfUserProfileDevice> Devices);
public sealed record SelfUserProfileGroup(Guid Id, string Name, bool AutoAccessNewDevices);
public sealed record SelfUserProfileVehicle(Guid Id, string DisplayName, bool Active, bool Direct, IReadOnlyList<string> Groups);
public sealed record SelfUserProfileDevice(int DeviceId, bool Direct, IReadOnlyList<string> Groups);
public sealed record UpdateSelfUserProfileRequest(string? FirstName, string? LastName, string? Email);
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

using Npgsql;

public static class VehicleAccess
{
    public static async Task<bool> CanReadDeviceAsync(int deviceId, NpgsqlDataSource dataSource, VehicleAppAuthOptions options, HttpContext context, CancellationToken cancellationToken)
    {
        if (!options.Enabled || context.User.IsInRole("admin")) return true;
        if (deviceId <= 0) return false;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select exists (
              select 1 from app_users u
              where u.username = @username and u.active and (
                exists (select 1 from app_user_device_access ua where ua.user_id=u.id and ua.traccar_device_id=@deviceId)
                or exists (select 1 from app_group_memberships gm join app_group_device_access ga on ga.group_id=gm.group_id where gm.user_id=u.id and ga.traccar_device_id=@deviceId)
                or exists (
                  select 1 from vehicle_device_bindings b
                  where b.traccar_device_id=@deviceId and b.ends_at is null and (
                    exists (select 1 from app_user_vehicle_access ua where ua.user_id=u.id and ua.vehicle_id=b.vehicle_id)
                    or exists (select 1 from app_group_memberships gm join app_group_vehicle_access ga on ga.group_id=gm.group_id where gm.user_id=u.id and ga.vehicle_id=b.vehicle_id)
                  )
                )
              )
            )
            """, connection);
        command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
        command.Parameters.AddWithValue("deviceId", deviceId);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    public static async Task<HashSet<int>?> GetReadableDeviceIdsAsync(NpgsqlDataSource dataSource, VehicleAppAuthOptions options, HttpContext context, CancellationToken cancellationToken)
    {
        if (!options.Enabled || context.User.IsInRole("admin")) return null;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select distinct device_id from (
              select ua.traccar_device_id as device_id from app_user_device_access ua join app_users u on u.id=ua.user_id where u.username=@username and u.active
              union
              select ga.traccar_device_id from app_group_device_access ga join app_group_memberships gm on gm.group_id=ga.group_id join app_users u on u.id=gm.user_id where u.username=@username and u.active
              union
              select b.traccar_device_id from vehicle_device_bindings b join app_user_vehicle_access ua on ua.vehicle_id=b.vehicle_id join app_users u on u.id=ua.user_id where u.username=@username and u.active and b.ends_at is null
              union
              select b.traccar_device_id from vehicle_device_bindings b join app_group_vehicle_access ga on ga.vehicle_id=b.vehicle_id join app_group_memberships gm on gm.group_id=ga.group_id join app_users u on u.id=gm.user_id where u.username=@username and u.active and b.ends_at is null
            ) readable
            """, connection);
        command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
        var ids = new HashSet<int>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetInt32(0));
        return ids;
    }

    public static async Task<bool> CanReadTripAsync(Guid tripId, NpgsqlDataSource dataSource, VehicleAppAuthOptions options, HttpContext context, CancellationToken cancellationToken)
    {
        if (!options.Enabled || context.User.IsInRole("admin")) return true;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select exists (
              select 1 from trips t
              where t.id = @tripId and (
                exists (select 1 from app_user_vehicle_access ua join app_users u on u.id = ua.user_id where ua.vehicle_id = t.vehicle_id and u.username = @username and u.active)
                or exists (select 1 from app_group_vehicle_access ga join app_group_memberships gm on gm.group_id = ga.group_id join app_users u on u.id = gm.user_id where ga.vehicle_id = t.vehicle_id and u.username = @username and u.active)
              )
            )
            """, connection);
        command.Parameters.AddWithValue("tripId", tripId);
        command.Parameters.AddWithValue("username", context.User.Identity?.Name ?? string.Empty);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }
}

using Npgsql;

public static class VehicleAccess
{
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

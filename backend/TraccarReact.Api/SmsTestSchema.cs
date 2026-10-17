using Npgsql;

public static class SmsTestSchema
{
    public static async Task EnsureAsync(IServiceProvider services)
    {
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("SmsTestSchema");
        try
        {
            var dataSource = services.GetRequiredService<NpgsqlDataSource>();
            await using var connection = await dataSource.OpenConnectionAsync();
            await using var command = new NpgsqlCommand("""
                create table if not exists sms_test_sends (
                    id uuid primary key default gen_random_uuid(),
                    provider text not null,
                    accepted boolean not null,
                    provider_status_code integer,
                    created_at timestamptz not null default now()
                );
                create index if not exists ix_sms_test_sends_daily
                    on sms_test_sends (created_at)
                    where accepted;
                delete from sms_test_sends where created_at < now() - interval '90 days';
                """, connection);
            await command.ExecuteNonQueryAsync();
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "SMS test schema bootstrap failed. SMS test sending remains unavailable.");
        }
    }
}

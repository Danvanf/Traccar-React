using Npgsql;

public sealed class TelemetryShareCleanupService : BackgroundService
{
    private readonly NpgsqlDataSource dataSource;
    private readonly ILogger<TelemetryShareCleanupService> logger;

    public TelemetryShareCleanupService(NpgsqlDataSource dataSource, ILogger<TelemetryShareCleanupService> logger)
    {
        this.dataSource = dataSource;
        this.logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunOnceAsync(stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        while (await timer.WaitForNextTickAsync(stoppingToken)) await RunOnceAsync(stoppingToken);
    }

    private async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                update telemetry_shares set status='expired', updated_at=now()
                where status='active' and expires_at <= now();
                delete from telemetry_shares
                where status in ('expired', 'revoked')
                  and coalesce(revoked_at, expires_at) < now() - interval '30 days';
                """, connection);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Telemetry share cleanup failed");
        }
    }
}

using System.Text.Json;
using Npgsql;

public sealed class ProviderAccountStore(NpgsqlDataSource dataSource, CredentialProtectionService protection)
{
    public async Task<ResolvedProviderAccount?> GetDefaultAsync(string channel, CancellationToken cancellationToken)
    {
        if (channel is not ("email" or "sms")) throw new ArgumentOutOfRangeException(nameof(channel));
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select id, channel, provider, name, enabled, settings::text, revision
            from provider_accounts where channel = @channel and is_default limit 1
            """, connection);
        command.Parameters.AddWithValue("channel", channel);
        return await LoadAccountAsync(connection, command, cancellationToken);
    }

    public async Task<ResolvedProviderAccount?> GetByIdAsync(Guid accountId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select id, channel, provider, name, enabled, settings::text, revision
            from provider_accounts where id = @id
            """, connection);
        command.Parameters.AddWithValue("id", accountId);
        return await LoadAccountAsync(connection, command, cancellationToken);
    }

    private async Task<ResolvedProviderAccount?> LoadAccountAsync(NpgsqlConnection connection, NpgsqlCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var account = new ResolvedProviderAccount(
            reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetBoolean(4),
            JsonSerializer.Deserialize<Dictionary<string, string?>>(reader.GetString(5)) ?? [],
            reader.GetInt32(6), new Dictionary<string, string>(StringComparer.Ordinal), null);
        await reader.DisposeAsync();
        await using var secrets = new NpgsqlCommand("select secret_name, encrypted_value from provider_account_secrets where account_id = @id", connection);
        secrets.Parameters.AddWithValue("id", account.Id);
        await using var secretReader = await secrets.ExecuteReaderAsync(cancellationToken);
        var plaintext = new Dictionary<string, string>(StringComparer.Ordinal);
        string? error = null;
        while (await secretReader.ReadAsync(cancellationToken))
        {
            var name = secretReader.GetString(0);
            try { plaintext[name] = protection.Unprotect(account.Id, name, secretReader.GetString(1)); }
            catch (CredentialProtectionException exception) { error = exception.Message; break; }
        }
        return account with { Secrets = plaintext, ConfigurationError = error };
    }
}

public sealed record ResolvedProviderAccount(
    Guid Id,
    string Channel,
    string Provider,
    string Name,
    bool Enabled,
    Dictionary<string, string?> Settings,
    int Revision,
    Dictionary<string, string> Secrets,
    string? ConfigurationError);

using Npgsql;

public static class ProviderAccountSchema
{
    public static async Task EnsureAsync(IServiceProvider services)
    {
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("ProviderAccountSchema");
        try
        {
            var dataSource = services.GetRequiredService<NpgsqlDataSource>();
            await using var connection = await dataSource.OpenConnectionAsync();
            await using var command = new NpgsqlCommand("""
                create table if not exists provider_accounts (
                    id uuid primary key,
                    channel text not null check (channel in ('email', 'sms')),
                    provider text not null check (provider in ('Graph', 'Resend', 'Brevo', 'Twilio', 'Textbelt')),
                    name text not null check (length(name) between 1 and 100),
                    enabled boolean not null default true,
                    is_default boolean not null default false,
                    settings jsonb not null default '{}'::jsonb,
                    legacy_source_key text,
                    revision integer not null default 1 check (revision > 0),
                    created_at timestamptz not null default now(),
                    updated_at timestamptz not null default now(),
                    check ((channel = 'email' and provider in ('Graph', 'Resend', 'Brevo'))
                        or (channel = 'sms' and provider in ('Twilio', 'Textbelt')))
                );
                create unique index if not exists provider_accounts_one_default_per_channel
                    on provider_accounts (channel) where is_default;
                alter table provider_accounts add column if not exists legacy_source_key text;
                create unique index if not exists provider_accounts_legacy_source_key
                    on provider_accounts (legacy_source_key) where legacy_source_key is not null;
                create unique index if not exists provider_accounts_legacy_source_key_v2
                    on provider_accounts (legacy_source_key) where legacy_source_key is not null;

                create table if not exists provider_account_secrets (
                    account_id uuid not null references provider_accounts(id) on delete cascade,
                    secret_name text not null check (secret_name ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'),
                    encrypted_value text not null,
                    updated_at timestamptz not null default now(),
                    primary key (account_id, secret_name)
                );

                create table if not exists vehicle_provider_accounts (
                    vehicle_id uuid not null references vehicles(id) on delete cascade,
                    channel text not null check (channel in ('email', 'sms')),
                    account_id uuid not null references provider_accounts(id) on delete restrict,
                    updated_at timestamptz not null default now(),
                    primary key (vehicle_id, channel)
                );

                create table if not exists provider_account_audit (
                    id bigint generated always as identity primary key,
                    account_id uuid not null,
                    actor text not null,
                    action text not null check (action in ('created', 'updated', 'disabled')),
                    changed_fields text[] not null default '{}',
                    occurred_at timestamptz not null default now()
                );
                create index if not exists provider_account_audit_account_time
                    on provider_account_audit (account_id, occurred_at desc);
                """, connection);
            await command.ExecuteNonQueryAsync();
            logger.LogInformation("Provider account schema bootstrap completed.");
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Provider account schema bootstrap failed.");
            throw;
        }
    }
}

using Npgsql;

public static class EmailAlertSchema
{
    public static async Task EnsureAsync(IServiceProvider services)
    {
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("EmailAlertSchema");
        try
        {
            var dataSource = services.GetRequiredService<NpgsqlDataSource>();
            await using var connection = await dataSource.OpenConnectionAsync();
            await using var command = new NpgsqlCommand("""
                create table if not exists email_alert_preferences (
                    user_id uuid primary key references app_users(id) on delete cascade,
                    email text not null,
                    verified_at timestamptz,
                    enabled boolean not null default false,
                    event_types text[] not null default '{}',
                    vehicle_ids uuid[] not null default '{}',
                    daily_limit integer not null default 10 check (daily_limit between 1 and 50),
                    quiet_start_minute integer,
                    quiet_end_minute integer,
                    quiet_delivery_mode text not null default 'suppress' check (quiet_delivery_mode in ('suppress', 'digest')),
                    time_zone_id text not null default 'UTC',
                    updated_at timestamptz not null default now()
                );

                alter table email_alert_preferences add column if not exists quiet_start_minute integer;
                alter table email_alert_preferences add column if not exists quiet_end_minute integer;
                alter table email_alert_preferences add column if not exists quiet_delivery_mode text not null default 'suppress';
                alter table email_alert_preferences drop constraint if exists email_alert_preferences_quiet_delivery_mode_check;
                alter table email_alert_preferences add constraint email_alert_preferences_quiet_delivery_mode_check check (quiet_delivery_mode in ('suppress', 'digest'));
                alter table email_alert_preferences add column if not exists time_zone_id text not null default 'UTC';

                create table if not exists vehicle_app_email_settings (
                    id smallint primary key default 1 check (id = 1),
                    default_sender_user_id text not null default '',
                    updated_at timestamptz not null default now()
                );
                insert into vehicle_app_email_settings (id) values (1) on conflict (id) do nothing;

                create table if not exists vehicle_email_senders (
                    vehicle_id uuid primary key references vehicles(id) on delete cascade,
                    sender_user_id text not null,
                    updated_at timestamptz not null default now()
                );

                create table if not exists email_alert_verification (
                    user_id uuid primary key references app_users(id) on delete cascade,
                    email text not null,
                    code_salt text not null,
                    code_hash text not null,
                    expires_at timestamptz not null,
                    attempts integer not null default 0
                );

                create table if not exists email_alert_outbox (
                    id uuid primary key default gen_random_uuid(),
                    event_id uuid references trip_events(id) on delete set null,
                    trip_id uuid not null,
                    vehicle_id uuid not null,
                    event_type text not null,
                    source text not null,
                    occurred_at timestamptz not null,
                    user_id uuid not null references app_users(id) on delete cascade,
                    recipient_email text not null,
                    provider_account_id uuid references provider_accounts(id) on delete restrict,
                    sender_user_id text,
                    status text not null default 'queued' check (status in ('queued', 'sending', 'digest_pending', 'accepted', 'failed', 'cancelled')),
                    attempts integer not null default 0,
                    next_attempt_at timestamptz not null default now(),
                    accepted_at timestamptz,
                    provider_status_code integer,
                    last_provider text,
                    last_error text,
                    delivery_units smallint not null default 1,
                    created_at timestamptz not null default now(),
                    unique (user_id, trip_id, event_type, occurred_at, source)
                );
                alter table email_alert_outbox add column if not exists last_provider text;
                alter table email_alert_outbox add column if not exists provider_account_id uuid references provider_accounts(id) on delete restrict;
                alter table email_alert_outbox drop constraint if exists email_alert_outbox_provider_account_id_fkey;
                alter table email_alert_outbox add constraint email_alert_outbox_provider_account_id_fkey
                    foreign key (provider_account_id) references provider_accounts(id) on delete restrict;
                alter table email_alert_outbox add column if not exists sender_user_id text;
                alter table email_alert_outbox add column if not exists delivery_units smallint not null default 1;
                alter table email_alert_outbox add column if not exists provider_message_id text;
                alter table email_alert_outbox add column if not exists provider_batch_id uuid;
                alter table email_alert_outbox add column if not exists delivery_status text not null default 'pending';
                alter table email_alert_outbox add column if not exists delivery_updated_at timestamptz;
                alter table email_alert_outbox drop constraint if exists email_alert_outbox_delivery_status_check;
                alter table email_alert_outbox add constraint email_alert_outbox_delivery_status_check
                    check (delivery_status in ('pending', 'delivered', 'delayed', 'bounced', 'complained', 'failed', 'suppressed'));
                alter table email_alert_outbox drop constraint if exists email_alert_outbox_status_check;
                alter table email_alert_outbox add constraint email_alert_outbox_status_check check (status in ('queued', 'sending', 'digest_pending', 'accepted', 'failed', 'cancelled'));

                create table if not exists email_alert_provider_events (
                    provider text not null,
                    provider_event_id text not null,
                    provider_message_id text not null,
                    event_type text not null,
                    delivery_status text not null,
                    provider_event_at timestamptz,
                    received_at timestamptz not null default now(),
                    primary key (provider, provider_event_id)
                );
                create index if not exists ix_email_alert_provider_events_message
                    on email_alert_provider_events (provider, provider_message_id, provider_event_at desc nulls last, received_at desc);
                create index if not exists ix_email_alert_outbox_provider_message
                    on email_alert_outbox (last_provider, provider_message_id)
                    where provider_message_id is not null;

                create table if not exists email_alert_manual_retries (
                    id bigserial primary key,
                    outbox_id uuid not null references email_alert_outbox(id) on delete cascade,
                    administrator text not null,
                    prior_reason text not null,
                    provider_batch_id uuid,
                    requested_at timestamptz not null default now()
                );
                alter table email_alert_manual_retries add column if not exists provider_batch_id uuid;

                create index if not exists ix_email_alert_outbox_due
                    on email_alert_outbox (next_attempt_at, created_at)
                    where status in ('queued', 'sending', 'digest_pending');
                create index if not exists ix_email_alert_outbox_digest_due
                    on email_alert_outbox (next_attempt_at, created_at)
                    where status = 'digest_pending';
                create index if not exists ix_email_alert_outbox_daily
                    on email_alert_outbox (user_id, accepted_at)
                    where accepted_at is not null;

                create or replace function enqueue_trip_event_email_alerts() returns trigger
                language plpgsql as $function$
                begin
                    -- Historical imports and trip recalculations must not produce old alerts.
                    if new.occurred_at < now() - interval '1 hour'
                        or new.occurred_at > now() + interval '5 minutes' then
                        return new;
                    end if;

                    insert into email_alert_outbox
                        (event_id, trip_id, vehicle_id, event_type, source, occurred_at, user_id, recipient_email, provider_account_id, sender_user_id)
                    select new.id, new.trip_id, new.vehicle_id, new.event_type,
                           new.source, new.occurred_at, p.user_id, p.email,
                           coalesce(
                               (select account_id from vehicle_provider_accounts where vehicle_id = new.vehicle_id and channel = 'email'),
                               (select id from provider_accounts where channel = 'email' and is_default limit 1)),
                           coalesce(nullif(vs.sender_user_id, ''), nullif(es.default_sender_user_id, ''), '')
                    from email_alert_preferences p
                    join app_users u on u.id = p.user_id
                    cross join vehicle_app_email_settings es
                    left join vehicle_email_senders vs on vs.vehicle_id = new.vehicle_id
                    where p.enabled and p.verified_at is not null and u.active
                      and new.event_type = any(p.event_types)
                      and (cardinality(p.vehicle_ids) = 0 or new.vehicle_id = any(p.vehicle_ids))
                      and (u.role = 'admin'
                           or exists (select 1 from app_user_vehicle_access a where a.user_id = u.id and a.vehicle_id = new.vehicle_id)
                           or exists (select 1 from app_group_memberships m
                                      join app_group_vehicle_access a on a.group_id = m.group_id
                                      where m.user_id = u.id and a.vehicle_id = new.vehicle_id))
                    on conflict (user_id, trip_id, event_type, occurred_at, source)
                    do update set event_id = excluded.event_id
                    where email_alert_outbox.status = 'queued';
                    return new;
                end;
                $function$;

                drop trigger if exists trg_enqueue_trip_event_email_alerts on trip_events;
                create trigger trg_enqueue_trip_event_email_alerts
                    after insert on trip_events
                    for each row execute function enqueue_trip_event_email_alerts();
                """, connection);
            await command.ExecuteNonQueryAsync();
            logger.LogInformation("Email alert schema bootstrap completed.");
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Email alert schema bootstrap failed. Email alerts remain unavailable until the schema is applied.");
        }
    }
}

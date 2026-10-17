using Npgsql;

public static class SmsAlertSchema
{
    public static async Task EnsureAsync(IServiceProvider services)
    {
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("SmsAlertSchema");
        try
        {
            var dataSource = services.GetRequiredService<NpgsqlDataSource>();
            await using var connection = await dataSource.OpenConnectionAsync();
            await using var command = new NpgsqlCommand("""
                create table if not exists sms_alert_preferences (
                    user_id uuid primary key references app_users(id) on delete cascade,
                    phone text not null,
                    verified_at timestamptz,
                    enabled boolean not null default false,
                    event_types text[] not null default '{}',
                    vehicle_ids uuid[] not null default '{}',
                    daily_limit integer not null default 5 check (daily_limit between 1 and 25),
                    stopped_at timestamptz,
                    updated_at timestamptz not null default now()
                );

                create table if not exists sms_alert_verification (
                    user_id uuid primary key references app_users(id) on delete cascade,
                    phone text not null,
                    code_salt text not null,
                    code_hash text not null,
                    expires_at timestamptz not null,
                    attempts integer not null default 0,
                    requested_at timestamptz not null default now(),
                    request_day date not null default (now() at time zone 'utc')::date,
                    requests_today integer not null default 1
                );

                create table if not exists sms_alert_outbox (
                    id uuid primary key default gen_random_uuid(),
                    event_id uuid references trip_events(id) on delete set null,
                    trip_id uuid not null,
                    vehicle_id uuid not null,
                    event_type text not null,
                    source text not null,
                    occurred_at timestamptz not null,
                    user_id uuid not null references app_users(id) on delete cascade,
                    recipient_phone text not null,
                    provider_account_id uuid references provider_accounts(id) on delete restrict,
                    status text not null default 'queued' check (status in ('queued', 'sending', 'accepted', 'failed', 'cancelled')),
                    attempts integer not null default 0,
                    next_attempt_at timestamptz not null default now(),
                    accepted_at timestamptz,
                    provider_status_code integer,
                    provider_message_id text,
                    provider_error_code integer,
                    delivery_status text not null default 'pending' check (delivery_status in ('pending', 'queued', 'sent', 'delivered', 'undelivered', 'failed')),
                    last_provider text,
                    last_error text,
                    created_at timestamptz not null default now(),
                    unique (user_id, trip_id, event_type, occurred_at, source)
                );

                create index if not exists ix_sms_alert_outbox_due
                    on sms_alert_outbox (next_attempt_at, created_at) where status in ('queued', 'sending');
                create index if not exists ix_sms_alert_outbox_daily
                    on sms_alert_outbox (user_id, accepted_at) where accepted_at is not null;
                create index if not exists ix_sms_alert_outbox_provider_message
                    on sms_alert_outbox (provider_message_id) where provider_message_id is not null;
                alter table sms_alert_outbox add column if not exists provider_error_code integer;
                alter table sms_alert_outbox add column if not exists provider_account_id uuid references provider_accounts(id) on delete restrict;
                alter table sms_alert_outbox drop constraint if exists sms_alert_outbox_provider_account_id_fkey;
                alter table sms_alert_outbox add constraint sms_alert_outbox_provider_account_id_fkey
                    foreign key (provider_account_id) references provider_accounts(id) on delete restrict;

                create table if not exists sms_alert_inbound_events (
                    message_sid text primary key,
                    sender_phone text not null,
                    destination_phone text not null,
                    opt_out_type text not null check (opt_out_type in ('STOP', 'START', 'HELP')),
                    received_at timestamptz not null default now()
                );

                create table if not exists sms_alert_status_events (
                    id bigserial primary key,
                    message_sid text not null,
                    delivery_status text not null,
                    provider_error_code integer,
                    received_at timestamptz not null default now(),
                    unique (message_sid, delivery_status)
                );
                create index if not exists ix_sms_alert_status_events_sid
                    on sms_alert_status_events (message_sid, received_at desc);

                create or replace function enqueue_trip_event_sms_alerts() returns trigger
                language plpgsql as $function$
                begin
                    if new.occurred_at < now() - interval '1 hour'
                        or new.occurred_at > now() + interval '5 minutes' then
                        return new;
                    end if;

                    insert into sms_alert_outbox
                        (event_id, trip_id, vehicle_id, event_type, source, occurred_at, user_id, recipient_phone, provider_account_id)
                    select new.id, new.trip_id, new.vehicle_id, new.event_type,
                           new.source, new.occurred_at, p.user_id, p.phone,
                           coalesce(
                               (select account_id from vehicle_provider_accounts where vehicle_id = new.vehicle_id and channel = 'sms'),
                               (select id from provider_accounts where channel = 'sms' and is_default limit 1))
                    from sms_alert_preferences p
                    join app_users u on u.id = p.user_id
                    where p.enabled and p.verified_at is not null and p.stopped_at is null and u.active
                      and new.event_type = any(p.event_types)
                      and (cardinality(p.vehicle_ids) = 0 or new.vehicle_id = any(p.vehicle_ids))
                      and (u.role = 'admin'
                           or exists (select 1 from app_user_vehicle_access a where a.user_id = u.id and a.vehicle_id = new.vehicle_id)
                           or exists (select 1 from app_group_memberships m
                                      join app_group_vehicle_access a on a.group_id = m.group_id
                                      where m.user_id = u.id and a.vehicle_id = new.vehicle_id))
                    on conflict (user_id, trip_id, event_type, occurred_at, source)
                    do nothing;
                    return new;
                end;
                $function$;

                drop trigger if exists trg_enqueue_trip_event_sms_alerts on trip_events;
                create trigger trg_enqueue_trip_event_sms_alerts
                    after insert on trip_events
                    for each row execute function enqueue_trip_event_sms_alerts();
                """, connection);
            await command.ExecuteNonQueryAsync();
            logger.LogInformation("SMS alert schema bootstrap completed.");
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "SMS alert schema bootstrap failed. Automatic SMS alerts remain unavailable until the schema is applied.");
        }
    }
}

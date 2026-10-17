-- Phase: secure Trip Telemetry Graph sharing foundation.
-- Additive migration. Run against traccar_react_api with:
--   psql -U traccar -d traccar_react_api -f phase_telemetry_sharing_schema.sql
--
-- The public URL token is never stored. The API stores only token_hash.
begin;

create table if not exists telemetry_shares (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  owner_user_id uuid not null references app_users(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id),
  mode text not null check (mode in ('graph', 'range')),
  title text,
  message text,
  vehicle_label_snapshot text not null,
  from_utc timestamptz not null,
  through_utc timestamptz not null,
  time_zone text not null,
  allow_export boolean not null default false,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  access_count bigint not null default 0,
  snapshot_version integer not null default 1,
  check (length(title) <= 200),
  check (length(message) <= 2000),
  check (length(time_zone) <= 100),
  check (through_utc > from_utc),
  check (expires_at > created_at)
);

create index if not exists ix_telemetry_shares_owner_created
  on telemetry_shares (owner_user_id, created_at desc);
create index if not exists ix_telemetry_shares_status_expiry
  on telemetry_shares (status, expires_at);

create table if not exists telemetry_share_trips (
  share_id uuid not null references telemetry_shares(id) on delete cascade,
  source_trip_id uuid references trips(id) on delete set null,
  trip_key uuid not null,
  display_order integer not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer,
  distance_meters double precision,
  summary_snapshot jsonb not null default '{}'::jsonb,
  primary key (share_id, trip_key),
  check (display_order >= 0),
  check (ended_at >= started_at)
);

create index if not exists ix_telemetry_share_trips_source
  on telemetry_share_trips (source_trip_id);

create table if not exists telemetry_share_series (
  share_id uuid not null references telemetry_shares(id) on delete cascade,
  field_key text not null,
  label_snapshot text not null,
  unit_snapshot text,
  color text not null,
  display_order integer not null,
  primary key (share_id, field_key),
  check (length(field_key) between 1 and 200),
  check (length(label_snapshot) between 1 and 200),
  check (length(unit_snapshot) <= 50),
  check (color ~ '^#[0-9a-fA-F]{6}$'),
  check (display_order >= 0)
);

create table if not exists telemetry_share_points (
  share_id uuid not null,
  trip_key uuid not null,
  point_index integer not null,
  occurred_at timestamptz not null,
  elapsed_milliseconds bigint not null,
  point_values jsonb not null default '{}'::jsonb,
  primary key (share_id, trip_key, point_index),
  foreign key (share_id, trip_key)
    references telemetry_share_trips(share_id, trip_key)
    on delete cascade,
  check (point_index >= 0),
  check (elapsed_milliseconds >= 0),
  check (jsonb_typeof(point_values) = 'object')
);

create index if not exists ix_telemetry_share_points_trip_time
  on telemetry_share_points (share_id, trip_key, occurred_at);

create table if not exists telemetry_share_audit (
  id bigserial primary key,
  share_id uuid not null references telemetry_shares(id) on delete cascade,
  actor_user_id uuid references app_users(id) on delete set null,
  action text not null,
  occurred_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  check (length(action) between 1 and 80)
);

create index if not exists ix_telemetry_share_audit_share_time
  on telemetry_share_audit (share_id, occurred_at desc);

commit;

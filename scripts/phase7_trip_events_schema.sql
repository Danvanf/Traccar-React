-- Phase 7 trip-event and threshold foundation.
-- Safe to rerun; creates additive application tables in the active schema.

create table if not exists trip_event_thresholds (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'system', 'vehicle')),
  vehicle_id uuid references vehicles(id) on delete cascade,
  event_type text not null,
  threshold_value double precision not null,
  unit text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'vehicle' and vehicle_id is not null) or (scope in ('global', 'system') and vehicle_id is null))
);

create unique index if not exists ux_trip_event_threshold_scope
  on trip_event_thresholds (scope, coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type);

create table if not exists trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  traccar_device_id integer not null,
  event_type text not null,
  source text not null check (source in ('traccar', 'obd2', 'calculated')),
  occurred_at timestamptz not null,
  traccar_position_id bigint,
  latitude double precision,
  longitude double precision,
  measured_value double precision,
  threshold_value double precision,
  unit text,
  severity text,
  raw_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_trip_events_identity
  on trip_events (trip_id, event_type, occurred_at, source);

create index if not exists ix_trip_events_trip_occurred
  on trip_events (trip_id, occurred_at desc);

create index if not exists ix_trip_events_vehicle_type_occurred
  on trip_events (vehicle_id, event_type, occurred_at desc);

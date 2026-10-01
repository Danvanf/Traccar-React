-- Phase 8: durable identities for Bouncie trip-summary imports.
-- Run against vehicle_app. Safe to rerun.

create table if not exists trip_external_identities (
  source_system text not null,
  external_key text not null,
  trip_id uuid not null references trips(id) on delete cascade,
  imported_at timestamptz not null default now(),
  primary key (source_system, external_key),
  unique (source_system, trip_id)
);

create index if not exists ix_trip_external_identities_trip
  on trip_external_identities (trip_id);

alter table trip_events drop constraint if exists trip_events_source_check;
alter table trip_events add constraint trip_events_source_check
  check (source in ('traccar', 'obd2', 'calculated', 'bouncie'));

alter table trips add column if not exists start_latitude double precision;
alter table trips add column if not exists start_longitude double precision;
alter table trips add column if not exists end_latitude double precision;
alter table trips add column if not exists end_longitude double precision;
alter table trips add column if not exists start_address text;
alter table trips add column if not exists end_address text;
alter table trips add column if not exists external_metadata jsonb not null default '{}'::jsonb;

create table if not exists trip_route_points (
  trip_id uuid not null references trips(id) on delete cascade,
  point_index integer not null,
  occurred_at timestamptz,
  latitude double precision not null,
  longitude double precision not null,
  speed_mph double precision,
  raw_evidence jsonb not null default '{}'::jsonb,
  primary key (trip_id, point_index)
);

create index if not exists ix_trip_route_points_trip
  on trip_route_points (trip_id, point_index);

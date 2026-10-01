-- Phase 5 extension: DTC enrichment tables for vehicle_app
-- Run against the vehicle_app database.

create table if not exists dtc_catalog (
  code text primary key,
  description text,
  severity text,
  category text,
  source text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists dtc_events (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  trip_id uuid references trips(id) on delete set null,
  traccar_device_id integer not null,
  code text not null references dtc_catalog(code),
  status text,
  detected_at timestamptz not null,
  source_position_id bigint,
  source_event_id bigint,
  raw_payload jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists ix_dtc_events_vehicle_detected
on dtc_events (vehicle_id, detected_at desc);

create index if not exists ix_dtc_events_device_detected
on dtc_events (traccar_device_id, detected_at desc);

create index if not exists ix_dtc_events_trip
on dtc_events (trip_id, detected_at desc);

-- Phase 5 trip derivation metadata.
-- Run against the vehicle_app database. This is additive and does not rewrite trips.
\set ON_ERROR_STOP on
alter table if exists trips add column if not exists derivation_version text;
create index if not exists ix_trips_derivation_version
  on trips (traccar_device_id, derivation_version, started_at desc)
  where derivation_version is not null;

-- Apply while connected to the vehicle_app DATABASE, using the app's search_path.
-- This protects exact identities against writers outside the serialized API too.
-- Existing duplicates must be reconciled first; this script never merges/deletes trips.
-- Overlap detection remains the responsibility of the import API.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '10s';
lock table trips in share row exclusive mode;
do $$
begin
  if exists (
    select 1 from trips where traccar_source_id is null
    group by traccar_device_id, started_at, ended_at having count(*) > 1
  ) then
    raise exception 'Duplicate trip identities exist. Reconcile them before applying the index; no trip data has been changed.';
  end if;
end $$;
create unique index if not exists ux_trips_default_source_identity
  on trips (traccar_device_id, started_at, ended_at)
  where traccar_source_id is null;
commit;

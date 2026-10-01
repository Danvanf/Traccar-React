-- Phase 6 retention support for vehicle_app.
-- The live application currently uses the public schema, so table names are
-- intentionally unqualified and follow the connection's active search_path.
-- Default approach: archive old trips to trips_archive, then delete from trips.
-- This script is intentionally safe-by-default: verify counts first, run archive/delete in a transaction,
-- and choose COMMIT explicitly.

-- 1) Preflight: age profile for trips
select
  count(*) as total_trips,
  min(started_at) as oldest_trip_utc,
  max(started_at) as newest_trip_utc
from trips;

-- Suggested default retention cutoffs:
--   hot retention (query-optimized in main table): 24 months
--   archive retention (optional long-term): keep all archived rows unless storage pressure requires pruning

-- Rows older than 24 months in main table:
select
  count(*) as trips_older_than_24_months
from trips
where started_at < now() - interval '24 months';

-- 2) Ensure archive table exists
create table if not exists trips_archive (
  like trips including all,
  archived_at timestamptz not null default now()
);

create index if not exists ix_trips_archive_started_at
  on trips_archive (started_at desc);

create index if not exists ix_trips_archive_vehicle_started
  on trips_archive (vehicle_id, started_at desc);

-- Preserve trip/tag relationships before deleting source trips. The live
-- trip_tags table has a foreign key to trips and would otherwise cascade-delete
-- these relationships.
create table if not exists trip_tags_archive (
  trip_id uuid not null,
  tag_id uuid not null,
  archived_at timestamptz not null default now(),
  primary key (trip_id, tag_id)
);

-- 3) Archive + delete (copy this block and run during low-traffic windows)
-- Tip: run in batches by changing LIMIT to 5k/10k rows for large datasets.
--
-- begin;
--
-- insert into trip_tags_archive (trip_id, tag_id)
-- select trip_id, tag_id from trip_tags
-- where trip_id in (
--   select id from trips
--   where started_at < now() - interval '24 months'
--   order by started_at asc limit 10000
-- )
-- on conflict (trip_id, tag_id) do nothing;
--
-- with moved as (
--   delete from trips
--   where id in (
--     select id
--     from trips
--     where started_at < now() - interval '24 months'
--     order by started_at asc
--     limit 10000
--   )
--   returning *
-- )
-- insert into trips_archive (
--   id,
--   vehicle_id,
--   traccar_device_id,
--   started_at,
--   ended_at,
--   duration_seconds,
--   distance_meters,
--   avg_speed_mph,
--   max_speed_mph,
--   idle_seconds,
--   fuel_used_gallons,
--   estimated_mpg,
--   start_traccar_position_id,
--   end_traccar_position_id,
--   start_label,
--   end_label,
--   derivation_version,
--   notes,
--   created_at,
--   archived_at
-- )
-- select
--   id,
--   vehicle_id,
--   traccar_device_id,
--   started_at,
--   ended_at,
--   duration_seconds,
--   distance_meters,
--   avg_speed_mph,
--   max_speed_mph,
--   idle_seconds,
--   fuel_used_gallons,
--   estimated_mpg,
--   start_traccar_position_id,
--   end_traccar_position_id,
--   start_label,
--   end_label,
--   derivation_version,
--   notes,
--   created_at,
--   now()
-- from moved;
--
-- -- verify moved rows before commit
-- select count(*) as archive_total from trips_archive;
--
-- -- commit;
-- rollback;

-- 4) Post-run checks
select
  count(*) as trips_remaining,
  min(started_at) as remaining_oldest_trip_utc,
  max(started_at) as remaining_newest_trip_utc
from trips;

select
  count(*) as archive_rows,
  min(started_at) as archive_oldest_trip_utc,
  max(started_at) as archive_newest_trip_utc
from trips_archive;

-- Read-only audit of the Bouncie REST import range selected in Settings.
-- This run uses the posted range. Edit these three psql variables for another run.
\set requested_from '2000-01-01'
\set requested_through '2021-12-31'
\set current_importer_version 3

\echo Bouncie REST trips actually saved, grouped by year and vehicle
select v.display_name,
       extract(year from t.started_at at time zone 'UTC')::int as year_utc,
       count(*) as saved_trips,
       min(t.started_at at time zone 'UTC') as first_trip_utc,
       max(t.started_at at time zone 'UTC') as last_trip_utc
from trips t
join vehicles v on v.id = t.vehicle_id
where t.external_metadata ->> 'source' = 'bouncie-rest-v1'
  and t.started_at < (:'requested_through'::date + 1)::timestamp at time zone 'UTC'
  and t.ended_at >= :'requested_from'::date::timestamp at time zone 'UTC'
group by v.display_name, year_utc
order by v.display_name, year_utc;

\echo Completed Bouncie request windows overlapping the requested range
with requested as (
  select greatest(:'requested_from'::date, date '2020-05-21')::timestamp at time zone 'UTC' as from_utc,
         (:'requested_through'::date + 1)::timestamp at time zone 'UTC' as through_utc
), windows as (
  select c.vehicle_imei,
         greatest(c.window_from, r.from_utc) as window_from,
         least(c.window_through, r.through_utc) as window_through,
         c.imported_count,
         c.skipped_count,
         c.importer_version
  from bouncie_import_checkpoints c
  cross join requested r
  where c.window_through > r.from_utc
    and c.window_from < r.through_utc
    and least(c.window_through, r.through_utc) > greatest(c.window_from, r.from_utc)
    and (c.imported_count > 0 or c.skipped_count > 0 or c.imported_events > 0)
)
select vehicle_imei,
       count(*) filter (where importer_version >= :current_importer_version) as current_version_windows,
       count(*) as all_version_windows,
       coalesce(sum(imported_count), 0) as imported_trip_count,
       coalesce(sum(skipped_count), 0) as deduplicated_trip_count,
       min(window_from at time zone 'UTC') as first_window_utc,
       max(window_through at time zone 'UTC') as last_window_utc
from windows
group by vehicle_imei
order by vehicle_imei;

\echo Missing intervals between current-version completed windows (if none are returned, checkpoint coverage is continuous)
with requested as (
  select greatest(:'requested_from'::date, date '2020-05-21')::timestamp at time zone 'UTC' as from_utc,
         (:'requested_through'::date + 1)::timestamp at time zone 'UTC' as through_utc
), windows as (
  select c.vehicle_imei,
         greatest(c.window_from, r.from_utc) as window_from,
         least(c.window_through, r.through_utc) as window_through
  from bouncie_import_checkpoints c
  cross join requested r
  where c.importer_version >= :current_importer_version
    and c.window_through > r.from_utc
    and c.window_from < r.through_utc
    and least(c.window_through, r.through_utc) > greatest(c.window_from, r.from_utc)
    and (c.imported_count > 0 or c.skipped_count > 0 or c.imported_events > 0)
), known_vehicles as (
  select distinct vehicle_imei from bouncie_import_checkpoints
), ordered as (
  select *,
         max(window_through) over (
           partition by vehicle_imei
           order by window_from, window_through
           rows between unbounded preceding and 1 preceding
         ) as previously_covered_through
  from windows
), internal_gaps as (
  select vehicle_imei, previously_covered_through as missing_from, window_from as missing_through
  from ordered
  where previously_covered_through is not null
    and window_from > previously_covered_through
), edge_gaps as (
  select v.vehicle_imei, r.from_utc as missing_from, coalesce(min(w.window_from), r.through_utc) as missing_through
  from known_vehicles v cross join requested r
  left join windows w on w.vehicle_imei = v.vehicle_imei
  group by v.vehicle_imei, r.from_utc, r.through_utc
  having min(w.window_from) is null or min(w.window_from) > r.from_utc
  union all
  select v.vehicle_imei, max(w.window_through), r.through_utc
  from known_vehicles v cross join requested r
  join windows w on w.vehicle_imei = v.vehicle_imei
  group by v.vehicle_imei, r.through_utc
  having max(w.window_through) < r.through_utc
)
select vehicle_imei,
       missing_from at time zone 'UTC' as missing_from_utc,
       missing_through at time zone 'UTC' as missing_through_utc
from (
  select * from internal_gaps
  union all
  select * from edge_gaps
) gaps
order by vehicle_imei, missing_from;

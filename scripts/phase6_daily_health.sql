-- Phase 6 read-only daily health report for vehicle_app.
-- Run against vehicle_app; this script does not modify data.

select 'trips' as metric,
       count(*) filter (where created_at >= now() - interval '24 hours') as created_last_24h,
       count(*) filter (where started_at >= now() - interval '7 days') as started_last_7d,
       max(created_at) as newest_created_at,
       max(started_at) as newest_started_at
from vehicle_app.trips;

select 'dtc_events' as metric,
       count(*) filter (where created_at >= now() - interval '24 hours') as created_last_24h,
       count(*) filter (where detected_at >= now() - interval '7 days') as detected_last_7d,
       count(*) filter (where status is not null and status <> '') as with_status,
       max(created_at) as newest_created_at
from vehicle_app.dtc_events;

select coalesce(v.display_name, v.id::text) as vehicle,
       count(t.id) filter (where t.created_at >= now() - interval '24 hours') as trips_created_last_24h,
       max(t.created_at) as newest_trip_created_at
from vehicle_app.vehicles v
left join vehicle_app.trips t on t.vehicle_id = v.id
group by v.id, v.display_name
order by vehicle;

-- Warning candidates: active vehicles with no trip created in the last 24 hours.
select coalesce(v.display_name, v.id::text) as vehicle,
       'no trip import in last 24 hours' as warning
from vehicle_app.vehicles v
where not exists (
  select 1 from vehicle_app.trips t
  where t.vehicle_id = v.id
    and t.created_at >= now() - interval '24 hours'
);

-- Read-only audit for the live vehicle_app database.
-- Run with: psql -U traccar -d vehicle_app -f vehicle_app_live_audit.sql

select current_database() as database_name, current_schema() as schema_name;

select table_name
from information_schema.tables
where table_schema = current_schema()
  and table_name in ('vehicles', 'vehicle_device_bindings', 'trips', 'trip_tags', 'trip_tag_map', 'trip_events', 'trip_event_thresholds')
order by table_name;

select 'vehicles' as table_name, count(*) as row_count from vehicles
union all select 'vehicle_device_bindings', count(*) from vehicle_device_bindings
union all select 'trips', count(*) from trips
union all select 'trip_events', count(*) from trip_events;

select v.id, v.display_name, v.active, count(b.id) as active_bindings
from vehicles v
left join vehicle_device_bindings b on b.vehicle_id = v.id and b.ends_at is null
group by v.id, v.display_name, v.active
order by v.display_name, v.id;

select traccar_device_id, started_at, ended_at, count(*) as duplicate_count,
       array_agg(id order by id) as trip_ids
from trips
group by traccar_device_id, started_at, ended_at
having count(*) > 1
order by traccar_device_id, started_at;

select a.traccar_device_id, a.id as first_trip_id, b.id as second_trip_id,
       a.started_at as first_start, a.ended_at as first_end,
       b.started_at as second_start, b.ended_at as second_end
from trips a
join trips b on a.traccar_device_id = b.traccar_device_id
  and a.id < b.id
  and a.started_at < b.ended_at
  and a.ended_at > b.started_at
order by a.traccar_device_id, a.started_at;

select indexname, indexdef
from pg_indexes
where schemaname = current_schema()
  and tablename in ('trips', 'vehicle_device_bindings', 'trip_events')
order by tablename, indexname;

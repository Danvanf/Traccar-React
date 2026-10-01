-- Remove every saved trip that started before September 23, 2026 UTC.
-- This includes trips that incorrectly span the cutoff date.

begin;

create temporary table cleanup_trip_ids on commit drop as
select id
from trips
where started_at < timestamptz '2026-09-23 00:00:00+00';

select count(*) as trips_to_delete,
       min(t.started_at) as oldest_trip_utc,
       max(t.ended_at) as newest_deleted_trip_utc
from trips t
join cleanup_trip_ids c on c.id = t.id;

select t.id, t.traccar_device_id, t.started_at, t.ended_at, t.notes
from trips t
join cleanup_trip_ids c on c.id = t.id
order by t.started_at;

delete from trip_route_points where trip_id in (select id from cleanup_trip_ids);
delete from trip_events where trip_id in (select id from cleanup_trip_ids);
delete from trip_tag_map where trip_id in (select id from cleanup_trip_ids);
delete from trip_external_identities where trip_id in (select id from cleanup_trip_ids);
delete from trips where id in (select id from cleanup_trip_ids);

select count(*) as remaining_started_before_cutoff
from trips
where started_at < timestamptz '2026-09-23 00:00:00+00';

commit;

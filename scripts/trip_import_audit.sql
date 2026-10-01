-- Read-only audit. Connect to the vehicle_app DATABASE with the app's search_path.
-- Do not automatically delete duplicates: their notes/tags/DTC links may differ.
select traccar_device_id, started_at, ended_at, count(*) as duplicate_count,
       array_agg(id order by id) as trip_ids
from trips
where traccar_source_id is null
group by traccar_device_id, started_at, ended_at
having count(*) > 1
order by traccar_device_id, started_at;

-- Strict overlap: touching endpoints alone are allowed.
select a.traccar_device_id, a.id as first_trip_id, b.id as second_trip_id,
       a.started_at as first_start, a.ended_at as first_end,
       b.started_at as second_start, b.ended_at as second_end
from trips a join trips b on a.traccar_device_id = b.traccar_device_id and a.id < b.id
  and a.started_at < b.ended_at and a.ended_at > b.started_at
where a.traccar_source_id is null and b.traccar_source_id is null
order by a.traccar_device_id, a.started_at;

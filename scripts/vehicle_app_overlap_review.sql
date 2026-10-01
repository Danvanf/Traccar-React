-- Read-only detail for the overlapping-trip audit results.
select
  t.id,
  t.traccar_device_id,
  t.started_at,
  t.ended_at,
  t.duration_seconds,
  t.distance_meters,
  t.start_traccar_position_id,
  t.end_traccar_position_id,
  t.traccar_source_id,
  t.derivation_version,
  t.notes,
  v.display_name as vehicle,
  b.id as covering_binding_id,
  b.starts_at as binding_starts_at,
  b.ends_at as binding_ends_at
from trips t
join vehicles v on v.id = t.vehicle_id
left join lateral (
  select b.*
  from vehicle_device_bindings b
  where b.vehicle_id = t.vehicle_id
    and b.traccar_device_id = t.traccar_device_id
    and b.starts_at <= t.started_at
    and (b.ends_at is null or b.ends_at > t.started_at)
  order by b.starts_at desc
  limit 1
) b on true
where t.traccar_device_id = 141880
  and t.started_at < '2026-09-26 18:59:12.46848+00'
  and t.ended_at > '2026-09-26 18:24:51.37078+00'
order by t.started_at, t.id;

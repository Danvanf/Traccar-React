-- Read-only inventory of the Bouncie REST fields actually returned for this
-- connected account. Run after a Bouncie import or enrichment replay.
\pset pager off
\pset border 2

with bouncie_trips as (
  select
    t.id,
    t.started_at,
    case
      when jsonb_typeof(t.external_metadata -> 'rawPayload') = 'string'
        then (t.external_metadata ->> 'rawPayload')::jsonb
    end as payload
  from trips t
  where t.external_metadata ->> 'source' = 'bouncie-rest-v1'
)
select key as top_level_field, count(*) as trips_returning_field
from bouncie_trips
cross join lateral jsonb_object_keys(payload) as key
group by key
order by trips_returning_field desc, top_level_field;

select
  count(*) as route_points,
  count(*) filter (where occurred_at is not null) as points_with_timestamp,
  count(*) filter (where speed_mph is not null) as points_with_speed,
  min(speed_mph) filter (where speed_mph is not null) as min_point_speed_mph,
  max(speed_mph) filter (where speed_mph is not null) as max_point_speed_mph
from trip_route_points p
join trips t on t.id = p.trip_id
where t.external_metadata ->> 'source' = 'bouncie-rest-v1';

select source_type, source_key, observed_at,
       jsonb_typeof(payload) as payload_type,
       case when jsonb_typeof(payload) = 'object'
         then array_to_string(array(select jsonb_object_keys(payload) order by 1), ', ')
       end as top_level_fields
from bouncie_source_snapshots
order by source_type, source_key;

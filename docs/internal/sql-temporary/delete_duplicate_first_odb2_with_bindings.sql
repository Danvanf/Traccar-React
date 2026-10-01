-- Removes the duplicate First ODB2 record and its stale bindings.
-- The real vehicle is the separate record that has Traccar device id 5.
-- Safe preview: change the final ROLLBACK to COMMIT only after reviewing counts.

begin;

select v.id, v.display_name, count(b.id) as binding_count,
       array_agg(distinct b.traccar_device_id order by b.traccar_device_id) as device_ids
from vehicles v left join vehicle_device_bindings b on b.vehicle_id = v.id
where v.id = '5e95a907-aa12-435f-b15e-1d1aefb834bf'
group by v.id, v.display_name;

delete from vehicle_device_bindings
where vehicle_id = '5e95a907-aa12-435f-b15e-1d1aefb834bf';

delete from vehicles
where id = '5e95a907-aa12-435f-b15e-1d1aefb834bf'
  and display_name = 'First ODB2'
  and year = 2010
  and make = 'Buick'
  and model = 'Enclave';

select 'remaining_duplicate' as result, count(*) as count
from vehicles
where id = '5e95a907-aa12-435f-b15e-1d1aefb834bf';

rollback;

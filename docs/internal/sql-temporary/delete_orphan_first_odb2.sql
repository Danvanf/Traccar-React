-- Deletes only the unbound duplicate First ODB2 vehicle.
-- Run against vehicle_app. Review the preview row before replacing ROLLBACK with COMMIT.

begin;

select v.id, v.display_name, v.year, v.make, v.model, v.active
from vehicles v
where v.id = '5e95a907-aa12-435f-b15e-1d1aefb834bf'
  and v.display_name = 'First ODB2'
  and v.year = 2010
  and v.make = 'Buick'
  and v.model = 'Enclave'
  and not exists (select 1 from vehicle_device_bindings b where b.vehicle_id = v.id);

delete from vehicles
where id = '5e95a907-aa12-435f-b15e-1d1aefb834bf'
  and display_name = 'First ODB2'
  and year = 2010
  and make = 'Buick'
  and model = 'Enclave'
  and not exists (select 1 from vehicle_device_bindings b where b.vehicle_id = vehicles.id);

select 'deleted_rows' as result, count(*) as count
from vehicles
where id = '5e95a907-aa12-435f-b15e-1d1aefb834bf';

-- Verify the preview and deleted_rows result, then change this to COMMIT.
rollback;

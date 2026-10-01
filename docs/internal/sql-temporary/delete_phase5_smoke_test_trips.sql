-- Removes only the three confirmed Phase 5 smoke-test trips.
-- Review the preview, then change ROLLBACK to COMMIT to apply.
begin;

select id, traccar_device_id, started_at, ended_at, notes
from trips
where id in (
  'e6b453dc-b166-4dac-8090-b38b39c9681c',
  '91931ae4-42b7-4cb8-b7b0-5c2a36deb91a',
  '1aa22bc9-13be-4809-8b33-d4e6e9ab62b3'
)
  and traccar_device_id = 141880
  and notes = 'phase5 smoke test';

delete from trips
where id in (
  'e6b453dc-b166-4dac-8090-b38b39c9681c',
  '91931ae4-42b7-4cb8-b7b0-5c2a36deb91a',
  '1aa22bc9-13be-4809-8b33-d4e6e9ab62b3'
)
  and traccar_device_id = 141880
  and notes = 'phase5 smoke test';

select 'remaining_target_rows' as result, count(*) as count
from trips
where id in (
  'e6b453dc-b166-4dac-8090-b38b39c9681c',
  '91931ae4-42b7-4cb8-b7b0-5c2a36deb91a',
  '1aa22bc9-13be-4809-8b33-d4e6e9ab62b3'
);

rollback;

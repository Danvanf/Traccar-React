-- Reopen only the zero-result Bouncie windows from the 2020-2021 backfill.
-- This removes checkpoint markers only; it does not delete imported trip data.
-- Run after reconnecting Bouncie and deploying the current API build.
--
-- Usage:
--   sudo docker exec -i traccar-db psql -U traccar -d traccar_react_api \
--     < ./scripts/retry_empty_bouncie_backfill.sql

begin;

delete from bouncie_import_checkpoints
where vehicle_imei in ('864112050349214', '864112050457769')
  and importer_version = 3
  and imported_count = 0
  and skipped_count = 0
  and imported_events = 0
  and window_from >= timestamptz '2020-05-20 00:00:00+00'
  and window_through <= timestamptz '2022-01-02 00:00:00+00'
returning vehicle_imei,
          window_from at time zone 'UTC' as window_from_utc,
          window_through at time zone 'UTC' as window_through_utc,
          importer_version;

commit;

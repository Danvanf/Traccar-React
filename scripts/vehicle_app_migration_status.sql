-- Read-only migration status for the live vehicle_app database.
-- Run with:
--   psql -U traccar -d vehicle_app -f vehicle_app_migration_status.sql
\pset border 2
\pset pager off

select current_database() as database_name, current_schema() as schema_name;

select object_name, object_type, present
from (
  select 'trips.derivation_version' as object_name, 'column' as object_type,
         exists (
           select 1 from information_schema.columns
           where table_schema = current_schema() and table_name = 'trips' and column_name = 'derivation_version'
         ) as present
  union all
  select 'ix_trips_derivation_version', 'index', exists (
    select 1 from pg_indexes where schemaname = current_schema() and indexname = 'ix_trips_derivation_version'
  )
  union all
  select 'ux_trips_default_source_identity', 'index', exists (
    select 1 from pg_indexes where schemaname = current_schema() and indexname = 'ux_trips_default_source_identity'
  )
  union all
  select 'dtc_catalog', 'table', to_regclass(format('%I.%I', current_schema(), 'dtc_catalog')) is not null
  union all
  select 'dtc_events', 'table', to_regclass(format('%I.%I', current_schema(), 'dtc_events')) is not null
  union all
  select 'trips_archive', 'table', to_regclass(format('%I.%I', current_schema(), 'trips_archive')) is not null
  union all
  select 'trip_tags_archive', 'table', to_regclass(format('%I.%I', current_schema(), 'trip_tags_archive')) is not null
  union all
  select 'trip_events', 'table', to_regclass(format('%I.%I', current_schema(), 'trip_events')) is not null
  union all
  select 'trip_event_thresholds', 'table', to_regclass(format('%I.%I', current_schema(), 'trip_event_thresholds')) is not null
  union all
  select 'bouncie_credentials', 'table', to_regclass(format('%I.%I', current_schema(), 'bouncie_credentials')) is not null
  union all
  select 'bouncie_import_checkpoints', 'table', to_regclass(format('%I.%I', current_schema(), 'bouncie_import_checkpoints')) is not null
  union all
  select 'trip_external_identities', 'table', to_regclass(format('%I.%I', current_schema(), 'trip_external_identities')) is not null
  union all
  select 'trip_route_points', 'table', to_regclass(format('%I.%I', current_schema(), 'trip_route_points')) is not null
) status
order by object_type, object_name;

select exists (
  select 1 from information_schema.tables
  where table_schema = current_schema() and table_name = 'app_schema_migrations'
) as migration_table_present;

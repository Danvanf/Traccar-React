-- Additive migration for named-place roles used by telemetry track timing.
-- Run against traccar_scope_api if the API cannot perform its startup bootstrap:
--   psql -U traccar -d traccar_scope_api -f scripts/phase_track_place_roles.sql

alter table if exists named_places
  add column if not exists place_type text not null default 'general';

alter table if exists named_places
  add column if not exists track_name text;

update named_places
set place_type = 'general'
where place_type is null or btrim(place_type) = '';

alter table if exists named_places
  alter column place_type set default 'general';

alter table if exists named_places
  alter column place_type set not null;

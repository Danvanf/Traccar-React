-- Phase 8: vehicle catalog profile assignment.
-- Safe to rerun against traccar_scope_api.
alter table vehicles add column if not exists profile_id text;

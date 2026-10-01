-- Phase 8: vehicle catalog profile assignment.
-- Safe to rerun against vehicle_app.
alter table vehicles add column if not exists profile_id text;

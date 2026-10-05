-- Phase 12: preserve Bouncie account snapshots and allow existing checkpoints
-- to be replayed when the importer learns new provider fields. Safe to rerun.

alter table bouncie_import_checkpoints
add column if not exists importer_version integer not null default 1;

create table if not exists bouncie_source_snapshots (
  source_type text not null,
  source_key text not null,
  payload jsonb not null,
  observed_at timestamptz not null default now(),
  primary key (source_type, source_key)
);

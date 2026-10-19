-- Adds an explicit mapping schema version to shared telemetry profile rows.
-- Safe to re-run after the Phase 3 Traccar Scope API schema has been installed.
ALTER TABLE IF EXISTS telemetry_profiles
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;

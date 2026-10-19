-- Adds optimistic concurrency and immutable snapshots for shared telemetry profiles.
-- Safe to re-run after the Traccar Scope API schema and profile schema are installed.
ALTER TABLE IF EXISTS telemetry_profiles
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS telemetry_profile_revisions (
  profile_key text NOT NULL,
  revision bigint NOT NULL,
  display_name text NOT NULL,
  schema_version integer NOT NULL,
  translation_json jsonb NOT NULL,
  change_kind text NOT NULL DEFAULT 'legacy',
  changed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_key, revision)
);

ALTER TABLE telemetry_profile_revisions
  ADD COLUMN IF NOT EXISTS effective_at timestamptz;

-- Existing snapshots for revisions after the first were created when those
-- revisions became current. The first retained revision predates reliable
-- snapshots, so treat it as the baseline for earlier telemetry.
UPDATE telemetry_profile_revisions revision_row
SET effective_at = CASE
  WHEN revision_row.revision = (
    SELECT min(earliest.revision)
    FROM telemetry_profile_revisions earliest
    WHERE earliest.profile_key = revision_row.profile_key
  ) THEN '0001-01-01 00:00:00+00'::timestamptz
  ELSE revision_row.created_at
END
WHERE revision_row.effective_at IS NULL;

ALTER TABLE telemetry_profile_revisions
  ALTER COLUMN effective_at SET DEFAULT now(),
  ALTER COLUMN effective_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS ix_telemetry_profile_revisions_created
  ON telemetry_profile_revisions (profile_key, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_telemetry_profile_revisions_effective
  ON telemetry_profile_revisions (profile_key, effective_at, revision);

INSERT INTO telemetry_profile_revisions (profile_key, revision, display_name, schema_version, translation_json, change_kind, changed_by, created_at, effective_at)
SELECT profile_key, revision, display_name, schema_version, translation_json, 'legacy', NULL, updated_at, updated_at
FROM telemetry_profiles
ON CONFLICT (profile_key, revision) DO NOTHING;

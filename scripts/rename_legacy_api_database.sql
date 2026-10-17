-- Run against postgres as the database owner/superuser with the API stopped.
-- Existing database contents and ownership links are retained. Never terminates sessions.
\set ON_ERROR_STOP on
\connect postgres

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'vehicle_app')
     AND EXISTS (SELECT 1 FROM pg_database WHERE datname = 'traccar_react_api') THEN
    RAISE EXCEPTION 'Both database names exist; resolve the conflict before renaming';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname IN ('vehicle_app', 'traccar_react_api')) THEN
    RAISE EXCEPTION 'Neither the legacy nor renamed database exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = 'vehicle_app') THEN
    RAISE EXCEPTION 'Stop the API and other clients connected to vehicle_app before renaming';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vehicle_app')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'traccar_react_api') THEN
    RAISE EXCEPTION 'Both role names exist; resolve the conflict before renaming';
  END IF;
END $$;

SELECT 'ALTER DATABASE vehicle_app RENAME TO traccar_react_api'
WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = 'vehicle_app')
\gexec
SELECT 'ALTER ROLE vehicle_app RENAME TO traccar_react_api'
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vehicle_app')
\gexec

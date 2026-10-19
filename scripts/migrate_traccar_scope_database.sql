-- One-time Traccar React -> Traccar Scope database and settings migration.
-- Run with psql as a PostgreSQL administrator, connected to any maintenance DB.
-- Preview by default. Pass -v apply=true only after reviewing the preflight.
-- Never terminates sessions; it refuses to proceed while the old DB is in use.
\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply false
\endif

\connect traccar_react_api

DO $$
DECLARE
  general_settings text;
BEGIN
  IF to_regclass('public.app_system_settings') IS NULL THEN
    RAISE EXCEPTION 'Table app_system_settings is missing from traccar_react_api';
  END IF;
  SELECT setting_value INTO general_settings
  FROM app_system_settings
  WHERE setting_key = 'general';
  IF general_settings IS NOT NULL AND jsonb_typeof(general_settings::jsonb) <> 'object' THEN
    RAISE EXCEPTION 'The general settings value is not a JSON object; database rename refused';
  END IF;
END
$$;

SELECT CASE
  WHEN EXISTS (SELECT 1 FROM app_system_settings WHERE setting_key = 'general')
    THEN 'Shared General settings will be renamed in place; stored values and custom hosts are preserved.'
  ELSE 'No shared General settings row exists; the API defaults will be used.'
END AS settings_action;

\connect postgres

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'traccar_react_api') THEN
    RAISE EXCEPTION 'Expected source database traccar_react_api does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'traccar_scope_api') THEN
    RAISE EXCEPTION 'Target database traccar_scope_api already exists; resolve the collision manually';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = 'traccar_react_api') THEN
    RAISE EXCEPTION 'Stop the API and other clients connected to traccar_react_api before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'traccar_react_api')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'traccar_scope_api') THEN
    RAISE EXCEPTION 'Both application role names exist; resolve the collision manually';
  END IF;
END
$$;

\echo Preflight passed: database traccar_react_api can be renamed to traccar_scope_api.
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'traccar_react_api')
    THEN 'The dedicated role traccar_react_api will be renamed to traccar_scope_api.'
  ELSE 'No dedicated traccar_react_api role exists; the database owner will remain unchanged.'
END AS role_action;

\if :apply
\connect traccar_react_api

UPDATE app_system_settings
SET setting_value = (
      (setting_value::jsonb - 'traccarReactApiBaseUrl' - 'vehicleApiBaseUrl')
      || jsonb_build_object(
        'traccarScopeApiBaseUrl',
        regexp_replace(
          coalesce(
            nullif(setting_value::jsonb ->> 'traccarScopeApiBaseUrl', ''),
            nullif(setting_value::jsonb ->> 'traccarReactApiBaseUrl', ''),
            nullif(setting_value::jsonb ->> 'vehicleApiBaseUrl', ''),
            '/traccar-scope-api'
          ),
          '/(traccar-react-api|vehicle-api)/?$',
          '/traccar-scope-api',
          'i'
        )
      )
    )::text,
    updated_at = now()
WHERE setting_key = 'general';

\connect postgres

SELECT 'ALTER DATABASE traccar_react_api RENAME TO traccar_scope_api'
\gexec

SELECT 'ALTER ROLE traccar_react_api RENAME TO traccar_scope_api'
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'traccar_react_api')
\gexec
\echo Database and shared General settings migration applied.
\else
\echo Dry run only. Re-run with -v apply=true to rename the database and optional dedicated role.
\endif

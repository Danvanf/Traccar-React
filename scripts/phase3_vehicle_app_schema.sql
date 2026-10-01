-- Phase 3: vehicle_app schema bootstrap (planning baseline)
-- Purpose: create app-owned tables in a separate PostgreSQL database,
-- while referencing Traccar IDs as soft links (no cross-database FKs).
--
-- Run from psql as a role with database create privileges:
--   psql -U postgres -d postgres -f scripts/phase3_vehicle_app_schema.sql
--
-- If CREATE DATABASE is not allowed for this user, create the DB once as admin,
-- then run the remainder connected to vehicle_app.

CREATE DATABASE vehicle_app;
\connect vehicle_app;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Optional source registry when multiple Traccar instances are used later.
CREATE TABLE IF NOT EXISTS traccar_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  base_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- App-owned vehicle record.
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  vin text,
  year integer,
  make text,
  model text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mapping between app vehicle and Traccar device ID.
-- Soft link only: traccar_device_id points to traccar.tc_devices.id in another DB.
CREATE TABLE IF NOT EXISTS vehicle_device_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  traccar_source_id uuid REFERENCES traccar_sources(id),
  traccar_device_id integer NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_primary boolean NOT NULL DEFAULT true,
  UNIQUE (vehicle_id, traccar_device_id, starts_at)
);

CREATE INDEX IF NOT EXISTS ix_vehicle_device_bindings_device
ON vehicle_device_bindings (traccar_device_id, starts_at DESC);

-- Derived trip summary table.
CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  traccar_source_id uuid REFERENCES traccar_sources(id),
  traccar_device_id integer NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_seconds integer NOT NULL,
  distance_meters double precision NOT NULL DEFAULT 0,
  avg_speed_mph double precision,
  max_speed_mph double precision,
  idle_seconds integer,
  fuel_used_gallons double precision,
  estimated_mpg double precision,
  start_traccar_position_id bigint,
  end_traccar_position_id bigint,
  start_label text,
  end_label text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS ix_trips_vehicle_started
ON trips (vehicle_id, started_at DESC);

CREATE INDEX IF NOT EXISTS ix_trips_device_started
ON trips (traccar_device_id, started_at DESC);

-- User-defined named places.
CREATE TABLE IF NOT EXISTS named_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  name text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  radius_meters integer NOT NULL DEFAULT 75,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_named_places_vehicle
ON named_places (vehicle_id, name);

-- Fuel log.
CREATE TABLE IF NOT EXISTS fuel_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  filled_at timestamptz NOT NULL,
  odometer_miles double precision,
  gallons double precision NOT NULL,
  total_cost numeric(10,2),
  price_per_gallon numeric(10,3),
  station_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fuel_fills_vehicle_time
ON fuel_fills (vehicle_id, filled_at DESC);

-- Maintenance log.
CREATE TABLE IF NOT EXISTS maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_date timestamptz NOT NULL,
  odometer_miles double precision,
  service_type text NOT NULL,
  cost numeric(10,2),
  vendor text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_maintenance_vehicle_time
ON maintenance_records (vehicle_id, service_date DESC);

-- Trip tagging.
CREATE TABLE IF NOT EXISTS trip_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  UNIQUE (vehicle_id, name)
);

CREATE TABLE IF NOT EXISTS trip_tag_map (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES trip_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (trip_id, tag_id)
);

-- Alert rules and event history.
CREATE TABLE IF NOT EXISTS alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  name text NOT NULL,
  rule_type text NOT NULL,
  threshold numeric(12,4),
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_alert_rules_vehicle_enabled
ON alert_rules (vehicle_id, enabled);

CREATE TABLE IF NOT EXISTS alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  traccar_event_id bigint,
  traccar_position_id bigint,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_alert_events_rule_time
ON alert_events (rule_id, triggered_at DESC);

-- Telemetry profile definitions and assignment history (app-owned mirror).
CREATE TABLE IF NOT EXISTS telemetry_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  translation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry_profile_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  traccar_device_id integer,
  profile_id uuid NOT NULL REFERENCES telemetry_profiles(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  UNIQUE (vehicle_id, profile_id, starts_at)
);

CREATE INDEX IF NOT EXISTS ix_profile_assignments_vehicle_time
ON telemetry_profile_assignments (vehicle_id, starts_at DESC);

-- Minimal migration metadata for app DB evolution.
CREATE TABLE IF NOT EXISTS app_schema_migrations (
  id bigserial PRIMARY KEY,
  version text NOT NULL UNIQUE,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Phase 3: initial VehicleApp database bootstrap.
-- Creates the database, then loads the schema-only SQL file beside this one.
-- For an existing vehicle_app database, run phase3_vehicle_app_tables.sql directly.
CREATE DATABASE vehicle_app;
\connect vehicle_app;
\ir phase3_vehicle_app_tables.sql
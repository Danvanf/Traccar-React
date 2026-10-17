-- Phase 3: initial Traccar React API database bootstrap.
-- Creates the database, then loads the schema-only SQL file beside this one.
-- For an existing traccar_react_api database, run phase3_traccar_react_api_tables.sql directly.
CREATE DATABASE traccar_react_api;
\connect traccar_react_api
\ir phase3_traccar_react_api_tables.sql

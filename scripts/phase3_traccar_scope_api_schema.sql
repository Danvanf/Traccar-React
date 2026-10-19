-- Phase 3: initial Traccar Scope API database bootstrap.
-- Creates the database, then loads the schema-only SQL file beside this one.
-- For an existing traccar_scope_api database, run phase3_traccar_scope_api_tables.sql directly.
CREATE DATABASE traccar_scope_api;
\connect traccar_scope_api
\ir phase3_traccar_scope_api_tables.sql

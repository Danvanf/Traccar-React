-- Phase 2 verification script for Traccar PostgreSQL telemetry performance baseline.
-- This script auto-detects whether Traccar uses `positions` or `tc_positions`.
-- Usage:
--   psql -U <db_user> -d traccar -f scripts/phase2_positions_audit.sql

\echo '=== Phase 2: Detect positions table ==='
SELECT
  CASE
    WHEN to_regclass('public.positions') IS NOT NULL THEN 'positions'
    WHEN to_regclass('public.tc_positions') IS NOT NULL THEN 'tc_positions'
    ELSE ''
  END AS positions_table
\gset

\if :positions_table
\echo Using table :positions_table
\else
\echo ERROR: Neither public.positions nor public.tc_positions exists.
\echo Check the connected database and schema, then run: \dt public.*
\quit 3
\endif

-- Normalize naming for the rest of the script.
DROP VIEW IF EXISTS phase2_positions;
CREATE TEMP VIEW phase2_positions AS
SELECT * FROM public.:"positions_table";

\echo '=== Phase 2: Table shape and row volume ==='
\dt+ public.:"positions_table"

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = :'positions_table'
ORDER BY ordinal_position;

SELECT reltuples::bigint AS estimated_rows
FROM pg_class
WHERE relname = :'positions_table';

SELECT count(*) AS exact_rows FROM phase2_positions;

\echo '=== Phase 2: Index inventory ==='
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = :'positions_table'
ORDER BY indexname;

\echo '=== Phase 2: Index sizes ==='
SELECT
  i.relname AS index_name,
  pg_size_pretty(pg_relation_size(i.oid)) AS index_size
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
WHERE t.relname = :'positions_table'
ORDER BY pg_relation_size(i.oid) DESC;

\echo '=== Phase 2: Recent time distribution sanity ==='
SELECT
  min(fixtime) AS min_fixtime,
  max(fixtime) AS max_fixtime,
  now() AS checked_at
FROM phase2_positions;

SELECT
  date_trunc('day', fixtime) AS day,
  count(*) AS points
FROM phase2_positions
WHERE fixtime >= now() - interval '14 days'
GROUP BY 1
ORDER BY 1 DESC;

\echo '=== Phase 2: Sample query plans (device/time pattern) ==='
EXPLAIN (ANALYZE, BUFFERS)
WITH chosen AS (
  SELECT deviceid AS device_id
  FROM phase2_positions
  ORDER BY fixtime DESC
  LIMIT 1
)
SELECT *
FROM phase2_positions p
WHERE p.deviceid = (SELECT device_id FROM chosen)
  AND p.fixtime BETWEEN now() - interval '7 days' AND now()
ORDER BY p.fixtime ASC;

EXPLAIN (ANALYZE, BUFFERS)
WITH chosen AS (
  SELECT deviceid AS device_id
  FROM phase2_positions
  ORDER BY fixtime DESC
  LIMIT 1
)
SELECT p.id, p.deviceid, p.fixtime, p.latitude, p.longitude, p.speed
FROM phase2_positions p
WHERE p.deviceid = (SELECT device_id FROM chosen)
  AND p.fixtime BETWEEN now() - interval '24 hours' AND now()
ORDER BY p.fixtime DESC
LIMIT 2000;

\echo '=== Phase 2: Suggested index DDL (run only if truly missing) ==='
\echo 'CREATE INDEX IF NOT EXISTS ix_positions_device_time ON public.<positions_table> (deviceid, fixtime DESC);'
\echo 'CREATE INDEX IF NOT EXISTS ix_positions_time ON public.<positions_table> (fixtime DESC);'

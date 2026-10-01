# Phase 2 Runbook (Traccar PostgreSQL, psql-first)

This runbook is designed for hosts where this repo is not checked out.

Known environment from your host:

- DB container: `traccar-db`
- DB user: `traccar`
- DB name: `traccar`
- Traccar schema prefix tables: `tc_*` (includes `tc_positions`)

## 1) Enter psql

```bash
docker exec -it traccar-db psql -U traccar -d traccar
```

## 2) Run audit queries directly in psql

Paste the blocks below in order.

### A) Table and row sanity

```sql
\dt public.tc_*

\d+ public.tc_positions

SELECT count(*) AS users FROM public.tc_users;
SELECT count(*) AS devices FROM public.tc_devices;
SELECT count(*) AS positions FROM public.tc_positions;

SELECT min(fixtime) AS min_fixtime, max(fixtime) AS max_fixtime
FROM public.tc_positions;
```

### B) Index inventory

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'tc_positions'
ORDER BY indexname;

SELECT
  i.relname AS index_name,
  pg_size_pretty(pg_relation_size(i.oid)) AS index_size
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
WHERE t.relname = 'tc_positions'
ORDER BY pg_relation_size(i.oid) DESC;
```

### C) Representative query plans

```sql
EXPLAIN (ANALYZE, BUFFERS)
WITH chosen AS (
  SELECT deviceid AS device_id
  FROM public.tc_positions
  ORDER BY fixtime DESC
  LIMIT 1
)
SELECT *
FROM public.tc_positions p
WHERE p.deviceid = (SELECT device_id FROM chosen)
  AND p.fixtime BETWEEN now() - interval '7 days' AND now()
ORDER BY p.fixtime ASC;

EXPLAIN (ANALYZE, BUFFERS)
WITH chosen AS (
  SELECT deviceid AS device_id
  FROM public.tc_positions
  ORDER BY fixtime DESC
  LIMIT 1
)
SELECT p.id, p.deviceid, p.fixtime, p.latitude, p.longitude, p.speed
FROM public.tc_positions p
WHERE p.deviceid = (SELECT device_id FROM chosen)
  AND p.fixtime BETWEEN now() - interval '24 hours' AND now()
ORDER BY p.fixtime DESC
LIMIT 2000;
```

## 3) Optional index add (only if needed)

Run only if missing or if plans do not use an effective device/time index.

```sql
CREATE INDEX IF NOT EXISTS ix_tc_positions_device_time
ON public.tc_positions (deviceid, fixtime DESC);

CREATE INDEX IF NOT EXISTS ix_tc_positions_time
ON public.tc_positions (fixtime DESC);
```

## 4) Capture output to host file

```bash
docker exec -i traccar-db psql -U traccar -d traccar <<'SQL' > phase2_audit_output.txt
\dt public.tc_*
\d+ public.tc_positions
SELECT count(*) AS users FROM public.tc_users;
SELECT count(*) AS devices FROM public.tc_devices;
SELECT count(*) AS positions FROM public.tc_positions;
SELECT min(fixtime) AS min_fixtime, max(fixtime) AS max_fixtime FROM public.tc_positions;
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tc_positions' ORDER BY indexname;
EXPLAIN (ANALYZE, BUFFERS)
WITH chosen AS (
  SELECT deviceid AS device_id FROM public.tc_positions ORDER BY fixtime DESC LIMIT 1
)
SELECT *
FROM public.tc_positions p
WHERE p.deviceid = (SELECT device_id FROM chosen)
  AND p.fixtime BETWEEN now() - interval '7 days' AND now()
ORDER BY p.fixtime ASC;
SQL
```

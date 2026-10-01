# Phase 6 Runbook: Retention and Archival (vehicle_app)

This runbook defines a conservative retention policy for app-owned derived data.

## Scope

- Applies to `vehicle_app` tables owned by this application.
- Does not modify Traccar raw telemetry tables (`traccar` / `tc_*`).

## Policy (Initial)

- Keep `vehicle_app.trips` hot data for **24 months**.
- Move older trips to `vehicle_app.trips_archive`.
- Preserve their tag relationships in `vehicle_app.trip_tags_archive` before deleting live trips.
- Keep archive rows indefinitely for now (revisit when storage pressure appears).
- Run archival in low-traffic windows, in small batches.

## Preflight

1. Ensure recent backup exists (`pg_dump` / standard host backup process).
2. Confirm API/service health before maintenance window.
3. Run the SQL script in read-first mode to review candidate volume.

## Commands (psql-first)

Open psql on the host/container:

```bash
docker exec -it traccar-db psql -U traccar -d vehicle_app
```

Run the retention helper script:

```sql
\i /path/to/phase6_vehicle_app_retention.sql
```

If repo is not present on the host, copy script first or paste SQL blocks manually.

## Archive Execution Pattern

1. Use the commented archive/delete transaction block in `phase6_vehicle_app_retention.sql`.
2. Start with a small batch (`limit 5000` or `10000`).
3. Review counts.
4. Replace `rollback;` with `commit;` only after verification.
5. Repeat batches until rows older than 24 months are archived.

## Verification

Expected outcomes after each committed batch:

- `vehicle_app.trips` row count decreases.
- `vehicle_app.trips_archive` row count increases by same amount.
- Archived trip tags remain available through `trip_tags_archive`.
- No API errors for normal trip reads in recent windows.

## Operational Notes

- Keep retention logic at DB/ops layer for now; do not run destructive pruning automatically from API.
- Revisit retention period after usage trends are stable.
- Re-evaluate TimescaleDB only if PostgreSQL query latency, storage growth, or maintenance overhead crosses agreed thresholds.

## Growth Review

Run `scripts/phase6_growth_health.sql` monthly or after a large historical import. It marks tables at 1 GB as `WATCH` and 10 GB as `REVIEW`, and the schema at 10 GB and 50 GB respectively. Adjust these starting points after observing backup duration, query latency, and available disk space.

## Maintenance Review

Run `scripts/phase6_maintenance_health.sql` weekly. Review tables flagged for high dead-row estimates or stale statistics, then schedule `VACUUM (ANALYZE)` during the normal low-traffic maintenance window. The report is read-only.

## Daily Health Check

Run the read-only report from the repository:

```bash
psql -U traccar -d vehicle_app -f scripts/phase6_daily_health.sql
```

Review trip and DTC activity, then investigate warning rows against Traccar connectivity and active device bindings. A zero-trip result is a diagnostic signal, not proof that a device was moving or that an import failed.

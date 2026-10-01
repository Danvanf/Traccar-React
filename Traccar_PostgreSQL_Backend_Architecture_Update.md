# Traccar React Tool – Database / Backend Architecture Update

## Status

This note updates the project architecture after the initial Traccar + React prototype work.

The existing `AI_OVERVIEW.md` remains the primary project overview and has already been updated to reflect that the export-range bug is fixed. This document focuses only on the database/backend direction.

---

## Approved Next Milestone (2026-09-26)

The v1 stop point below records an earlier scope decision, not a claim that every
correctness or operational concern is closed. The current approved priority is:

1. Stable persisted trip identity and safe metadata editing.
2. Concurrent/overlapping reimport safety and historical device bindings.
3. Preserve notes/tags across intentional trip recalculation.
4. Targeted regressions, then automatic named-place start/destination labels.

First increment completed in source: exact trip resolver, stale-response guards,
disabled editing for missing/ambiguous identity, source position IDs in trip imports,
and removal of the device `uniqueId` fallback. See `AI_OVERVIEW.md` for validation
commands, runtime restart requirement, and remaining limitations. This increment does
not change existing database rows or claim concurrent imports are already safe.

Second increment (2026-09-27): import requests are serialized per device in PostgreSQL;
exact retries preserve saved IDs/annotations, and overlaps or ambiguity roll back the
entire batch with HTTP 409. Added a read-only duplicate/overlap audit, a duplicate-safe
unique-index migration, and disposable-schema PostgreSQL integration tests. The app
schema migration has not been applied to existing app tables. Validation completed:
9 frontend checks, 12 identity checks, and 27 PostgreSQL integration checks passed
(48 total), with frontend/backend builds passing. The user supplied the full database
PASS output on 2026-09-27; the disposable schema was removed and existing app records
were untouched. Rebuild/restart the API to activate the second increment. New trips
Third increment (2026-09-27): binding creation accepts an explicit `effectiveFrom`
timestamp. New trips are assigned only to the unique binding that fully covers their
time range. Gaps, reassignment-crossing trips, future-binding conflicts, and ambiguous
history stop with HTTP 409. The Settings UI exposes the effective date. Historical
replays remain attached to their saved vehicle. The disposable PostgreSQL regression
suite now covers historical assignment and crossing rejection.

Fourth increment (2026-09-27): imported trips record an additive `derivation_version`
value, with `scripts/phase5_trip_derivation_schema.sql` for existing databases. The
current frontend sends the movement-threshold derivation version. This is provenance
only; recalculation and annotation preservation remain a deliberate future workflow.
Trip list responses now expose `derivationVersion` so later recalculation can compare
rule versions without changing saved IDs or annotations.

Fifth increment (2026-09-27): explicit trip recalculation updates derived metrics by
saved trip UUID while preserving notes, tags, vehicle assignment, boundaries, and
labels. Sixth increment adds automatic named-place start/end labels during import.

## Next Deployment Milestone

The correctness implementation is complete and validated in disposable PostgreSQL
schemas. Before treating the backend as production-ready:

1. Run `scripts/trip_import_audit.sql` against `vehicle_app` and reconcile any reported
   duplicate or overlapping records manually.
2. Apply `scripts/trip_import_uniqueness.sql` and
   `scripts/phase5_trip_derivation_schema.sql` against the `vehicle_app` database.
3. Re-run the 29-check integration suite using the real PowerShell connection variable.
4. Replace the current ad-hoc schema bootstrap with recorded migrations in
   `app_schema_migrations`.
5. Redesign retention before scheduling it: archive trip tags and DTC relationships,
   provide archive reads, and verify restore of both databases and Traccar config.
6. Add API authentication/authorization before exposing write endpoints beyond the
   local trusted network.

Do not schedule the existing retention helper yet: reconcile database/schema naming,
preserve tag/DTC relationships and source IDs, and define archive reads first.
Named places, tagging, and notes are already implemented; older next-step lists below
are historical. Authentication, versioned migrations, isolated DB integration tests,
and explicit `vehicle_app` backup/restore verification remain deployment work.

## Implementation Tracker (Working Checklist)

Use this checklist to track execution of the architecture direction.

### Phase 0 - Review and Alignment

- [x] Read and review this architecture update document.
- [x] Align exported-data behavior with database-backed Traccar source (export now queries Traccar `/positions` by range/device).
- [x] Keep AI handoff documentation synchronized after each step.

### Phase 1 - PostgreSQL and Container Baseline

- [x] Traccar config persisted on host.
- [x] PostgreSQL container created.
- [x] PostgreSQL storage persisted.
- [x] H2 migrated to PostgreSQL.
- [x] Users/devices/history verified.
- [x] PostgreSQL sequences corrected.
- [x] Nightly `pg_dump` backup created.
- [x] Backup archive tested with `pg_restore`.
- [x] 7-day retention.
- [x] Pre-migration H2 snapshot retained separately.

Phase 1 status: marked complete based on host-side work reported by user.

### Phase 2 - Traccar Query Performance Baseline

- [x] Capture current Traccar `positions` schema details used by this deployment. (`tc_*` naming confirmed; includes `tc_positions`.)
- [x] Verify useful indexes exist for device/time history queries. (`position_deviceid_fixtime` on `(deviceid, fixtime)` confirmed.)
- [x] Add missing index(es) for `(deviceid, fixtime DESC)` pattern if needed. (No add needed currently; existing btree supports this access pattern.)
- [x] Validate history-range query performance at realistic time windows. (EXPLAIN ANALYZE completed: ~13.3 ms execution, index used.)

Phase 2 status: complete.

Performance note:

- Main history predicate used `position_deviceid_fixtime` via Bitmap Index Scan (expected/good).
- End-to-end query time observed: ~13.345 ms with ~10,175 rows returned for 7-day window.
- The InitPlan that chooses "latest device by fixtime" performs a parallel seq scan + sort; this is acceptable for diagnostics but should not be used in production request paths where device ID is already known.

Use psql-first runbook for host execution:

- `scripts/phase2_positions_audit.sql`
- private internal phase 2 runbook

### Phase 3 - Data Boundary Planning

- [x] Define separate application database (`vehicle_app`) alongside `traccar`.
- [x] Define initial app-owned table set (vehicles, trips, maintenance, fuel, tags, rules, profiles).
- [x] Document cross-reference strategy (Traccar device IDs, position IDs, or time-range linkage).

Phase 3 status: planning complete. Starter DDL added at `scripts/phase3_vehicle_app_schema.sql`.

Phase 3 boundary decisions:

- Keep `traccar` database as source of truth for raw telemetry and Traccar-managed entities.
- Use `vehicle_app` for derived domain records and user/business metadata.
- Do not create cross-database foreign keys to `traccar` tables.
- Store soft references in `vehicle_app` using:
  - `traccar_device_id` (integer)
  - `traccar_position_id` (bigint)
  - `traccar_event_id` (bigint)
  - optional `traccar_source_id` for future multi-source support.

Initial `vehicle_app` table set (starter):

- `vehicles`
- `vehicle_device_bindings`
- `trips`
- `named_places`
- `fuel_fills`
- `maintenance_records`
- `trip_tags`, `trip_tag_map`
- `alert_rules`, `alert_events`
- `telemetry_profiles`, `telemetry_profile_assignments`
- `app_schema_migrations`

### Phase 4 - Backend Service Introduction (.NET API)

- [x] Scaffold minimal API service (health, config, auth strategy placeholder).
- [x] Add initial endpoint(s) that proxy or enrich Traccar data.
- [x] Begin moving front-end data access behind backend API where appropriate.

Phase 4 status: complete.

Implemented artifacts:

- New project: `backend/VehicleApp.Api`
- DB client package: `Npgsql`
- Endpoints:
  - `GET /health` (API + DB liveness check)
  - `GET /api/vehicles` (reads `vehicle_app.vehicles`)
  - `GET /api/trips?vehicleId=...&from=...&to=...&limit=...` (reads `vehicle_app.trips`)
- Config:
  - `ConnectionStrings:VehicleApp` in `appsettings.json` and `appsettings.Development.json`
- Request test file:
  - `backend/VehicleApp.Api/VehicleApp.Api.http`
- Frontend cutover step:
  - Settings toggle to switch device source to backend vehicle catalog.
  - Backend path `GET /api/vehicles` now returns `traccarDeviceId` mapping.
  - Frontend can load devices from backend catalog and falls back to Traccar `/devices` if backend catalog is unavailable.
  - Vite proxy route added: `/vehicle-api` -> `VITE_VEHICLE_API_TARGET` (default `http://localhost:5124`).

### Phase 5 - Derived Data and Enrichment

- [x] Persist trip summaries/derived metrics in `vehicle_app`.
- [x] Add DTC decoding and enrichment pipeline.
- [x] Add named places, tagging, and notes models.

Phase 5 status: complete for the current local deployment scope. Remaining deployment
work is tracked in the Next Deployment Milestone below.

Implemented (backend API):

- `POST /api/trips/import-by-device`
  - resolves active `vehicle_device_bindings` for incoming `traccarDeviceId`
  - inserts missing rows into `vehicle_app.trips`
  - returns imported/skipped counts
- `GET /api/trips/day-summaries`
  - aggregates trip counts and distance by UTC day from `vehicle_app.trips`

These endpoints are scaffolded and compile successfully; operational verification depends on live data and active device bindings in `vehicle_app`.

Operational verification complete (2026-09-26):

- API connectivity to PostgreSQL confirmed (`GET /health` -> 200).
- `GET /api/vehicles` confirmed active binding lookup for Traccar device `141880`.
- `POST /api/trips/import-by-device` confirmed inserts into `vehicle_app.trips`.
- `GET /api/trips/day-summaries` confirmed UTC-day aggregation output.
- Smoke test script fixed to URL-encode ISO timestamps in query parameters to avoid `DateTimeOffset` binding errors (`+00:00` parsing issue).
- Frontend Export panel now supports manual import of derived trips for selected device/range into backend via `POST /api/trips/import-by-device`.
- Dev proxy path mismatch fixed: Vite now rewrites `/vehicle-api/*` to backend root so `/api/trips/import-by-device` resolves correctly.
- Frontend import now retries with numeric device `uniqueId` when direct Traccar id binding returns 404 (active binding not found).
- Frontend import now filters invalid derived-trip payload rows before POST to reduce server-side failures.
- Backend import endpoint now returns explicit error details for unexpected PostgreSQL/general exceptions to improve operator diagnosis.
- Added binding management endpoints:
  - `GET /api/device-bindings` (active binding inventory)
  - `POST /api/device-bindings/upsert` (bind existing vehicle to Traccar device id, ending conflicting active binding)
- Added Settings modal "Device Bindings" panel to map devices to existing vehicles and refresh active binding state from backend.
- Added import-recovery shortcut enhancements:
  - import error path surfaces a quick "Bind Device To Vehicle" action
  - binding panel preselects hinted device id and suggests likely vehicle match when unambiguous
  - one-click "Save Binding and Retry Import" path to complete import without leaving the workflow
- Added DTC enrichment foundation:
  - schema script: `scripts/phase5_dtc_enrichment_schema.sql`
  - smoke script: `scripts/phase5_dtc_smoke_test.ps1` (SKIP-safe before schema rollout)
  - traccar pull+ingest script: `scripts/phase5_dtc_traccar_ingest.ps1`
  - `GET /api/dtc/catalog`
  - `POST /api/dtc/catalog/upsert`
  - `GET /api/dtc/events?vehicleId=...&from=...&to=...&limit=...`
  - `POST /api/dtc/events/import-by-device`
  - `POST /api/dtc/events/import-from-traccar` (decodes common Traccar attributes such as `dtc`, `dtcCodes`, and `faultCodes`)
  - request examples in `backend/VehicleApp.Api/VehicleApp.Api.http`

Notes:

- DTC import endpoint resolves vehicle by active `vehicle_device_bindings` (same binding strategy as trip import).
- DTC events are deduped by `(vehicle_id, traccar_device_id, code, detected_at, source_position_id)` pattern.
- DTC events now also include `source_event_id` in dedupe checks for stronger idempotency on replayed Traccar event imports.
- Raw Traccar decode pipeline now available via `POST /api/dtc/events/import-from-traccar`, which translates common attribute payloads into normalized DTC imports.
- DTC smoke now validates duplicate decode replay is skipped deterministically.
- One-command operator workflow is now available to pull recent Traccar positions/events and post candidate DTC payloads to decode import (`scripts/phase5_dtc_traccar_ingest.ps1`).
- Ingest script supports credentials from environment variables (`TRACCAR_USERNAME`, `TRACCAR_PASSWORD`) to avoid plain-text command history usage.
- Ingest script now performs Traccar connectivity and device-permission preflight checks to fail fast with actionable remediation before pull/import steps.
- Regression runner now supports optional live Traccar ingest stage (`-RunDtcTraccarIngest`) to include pull+decode import in full Phase 5 validation runs.
- Added raw payload probe script (`scripts/phase5_dtc_traccar_probe.ps1`) to capture Traccar position/event attributes and key-frequency diagnostics for DTC field mapping.
- Added optional io30 fallback mode (`includeIo30Fallback`) for sparse hardware payloads that emit DTC count but not explicit code strings; fallback persists synthetic `IO30_COUNT` diagnostic events on count changes.
- Added optional io30 zero-baseline mode (`includeIo30ZeroBaseline`) to emit first-seen `IO30_COUNT` breadcrumb events even when io30 is zero.
- Added optional io30 fallback status guardrail (`io30FallbackAllowedStatuses`) to restrict synthetic `IO30_COUNT` emission to expected Traccar status/event types.
- Added explicit empty-status token support (`(empty)` / `empty`) for io30 fallback allowlists and a ready-to-copy rerun command hint when all filtered statuses are empty.
- Added DTC monitoring summary script (`scripts/phase5_dtc_monitoring_summary.ps1`) with daily/weekly/monthly windows and explicit-code vs `IO30_COUNT` counts.
- Added enrichment API endpoints for remaining Phase 5 models:
  - named places: `GET /api/named-places`, `POST /api/named-places/upsert`, `DELETE /api/named-places/{placeId}`
  - trip tags: `GET /api/trip-tags`, `POST /api/trip-tags/upsert`, `GET /api/trips/{tripId}/tags`, `POST /api/trips/{tripId}/tags/{tagId}`, `DELETE /api/trips/{tripId}/tags/{tagId}`
  - trip notes: `POST /api/trips/{tripId}/notes`
- `/api/dtc/events` now treats `limit` as optional (defaults to 500) to avoid required-query binding failures.

### Phase 6 - Operations and Growth

- [x] Add observability basics (structured logs, request timing, error visibility).
- [x] Define retention/archival strategy for long-term telemetry.
- [ ] Re-evaluate TimescaleDB only if growth/performance thresholds are reached.

Phase 6 status: in progress; observability and a retention draft exist, but migrations,
archive relationship preservation, scheduling, restore verification, and authorization
remain open.

Implemented (2026-09-26):

- API responses now include `X-Request-Id` header for correlation.
- ProblemDetails payloads are enriched with `requestId` and `timestampUtc`.
- Request timing middleware logs method/path/status/duration for each request (5xx logged as warning).
- Frontend vehicle API client now parses ProblemDetails (`title`, `detail`, validation errors) into cleaner operator-facing messages.
- Retention runbook + SQL helper added for `vehicle_app` trip archival policy:
  - private internal retention runbook
  - `scripts/phase6_vehicle_app_retention.sql`
  - initial policy: keep 24 months hot in `vehicle_app.trips`, archive older rows to `vehicle_app.trips_archive`.

## V1 Stop Point and Next Steps

Stopping at this point for v1 is a sound decision.

Why this is a safe stop:

- Core API and DB-backed workflows are stable (`/health`, vehicle catalog, trip import/summaries, DTC import/query).
- Regression flow repeatedly reports PASS for smoke, binding integrity, and DTC smoke validations.
- DTC sparse-payload behavior is now observable and controllable through io30 fallback modes and status allowlist diagnostics.
- The main remaining gap is data-shape tuning (`status` often empty in io30 records), which is an iterative operations refinement rather than a blocker for the delivered v1 feature set.

Recommended next steps (v1.1+):

1. Finalize allowlist policy for sparse devices:
  - If desired behavior is to keep current payloads, include `(empty)` in io30 allowlists.
  - Standardize operator defaults across ingest/regression scripts.
2. Add operator rerun hints:
  - Print a ready-to-copy command when 100% of filtered statuses are `(empty)`.
3. Add lightweight monitoring:
  - Daily counts for `IO30_COUNT` vs explicit DTC codes by vehicle/device.
  - Alert if decode import suddenly drops to zero for active devices.
4. Expand DTC source decoding only if needed:
  - Add additional Traccar attribute probes when hardware config changes.
  - Keep probe artifacts for evidence when tuning parser coverage.
5. Complete remaining Phase 5 enrichment scope:
  - named places, tagging, and notes models.
6. Move Phase 6 operations forward:
  - productionize retention job scheduling and runbook execution cadence.
  - define growth thresholds that would trigger a TimescaleDB re-evaluation.

Resume checklist for next session:

- Run ingest with current policy and capture summary diagnostics.
- Confirm whether `(empty)` should be accepted permanently for target devices.
- Record chosen policy in README and operations notes.
- Re-run full regression with live ingest enabled and archive output.

## Change Log

- 2026-09-25: Added implementation tracker and phased checklist.
- 2026-09-25: Marked architecture review and export database-backed alignment as complete.
- 2026-09-25: Searched workspace for Docker/PostgreSQL deployment artifacts; none found in-repo.
- 2026-09-25: Flagged Phase 1 checks as requiring Linux host/container evidence.
- 2026-09-26: Phase 1 marked complete from user-provided migration checklist updates.
- 2026-09-26: Frontend triage found two separate issues: CSS corruption (fixed in app) and Traccar API 401 responses (auth/settings issue).
- 2026-09-26: User confirmed map, test, and range loading are now working after local browser/settings correction.
- 2026-09-26: Added Phase 2 SQL audit script and runbook to repo.
- 2026-09-26: Updated Phase 2 SQL audit script to auto-detect `positions` vs `tc_positions` and removed brittle psql variable syntax.
- 2026-09-26: Host relation listing confirms Traccar table prefix (`tc_*`) and presence of `tc_positions`.
- 2026-09-26: Runbook switched to psql-first flow (no repo/script copy dependency on Traccar host).
- 2026-09-26: `tc_positions` schema details captured; index inventory confirms `position_deviceid_fixtime` plus PK.
- 2026-09-26: Composite device/time index already present; no additional `(deviceid, fixtime DESC)` index required at this stage.
- 2026-09-26: EXPLAIN ANALYZE validated history query performance (~13.3 ms) and confirmed index-backed filtering on `position_deviceid_fixtime`.
- 2026-09-26: Phase 3 planning completed with explicit `vehicle_app` boundary + cross-reference strategy.
- 2026-09-26: Added starter `vehicle_app` DDL script: `scripts/phase3_vehicle_app_schema.sql`.
- 2026-09-26: Phase 4 backend scaffold created at `backend/VehicleApp.Api` with initial health, vehicles, and trips endpoints.
- 2026-09-26: Updated API launch profile ports to avoid Vite collision (`http://localhost:5124`, `https://localhost:7124`), verified startup successful.
- 2026-09-26: Implemented first frontend-to-backend data cutover (optional backend vehicle catalog source with safe fallback).
- 2026-09-26: Added frontend backend-catalog settings + Vite `/vehicle-api` proxy; Phase 4 completion criteria satisfied.
- 2026-09-26: Added Phase 5 trip persistence endpoints (`/api/trips/import-by-device`, `/api/trips/day-summaries`).
- 2026-09-26: Verified Phase 5 endpoint flow end-to-end on live database; fixed smoke-test query encoding for day-summary date parameters.
- 2026-09-26: Added frontend manual import action for range-derived trips, including import status feedback in UI.
- 2026-09-26: Hardened frontend/backend import path with proxy rewrite, id fallback, payload validation, and improved backend error diagnostics.
- 2026-09-26: Implemented device binding management workflow in backend + frontend to eliminate manual SQL for routine add/remove mapping operations.
- 2026-09-26: Improved bind+retry UX for unbound-device import failures with shortcut navigation and one-click retry after binding.
- 2026-09-26: Added one-command regression script `scripts/phase5_regression.ps1` (health + smoke + binding-integrity + frontend/backend builds).
- 2026-09-26: Added Phase 5 validation script documentation in `README.md` and `AI_OVERVIEW.md`.
- 2026-09-26: Added request observability baseline (request ID response header, ProblemDetails correlation fields, request timing logs).
- 2026-09-26: Added Phase 6 retention strategy artifacts (private internal retention runbook, `scripts/phase6_vehicle_app_retention.sql`) with 24-month hot retention and archive-first workflow.
- 2026-09-26: Added Phase 5 DTC enrichment foundation schema + API endpoints (`/api/dtc/catalog`, `/api/dtc/events`, import/upsert routes) and sample requests.
- 2026-09-26: Added DTC smoke validation script (`scripts/phase5_dtc_smoke_test.ps1`) and integrated it into `phase5_regression.ps1`.
- 2026-09-26: Fixed `/api/dtc/events` query binding so `limit` is optional (no BadHttpRequestException when omitted).
- 2026-09-26: Added io30 empty-status allowlist support and copy-ready ingest rerun hint for filtered `(empty)` status cases.
- 2026-09-26: Added DTC operational monitoring script (`scripts/phase5_dtc_monitoring_summary.ps1`) for daily/weekly/monthly summaries.
- 2026-09-26: Added Phase 5 enrichment endpoints for named places, trip tags, and trip notes.
- 2026-09-26: Added frontend Settings workflow for named places and trip tags using VehicleApp API endpoints.
- 2026-09-26: Normalized io30 allowlist token parsing (quote/comma cleanup) in ingest script and backend status matching to avoid false filtering of `(empty)` token input variants.

## Evidence Needed to Check Off Phase 1

- Traccar container configuration showing PostgreSQL connection settings (env vars or config file).
- Container/compose configuration showing PostgreSQL data volume or host mount path.
- Existing backup command/script/process for PostgreSQL dumps and Traccar config backup.

## Phase 1 Verification Commands (Run on Linux Host)

Use the following to gather proof for each Phase 1 checkbox.

```bash
# 1) List running containers
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"

# 2) Show compose-defined services/volumes if compose file is available
docker compose config

# 3) Inspect Traccar env/config wiring
docker inspect <traccar_container_name> | grep -Ei "database|jdbc|postgres|DB_"

# 4) Inspect Postgres mounts/volumes
docker inspect <postgres_container_name> | grep -A 20 -Ei "Mounts|Source|Destination"

# 5) Verify Traccar DB settings from config (path may vary)
docker exec -it <traccar_container_name> sh -c "cat /opt/traccar/conf/traccar.xml"

# 6) Check backup jobs/scripts (cron + common backup paths)
crontab -l
sudo ls -la /etc/cron.daily /etc/cron.weekly
find /docker -maxdepth 4 -type f | grep -Ei "backup|dump|postgres|pg_dump|traccar"
```

Store captured outputs in a follow-up note so checklist items can be marked complete with evidence.

## Phase 1 and App Verification Script Pack

Use these scripts to verify DB migration integrity and the current map/export app path.

### A) PostgreSQL data sanity

```bash
# Expected: non-zero counts after migration
docker exec -it <postgres_container_name> psql -U <db_user> -d traccar -c "select count(*) as users from users;"
docker exec -it <postgres_container_name> psql -U <db_user> -d traccar -c "select count(*) as devices from devices;"
docker exec -it <postgres_container_name> psql -U <db_user> -d traccar -c "select count(*) as positions from positions;"

# Expected: no sequence drift (max id <= next sequence value)
docker exec -it <postgres_container_name> psql -U <db_user> -d traccar -c "select max(id) from positions;"
docker exec -it <postgres_container_name> psql -U <db_user> -d traccar -c "select last_value from positions_id_seq;"
```

### B) Index and query baseline (Phase 2 prep)

```bash
# Confirm indexes related to positions
docker exec -it <postgres_container_name> psql -U <db_user> -d traccar -c "\d+ positions"

# Optional: add if missing (confirm real column names first)
# docker exec -it <postgres_container_name> psql -U <db_user> -d traccar -c "create index if not exists ix_positions_device_time on positions (deviceid, fixtime desc);"

# Explain representative history query
docker exec -it <postgres_container_name> psql -U <db_user> -d traccar -c "explain analyze select * from positions where deviceid = <device_id> and fixtime between now() - interval '7 days' and now() order by fixtime asc;"
```

### C) Traccar API auth + data checks

```bash
# Through Vite proxy (from the dev machine while app is running)
curl -i http://localhost:5174/api/server

# With explicit credentials (replace placeholders)
curl -i -u "<email>:<password>" http://localhost:5174/api/server
curl -i -u "<email>:<password>" http://localhost:5174/api/devices

# Device range sample for export path
curl -G -i -u "<email>:<password>" \
  --data-urlencode "deviceId=<device_id>" \
  --data-urlencode "from=2026-09-20T00:00:00.000Z" \
  --data-urlencode "to=2026-09-26T23:59:59.999Z" \
  http://localhost:5174/api/positions
```

### D) Frontend smoke checks

```text
1) Open app -> Settings -> verify API URL is /api and credentials are current for migrated Traccar user.
2) Click Test API -> expect "Connected to Traccar" status.
3) Click Load Range -> expect Devices > 0 and trails/markers on map.
4) Export panel -> choose device/date range -> export CSV succeeds and includes decoded profile columns.
5) Profile editor -> switch profile, save JSON, assign profile to a device, re-export and verify header/value changes.
```

---

## 1. Current Traccar Hosting

Traccar is running locally in a Docker container on a Linux host.

The application is expected to remain primarily self-hosted/local rather than move to a cloud-hosted architecture.

The current telemetry pattern is:

- OBD/GPS data sampled every **5 seconds while driving**
- Records are **batched and sent roughly once per minute** to reduce cellular/session overhead
- The 5-second individual samples are still preserved as separate AVL/position records

This means the database sees approximately:

- 12 records per driving minute
- 720 records per driving hour
- 1,440 records for a 2-hour driving day
- ~526,000 records/year per vehicle at 2 driving hours/day

Even several vehicles remain well within the comfortable range for standard PostgreSQL.

---

## 2. Database Decision

Use **plain PostgreSQL** as the primary database for Traccar.

TimescaleDB is **not necessary at the current scale**.

Reasons for choosing PostgreSQL:

- Excellent fit for Linux/Docker
- Native support by Traccar
- Strong indexing and query performance
- Good JSON/JSONB support for telemetry attributes
- No SQL Server Express size limit
- No licensing concerns
- Excellent .NET support through Npgsql / EF Core
- Easy to add TimescaleDB later if telemetry volume becomes dramatically larger
- Good long-term fit for a locally hosted application

The expected data volume is modest enough that standard PostgreSQL should remain comfortable for many years.

---

## 3. Suggested Docker Layout

A simple local deployment:

```text
Linux Host
│
├── Traccar Container
├── PostgreSQL Container
└── Future Application/API Container
```

Use persistent Docker volumes or host-mounted storage for PostgreSQL.

Example conceptual layout:

```text
/docker
  /traccar
    /config
    /logs

  /postgres
    /data

  /app
    /api
```

Backups should target the PostgreSQL database and the Traccar configuration separately.

---

## 4. Recommended Database Separation

Do not mix future application-specific tables directly into the Traccar database schema.

Preferred structure:

```text
PostgreSQL Instance
│
├── Database: traccar
│     ├── devices
│     ├── positions
│     ├── events
│     ├── geofences
│     └── Traccar-managed tables
│
└── Database: vehicle_app
      ├── vehicles
      ├── trips
      ├── fuel_fills
      ├── maintenance
      ├── named_places
      ├── trip_tags
      ├── alert_rules
      ├── telemetry_profiles
      └── application-derived data
```

This creates a clean boundary:

- **Traccar** remains responsible for device communications, raw position history, events, protocol decoding, and geofences.
- **The custom application** owns higher-level vehicle history, trip enrichment, analytics, maintenance, fuel tracking, alerts, user-facing metadata, and future Automatic/Bouncie-style features.

---

## 5. Position / Telemetry Storage

A typical Traccar position record should remain conceptually similar to:

```text
position
  id
  device_id
  timestamp
  latitude
  longitude
  altitude
  speed
  course
  attributes
```

Telemetry values such as:

- RPM
- coolant temperature
- throttle position
- fuel level
- voltage
- current
- OBD speed
- engine runtime
- DTC information
- GNSS quality
- tracker battery state

are carried through the Traccar position attributes.

PostgreSQL JSONB is a good fit for this type of flexible telemetry.

---

## 6. Suggested Indexing

For telemetry/history queries, the most useful index pattern is:

```sql
CREATE INDEX ix_positions_device_time
ON positions (device_id, fixtime DESC);
```

A secondary time-based index may also be useful:

```sql
CREATE INDEX ix_positions_time
ON positions (fixtime DESC);
```

Exact column names should follow the Traccar schema in use.

The key query pattern is expected to be:

```text
Give me all positions for Device X
between Time A and Time B
ordered chronologically.
```

PostgreSQL handles this pattern very well with a composite device/time index.

---

## 7. Raw vs Derived Data

Avoid prematurely duplicating all raw Traccar telemetry into a second application database.

Initial approach:

```text
Traccar DB
    = source of raw position / telemetry records

Application DB
    = derived and enriched data
```

Examples of derived data:

```text
Trip
  start time
  end time
  distance
  average speed
  max speed
  idle time
  fuel used
  estimated MPG
  start/end locations
  tag
  notes
```

The application can reference:

- Traccar device ID
- position IDs
- time ranges

rather than immediately copying every raw telemetry record.

A separate long-term telemetry warehouse can be added later only if a real need appears.

---

## 8. Future Backend Direction

The current React application directly accesses Traccar.

As the project grows toward Automatic/Bouncie-style functionality, introduce a small backend/API service.

Recommended stack:

```text
React Front End
      ↓
.NET Web API
      ↓
PostgreSQL
      ↓
Traccar API / Traccar PostgreSQL
```

The backend would eventually handle:

- vehicle metadata
- trip persistence
- named places
- fuel fill-ups
- maintenance schedules
- DTC decoding
- alert rules
- notification history
- trip tags
- user preferences
- reporting
- authentication/authorization
- telemetry enrichment

The React application can then become primarily a presentation layer.

---

## 9. TimescaleDB Decision

Do **not** add TimescaleDB now.

Current collection volume does not justify the added complexity.

Revisit TimescaleDB only if one or more of the following becomes true:

- tens or hundreds of millions of position rows
- many more vehicles
- substantially faster sampling rates
- heavy multi-year telemetry analytics
- large aggregate/reporting workloads
- query performance becomes measurably problematic

Because TimescaleDB is built on PostgreSQL, it remains a future option without requiring a complete database-platform change.

---

## 10. Current Recommendation

Use:

```text
PostgreSQL
Docker
Local persistent storage
Regular backups
Separate Traccar and application databases
```

Keep Traccar responsible for the raw tracking/telemetry layer.

Build future Automatic/Bouncie-style functionality in the application/backend layer rather than modifying Traccar itself.

This keeps the system simple now while preserving a clean path to significantly richer functionality later.

## Live vehicle_app migration audit (2026-09-29)

The live database is `vehicle_app` in the `public` schema. The application has one active vehicle and 44 saved trips, spanning 2026-01-15 through 2026-09-29. The derivation metadata column already existed; the derivation index and exact-identity uniqueness index were applied successfully. DTC and trip-event tables are present. Retention archive tables and their indexes were created; no trips are older than 24 months, so the archive is empty and no production rows were moved.

The database does not contain the optional `app_schema_migrations` table. The repository migration scripts remain the deployment record until a migration ledger is introduced.

## Backup and restore verification (2026-09-29)

A compressed `pg_dump -Fc` backup was created on the Linux host, checksummed, and restricted to owner-only permissions. It was restored into the disposable `vehicle_app_restore_test` database with `pg_restore`; the restored database contained all 44 trips. The disposable database was then dropped.

## Architecture update closeout

The live schema, migration status, backup restore path, authentication boundary,
history navigator, automatic trip derivation, event storage, vehicle statistics,
operational reports, and the Bouncie historical backfill are implemented and
documented. Bouncie imports use encrypted server-side credentials, OAuth
callbacks, seven-day rate-limited windows, bounded retries, durable checkpoints,
GPS route storage, and visible coverage/failure status. Remaining checklist
items are intentionally data-dependent or release-management work: observing
OBD2 fields over time, tuning growth thresholds, archiving once a trip becomes
eligible, and creating a release snapshot when the deployment owner is ready.

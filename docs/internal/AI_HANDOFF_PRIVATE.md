# Traccar React Tool Overview (AI Handoff)

> Internal handoff document for ongoing implementation context.
> Not intended to be a public-facing product README.

As of 2026-09-27.

## Current Priority: Trip Identity and Import Correctness

The user approved a correctness-first sequence: stable persisted trip identity, safe
reimports, preservation of notes/tags, focused regressions, then automatic named-place
labels. The earlier v1 stop point was a scope decision to defer minor refinements.

First increment implemented (2026-09-26):

- `GET /api/trips/resolve` resolves an exact Traccar device ID and start/end timestamp
  pair to the saved trip UUID and its historical vehicle, independent of current bindings.
- Known source position IDs must agree. Legacy rows without them can still resolve by
  exact device/timestamps. Duplicate exact rows return 409; no match returns 404.
- Trip metadata editing stays disabled until a unique saved trip and its metadata load.
  Late selection responses and old write completions cannot overwrite a new selection.
- Traccar position IDs now survive normalization, trip derivation, and import payloads.
- Removed numeric `uniqueId` fallback for trip import. Bind the actual Traccar `/devices`
  `id`; hardware identifiers are not interchangeable with database device IDs.
- Settings includes a map position picker for named-place latitude/longitude.

Validation: `npm test` (8 checks), `dotnet run --project tests/TripIdentity.Tests`
(12 checks), frontend build, backend build to `.artifacts/trip-identity-api`.
Tests are isolated and do not mutate the live database. Restart/rebuild the running API
before using the updated frontend's trip metadata editor; it requires the new endpoint.

Second increment implemented (2026-09-27):

- Trip imports take a PostgreSQL transaction advisory lock per device. Read-committed
  snapshots after the lock serialize participating API instances, not just one process.
- Exact replays return the original trip UUID and vehicle, even if the active binding
  changed or disappeared. They do not overwrite metrics, notes, tags, or source IDs.
- Partial/wider overlaps, conflicting source IDs, and pre-existing duplicates return
  HTTP 409 and roll back the entire batch, including earlier inserts in that request.
- Adjacent trips whose endpoints only touch remain valid. Per-item results include
  saved identity and `imported`/`existing` outcomes. The response's aggregate vehicleId
  is null if one batch contains saved/new records belonging to different vehicles.
- New trips still use the current active binding (historical binding resolution remains
  pending). Ambiguous active bindings are rejected rather than selected arbitrarily.
- `scripts/trip_import_audit.sql` is read-only. `scripts/trip_import_uniqueness.sql`
  adds a default-source exact-identity unique index, refusing existing duplicates.
  The migration has not been applied to the app database. API serialization is active
  without it; direct SQL writers need this extra uniqueness protection and must not
  bypass overlap validation.
- `tests/TripImport.IntegrationTests` calls the actual import endpoint method using a
  disposable PostgreSQL schema and verifies concurrency, rollback, metadata, and index
  behavior. It never uses existing app tables. See README for configuration and commands.
- Validation complete for this increment: 9 frontend checks, 12 identity checks,
  and 27 PostgreSQL integration checks passed (48 total); frontend/backend builds pass.
  The user ran the integration suite on 2026-09-27 in the PowerShell session containing
  `ConnectionStrings__VehicleApp` and provided the full PASS output. The disposable
  schema was removed successfully; existing app records were not modified.
- Runtime database: `vehicle_app` on `192.168.16.16:55432`; Traccar's separate database
  is named `traccar`. Working credentials come from a PowerShell-session environment
  variable, not the repository defaults. Tool shells do not inherit that session's
  variable. Never copy credentials into the repository or handoff documents.
- The uniqueness migration passed in the disposable test schema only; it has not been
  applied to existing app tables. The earlier API restart activated the first increment,
  not necessarily the subsequently implemented import protections.

The running API must be rebuilt/restarted after backend changes; the user has restarted
it throughout validation.
Third increment implemented (2026-09-27): device bindings now accept an explicit
`effectiveFrom` date. New imports choose the unique binding that fully covers the
trip's start/end timestamps. Trips in a binding gap, trips crossing a reassignment,
and ambiguous binding history return HTTP 409 instead of being assigned by current
state. The Settings binding editor exposes the effective date. Historical replays
continue to use the saved trip's original vehicle. The disposable PostgreSQL suite
now covers historical assignment and reassignment-crossing rejection; rerun it in
the PowerShell session carrying `ConnectionStrings__VehicleApp`.

Fourth increment implemented (2026-09-27): imported trips now record a
`derivation_version` (currently `trip-v2-events-movement-<threshold>` for completed metric and event detection; imports may remain on the older metric-only version until the day is viewed), and the additive
`scripts/phase5_trip_derivation_schema.sql` migration creates the column/index for
existing deployments. Startup also adds the column when the app schema is present.
This records which derivation rule produced a trip; it does not recalculate or replace
annotated trips. A future recalculation workflow must create a deliberate new version
and preserve the old annotated result.

Trip list responses now include `derivationVersion`, allowing the UI and future
recalculation workflow to distinguish trips produced by different rules without
changing their saved identity or annotations.

Fifth increment implemented (2026-09-27): `POST /api/trips/{tripId}/recalculate`
requires a saved trip UUID and a new derivation version. It updates derived metrics and
source position IDs while preserving the UUID, vehicle, timestamps, notes, labels, and
tag relationships. No replacement identity is inferred and no overlap is merged. The
frontend API helper and regression coverage are included; there is no recalculation UI
yet. Existing duplicate or misbound data is not automatically merged or reassigned.

Sixth increment implemented (2026-09-27): imported trips now carry their endpoint
coordinates through derivation. The frontend matches each endpoint to the nearest
vehicle-scoped or global named place within that place's configured radius and sends
the resulting `startLabel`/`endLabel` with the import. Existing trips are unchanged;
labels are only assigned during a new import or explicit recalculation.
Partial/recalculated ranges without an exact saved match remain non-editable, and
imports with changed overlapping boundaries now explicitly conflict. Multi-source
resolution is not enabled; current contracts use a null `traccar_source_id`.

## Backend Migration Update Log

This log tracks execution of the PostgreSQL/backend architecture plan from `Traccar_PostgreSQL_Backend_Architecture_Update.md`.

### Checklist Snapshot

- [x] Phase 0: Architecture document reviewed.
- [x] Phase 0: Export path verified/updated to fetch from Traccar API by device + range.
- [x] Phase 1: PostgreSQL container and persistence validation (user-reported complete in architecture tracker).
- [x] Phase 2: Traccar positions schema/index verification and performance validation complete.
- [x] Phase 3: `vehicle_app` boundary and initial schema definition.
- [x] Phase 4: Backend API scaffolding and first endpoints.
- [x] Phase 5: Derived/enriched data persistence for trips/bindings is implemented and regression-tested (enrichment pipeline still pending).
- [ ] Phase 6: Operations, retention, and scale review (manual daily, growth, maintenance, and retention-preview reports are available; retention execution cadence and long-term growth thresholds remain operational follow-up).

### Log Entries

- 2026-09-25: Added backend migration checklist and phased update tracking.
- 2026-09-25: Confirmed export workflow is database-backed through Traccar `/positions` query at export time.
- 2026-09-25: Began architecture execution review pass.
- 2026-09-25: No Docker/PostgreSQL runtime config artifacts found in this repo; Phase 1 validation requires host/container inspection evidence.
- 2026-09-26: Synced with updated architecture tracker; Phase 1 marked complete per host migration checklist.
- 2026-09-26: Frontend regression triage: repaired corrupted `App.css`; remaining runtime issue is Traccar API `401 Unauthorized` from app settings/auth.
- 2026-09-26: User confirmed map/range loading now works after local browser/settings update.
- 2026-09-26: Added `scripts/phase2_positions_audit.sql` and `docs/internal/runbooks/phase2_runbook.md` to execute/check off Phase 2.
- 2026-09-26: Updated Phase 2 runbook with host-path troubleshooting and fallback execution options after `docker cp` path error.
- 2026-09-26: Updated Phase 2 SQL audit to support Traccar `tc_positions` naming and removed failing psql variable pattern.
- 2026-09-26: Added runbook verification step to confirm `/tmp/phase2_positions_audit.sql` inside `traccar-db` is the latest script before executing.
- 2026-09-26: Confirmed Traccar `tc_*` schema pattern from host relation listing (includes `tc_positions`).
- 2026-09-26: Switched Phase 2 operational guidance to psql-first execution (no host repo copy dependency).
- 2026-09-26: Captured `tc_positions` column layout and confirmed existing `position_deviceid_fixtime (deviceid, fixtime)` index.
- 2026-09-26: No new composite index required right now; awaiting EXPLAIN output to complete Phase 2 performance validation.
- 2026-09-26: EXPLAIN ANALYZE completed: index-backed history filter, ~13.3 ms execution for 7-day device window; Phase 2 marked complete.
- 2026-09-26: Completed Phase 3 planning (separate `vehicle_app` boundary + soft reference strategy).
- 2026-09-26: Added starter app DB DDL at `scripts/phase3_vehicle_app_schema.sql`.
- 2026-09-26: Created `backend/VehicleApp.Api` (.NET 9 minimal API) and added initial endpoints (`/health`, `/api/vehicles`, `/api/trips`).
- 2026-09-26: Added `ConnectionStrings:VehicleApp` placeholders and API smoke requests in `backend/VehicleApp.Api/VehicleApp.Api.http`.
- 2026-09-26: Resolved API startup port conflict with Vite by moving launch profiles to 5124/7124; startup verified.
- 2026-09-26: Added first frontend cutover switch: optional backend vehicle catalog source (`/vehicle-api/api/vehicles`) with fallback to Traccar `/api/devices`.
- 2026-09-26: Backend `/api/vehicles` now includes `traccarDeviceId` mapping via active binding; frontend can safely use backend catalog for device list.
- 2026-09-26: Added backend trip persistence endpoints: `POST /api/trips/import-by-device` and `GET /api/trips/day-summaries`.
- 2026-09-26: Added scripted Phase 5 endpoint smoke test utility at `scripts/phase5_smoke_test.ps1`.
- 2026-09-26: Validated Phase 5 backend flow end-to-end against live PostgreSQL (`health` OK, `vehicles` lookup, `import-by-device` insert, `day-summaries` aggregate).
- 2026-09-26: Added frontend manual trip-import action in Export panel to push derived range trips to backend `/api/trips/import-by-device` with UI status feedback.
- 2026-09-26: Fixed Vite vehicle API proxy rewrite (`/vehicle-api` prefix strip) so import route resolves correctly in dev.
- 2026-09-26: Added frontend import fallback from Traccar numeric id to numeric `uniqueId` binding and filtered invalid derived trip payload entries before POST.
- 2026-09-26: Improved backend `/api/trips/import-by-device` error diagnostics to return explicit PostgreSQL/general failure details instead of opaque 500 responses.
- 2026-09-26: Added device binding management endpoints (`GET /api/device-bindings`, `POST /api/device-bindings/upsert`) and a Settings UI panel to bind Traccar device ids to existing vehicles without manual SQL.
- 2026-09-26: Added import-failure binding shortcut improvements: auto-suggested vehicle selection when opening bind flow and one-click "Save Binding and Retry Import" path.
- 2026-09-26: Added one-command Phase 5 regression runner (`scripts/phase5_regression.ps1`) with PASS summary output.
- 2026-09-26: Added dedicated binding integrity regression script (`scripts/phase5_binding_integrity_test.ps1`) and deterministic smoke summary output.
- 2026-09-26: Improved backend/frontend error observability with richer ProblemDetails handling and cleaner frontend API error parsing.
- 2026-09-26: Added request observability middleware (`X-Request-Id`, request-timing logs, ProblemDetails correlation fields).
- 2026-09-26: Added retention strategy artifacts for `vehicle_app` trip archival (`docs/internal/runbooks/phase6_retention_runbook.md`, `scripts/phase6_vehicle_app_retention.sql`) with 24-month hot retention policy.
- 2026-09-26: Added DTC enrichment foundation: schema script (`scripts/phase5_dtc_enrichment_schema.sql`) and backend endpoints for catalog upsert/read and event import/read.
- 2026-09-26: Added DTC smoke script (`scripts/phase5_dtc_smoke_test.ps1`) and wired it into `scripts/phase5_regression.ps1`.
- 2026-09-26: Fixed DTC events endpoint query binding (`limit` optional with default) to avoid runtime 500 when omitted.
- 2026-09-26: Added raw Traccar DTC decode ingestion endpoint (`POST /api/dtc/events/import-from-traccar`) and smoke coverage for decode/import/query flow.
- 2026-09-26: Strengthened DTC import idempotency (dedupe includes `sourceEventId`) and added smoke assertion for duplicate decode replay skip behavior.
- 2026-09-26: Added one-command Traccar pull+decode ingest script (`scripts/phase5_dtc_traccar_ingest.ps1`) for operator workflow from raw positions/events to backend DTC import.
- 2026-09-26: Added Traccar payload probe utility (`scripts/phase5_dtc_traccar_probe.ps1`) to capture attribute key frequency and sample payload artifacts for DTC field mapping.
- 2026-09-26: Added optional io30 fallback support in Traccar decode ingest to persist synthetic `IO30_COUNT` events when explicit DTC code strings are absent.
- 2026-09-26: Added io30 fallback status allowlist guardrail (`io30FallbackAllowedStatuses`) to constrain synthetic `IO30_COUNT` emissions to expected Traccar status/event types.

## 1) Purpose

This project is a React + Vite migration of a legacy single-file Traccar UI. It provides map visualization, time-range history loading, trip/day summaries, and OBD2-oriented CSV export with profile-based decoding.

Legacy reference file previously lived in the parent folder as `../traccar.html` and has since been removed from the publishable tree.

## 2) Tech Stack

- React (functional components + hooks)
- Vite
- Leaflet (OpenStreetMap tiles)
- Browser localStorage persistence (settings, profile definitions, profile assignments)

## 3) Main User Features (Currently Implemented)

### Connectivity and Session Handling

- Configurable API base URL, username, and password in Settings.
- API test button calls Traccar server endpoint.
- Session-aware API helper:
  - Sends credentialed requests.
  - Uses Basic auth header when username/password are set.
  - On first 401, attempts login via `/session` and retries original request.
  - Tracks session state (`unknown`, `ok`, `failed`) for UI status.

### Map and Device Visualization

- Leaflet map with OpenStreetMap tile layer.
- Loads devices from Traccar and assigns a stable color per device from a palette.
- Per-device visibility toggle.
- Draws:
  - latest marker per visible device
  - polyline trail from loaded points
- Auto-fit bounds to currently visible device markers.

### Time Range Loading

- Range modes for map/history loading:
  - Real Time (rolling N hours)
  - Today
  - Yesterday
  - Last 7 Days
  - Custom datetime range
- Custom range validation ensures from < to.
- Realtime polling updates active positions at configured interval.
- Active range label and status text are shown in UI.

### Trip and Day Summaries

- Trip detection based on movement threshold (meters) and event gap logic.
- Groups movement events into trips.
- Aggregates trips by day with trip count and total distance.
- Day selection filters visible trips.
- Trip selection focuses map bounds to trip points.

### OBD2 / Telemetry CSV Export

- Export panel supports selecting:
  - device
  - range preset (Today / This Week / This Month / This Year / Custom)
  - custom start/end dates when custom selected
- Exports points by querying Traccar `/positions` for the selected device and export range (database-backed via Traccar API).
- CSV includes:
  - `timestampIso`
  - `timestampLocal` (human-readable local timestamp)
  - latitude/longitude
  - imperial base fields (`speedMph`, `accuracyFt`, `altitudeFt`)
  - all discovered attributes from points
- Attribute columns are profile-aware:
  - header translation (label + AVL + units)
  - value conversion and sentinel filtering

### Car Profiles (Per Device + Master Editor)

- Each device has a profile selector in the device list.
- Master profile editor in Settings:
  - select profile
  - edit profile name
  - edit attribute translation JSON map
  - save profile
  - create new profile (copy)
  - delete selected profile (except default)
- Deleting a profile reassigns affected devices to a fallback profile.
- Default bundled profile: `2010 Buick Enclave`.
- Conversions currently supported in profile decoder:
  - km/h to mph
  - C to F
  - meters to miles
  - liters to gallons
  - g/s to lb/min

### Theme and UI Settings

- Theme modes: Auto, Light, Dark.
- Auto theme follows system color-scheme changes.
- Configurable:
  - polling interval
  - realtime lookback hours
  - movement threshold

## 4) Persistence and Storage Keys

Stored in localStorage:

- `traccarReactSettings`
- `traccarProfileDefinitions`
- `traccarDeviceProfileAssignments`

## 5) Key Module Responsibilities

- `src/App.jsx`
  - top-level orchestration and state wiring
  - map lifecycle, range loading, polling, export flow
  - profile definition/editor state and actions

- `src/lib/traccarApi.js`
  - session-aware fetch wrapper and error shaping

- `src/lib/geo.js`
  - position normalization and distance math

- `src/lib/trips.js`
  - movement-event to trip generation, day summary aggregation

- `src/lib/time.js`
  - history range and export date range helpers

- `src/lib/csvExport.js`
  - CSV schema construction and browser download trigger

- `src/lib/carProfiles.js`
  - profile model, default profile definitions, conversion rules

- `src/lib/profileStore.js`
  - profile and assignment persistence helpers

- `src/components/*`
  - panel-oriented UI components (range, status, devices, day/trip lists, export, settings)

## 6) Runtime / Networking Notes

- Dev proxy routes `/api` to Traccar target from Vite config.
- Default proxy target is `http://192.168.16.16:8082`; override with `VITE_TRACCAR_TARGET` when the host changes.
- Overridable via environment variable `VITE_TRACCAR_TARGET`.

## 7) Current Constraints / Behavior Notes

- Export fetches range data directly from Traccar API at export time; if Traccar server-side limits are configured, very large ranges may require pagination support in future.
- Profile editor uses raw JSON text editing (not table-driven yet).
- Credentials are persisted in localStorage as part of settings.
- README in this repo is partially outdated relative to current implemented features; this document is the current feature snapshot.

## 8) Suggested Next Enhancements

- Table-based profile editor UX (instead of raw JSON textarea).
- Confirm dialog before profile deletion.
- Profile import/export files for sharing mappings across environments.

## 9) Phase 5 Operator Validation Commands

Run from `traccar-react` root in PowerShell.

### Smoke Test (Deterministic)

```powershell
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_smoke_test.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarDeviceId 141880
```

Expected summary:

- `SMOKE SUMMARY: PASS deterministic dedupe confirmed (...)`
- or first-run seed message: `SMOKE SUMMARY: INFO deterministic seed inserted on this run (...)`

### Binding Integrity Test

```powershell
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_binding_integrity_test.ps1" -ApiBaseUrl "http://localhost:5124"
```

Expected summary:

- `BINDING SUMMARY: PASS one active primary binding remains and latest upsert wins.`

### Full Regression Runner

```powershell
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_regression.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarDeviceId 141880 -BindingTestDeviceId 1999999999
```

Expected summary:

- `REGRESSION SUMMARY: PASS phase 5 smoke, binding integrity, and build checks completed.`

## Current operational status (2026-09-29)

The live `vehicle_app` database was audited after the architecture update. It
uses the `public` schema, contains one active catalog vehicle and 44 trips, and
has the derivation, uniqueness, event, DTC, and retention structures applied.
No trips were eligible for the 24-month archive at audit time. A compressed
`pg_dump` was restored into a disposable database and verified to contain all
44 trips before that database was removed.

VehicleApp now supports optional single-user authentication through
`VEHICLE_APP_AUTH_USERNAME` and `VEHICLE_APP_AUTH_PASSWORD`. When configured,
the API requires the HttpOnly `vehicle_app_session` cookie for `/api/*`; the
frontend login and sign-out controls use the same session. The deployment
connection details and backup procedure are documented in `README.md` and
`docs/internal/runbooks/vehicle_app_backup_restore.md`.

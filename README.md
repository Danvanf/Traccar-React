# Traccar React Migration

This folder contains a modern React + Vite migration baseline for the original single-file app.

## License

This project is licensed under AGPLv3. See:

- `LICENSE`
- `LICENSING.md` (plain-language usage and compliance notes)

## License FAQ

### Can someone use this in a commercial system?

Yes. AGPLv3 allows commercial use.

### What if they modify and run the backend over a network?

They must provide the corresponding source code of that modified AGPL-covered
version to users who interact with it over the network.

### Can this repo block all commercial backend use while staying pure AGPLv3?

No. AGPLv3 does not permit adding extra field-of-use restrictions. To enforce
that kind of restriction, use a separate commercial license model with legal
advice.

## What Is Included

- React app shell with persisted API settings
- Leaflet map rendering with live position markers
- Buttons to test API connectivity and load live snapshot data
- Vite dev proxy for `/api` to avoid browser CORS issues during local development

## Code Structure

- `src/App.jsx`: orchestration and state composition
- `src/components/`: UI sections (`RangeControls`, `StatusCard`, `DeviceList`, `DayPanel`, `TripPanel`, `SettingsModal`)
- `src/lib/settings.js`: settings defaults and persistence
- `src/lib/time.js`: range helpers and datetime-local utilities
- `src/lib/geo.js`: distance and position normalization helpers
- `src/lib/trips.js`: trip detection and day summary logic
- `src/lib/traccarApi.js`: session-aware API client

## Legacy File

The original single-file prototype has been retired from this publishable tree.

## Run Locally

```bash
cd traccar-react
npm install
npm run dev
```

Default API base in the app is `/api`.

## Proxy Target

By default, dev proxy sends `/api` to:

`http://<traccar-host>:8082`

You can override that target:

```bash
VITE_TRACCAR_TARGET=http://<traccar-host>:8082 npm run dev
```

## Next Migration Steps

- Move timeline and filtering logic from legacy file into React components
- Add auth/session workflow for Traccar endpoints
- Add settings modal, theme controls, and trip/day panel features

## Screenshots

Place publishable screenshots in:

- `docs/screenshots/`

Capture conventions and recommended views are documented in:

- `docs/screenshots/README.md`

## Phase 5 Validation Scripts

Run these from PowerShell to validate backend import, binding integrity, and frontend/backend build health.

### Deterministic Smoke Test

```powershell
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_smoke_test.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarDeviceId 141880
```

Expected summary line:

- `SMOKE SUMMARY: PASS deterministic dedupe confirmed (...)`
- or first-run seed message: `SMOKE SUMMARY: INFO deterministic seed inserted on this run (...)`

### Binding Integrity Regression Test

```powershell
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_binding_integrity_test.ps1" -ApiBaseUrl "http://localhost:5124"
```

Expected summary line:

- `BINDING SUMMARY: PASS one active primary binding remains and latest upsert wins.`

### DTC Enrichment Smoke Test

```powershell
pwsh -ExecutionPolicy Bypass -File ".\\scripts\\phase5_dtc_smoke_test.ps1" -ApiBaseUrl "http://localhost:5124"
```

Expected summary line:

- before applying DTC schema: `DTC SUMMARY: SKIP schema missing. Apply scripts/phase5_dtc_enrichment_schema.sql first.`
- after schema + mappings are ready: `DTC SUMMARY: PASS catalog upsert/import/decode/query flow verified with idempotent duplicate skip.`

### DTC Pull + Decode Ingest (From Traccar)

```powershell
$env:TRACCAR_USERNAME = "<email>"
$env:TRACCAR_PASSWORD = "<password>"
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_dtc_traccar_ingest.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarBaseUrl "http://<traccar-host>:8082" -TraccarDeviceId 5 -Source both
```

Expected summary line:

- no dtc-like payloads in window: `INGEST SUMMARY: SKIP no DTC-like records found in selected Traccar window/source.`
- dtc-like payloads found/imported: `INGEST SUMMARY: PASS pulled=... candidates=... imported=... skipped=...`

Fallback option:

- add `-IncludeIo30Fallback` to persist synthetic `IO30_COUNT` diagnostics when payloads include DTC count (`io30`) but no explicit code strings.
- add `-IncludeIo30ZeroBaseline` (with `-IncludeIo30Fallback`) to emit a first-seen baseline `IO30_COUNT` event even when `io30=0`.
- add `-Io30FallbackAllowedStatuses` (with `-IncludeIo30Fallback`) to restrict synthetic `IO30_COUNT` events to specific status/event types (example: `alarm`, `obd`).
- if Traccar records have no status/type value, include `'(empty)'` (or `empty`) in `-Io30FallbackAllowedStatuses` (example: `alarm,obd,'(empty)'`).

Common preflight guardrails:

- if Traccar base URL/port is unreachable, script fails early with TCP hints and suggested port override.
- if account authenticates but has no device access, script fails early with: `Traccar account can authenticate but has no visible devices...`
- if account cannot access requested device id, script prints visible device ids for quick remediation.

### DTC Payload Probe (From Traccar)

Use this helper to inspect raw position/event attributes and identify where Traccar surfaces DTC code strings.

```powershell
$env:TRACCAR_USERNAME = "<email>"
$env:TRACCAR_PASSWORD = "<password>"
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_dtc_traccar_probe.ps1" -TraccarBaseUrl "http://<traccar-host>:8082" -TraccarDeviceId 5 -Source both -FromUtc ([DateTimeOffset]::UtcNow.AddDays(-7)) -ToUtc ([DateTimeOffset]::UtcNow)
```

Expected summary line:

- `PROBE SUMMARY: PASS positions=... events=... codePattern=... output=...`

Output artifact:

- JSON file written under `scripts/artifacts/` with top attribute-key frequencies and sample attribute payloads.

### DTC Monitoring Summary (Daily/Weekly/Monthly)

Use this helper to generate operational DTC counts by vehicle across daily, weekly, and monthly windows.

```powershell
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_dtc_monitoring_summary.ps1" -ApiBaseUrl "http://localhost:5124"
```

Optional filters:

- one vehicle only: `-VehicleId <vehicle-guid>`
- custom lookback: `-LookbackDays 60`
- include top explicit code breakdown table: `-IncludeCodeBreakdown`

Expected summary line:

- `MONITOR SUMMARY: PASS generated daily/weekly/monthly DTC metrics.`

### One-Command Regression Runner

```powershell
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_regression.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarDeviceId 141880 -BindingTestDeviceId 1999999999
```

What it runs:

- `/health` check
- deterministic smoke test
- binding integrity regression test
- DTC enrichment smoke test (optional; skip-safe before DTC schema rollout)
- optional Traccar pull+decode ingest stage (enable with `-RunDtcTraccarIngest`; uses `TRACCAR_USERNAME`/`TRACCAR_PASSWORD` env vars)
- frontend build (`npm run build`)
- backend build (`dotnet build -o bin_check`)

Phase 5 enrichment UI note:

- Settings now includes backend-managed lists for Named Places and Trip Tags, with save/delete actions for place entries and save actions for tag entries.

Example with ingest enabled:

```powershell
$env:TRACCAR_USERNAME = "<email>"
$env:TRACCAR_PASSWORD = "<password>"
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_regression.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarDeviceId 5 -BindingTestDeviceId 1999999999 -RunDtcTraccarIngest -TraccarBaseUrl "http://<traccar-host>:8082" -TraccarIngestFromUtc ([DateTimeOffset]::UtcNow.AddDays(-7)) -TraccarIngestToUtc ([DateTimeOffset]::UtcNow)

# optional: include io30 fallback in ingest stage
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_regression.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarDeviceId 5 -BindingTestDeviceId 1999999999 -RunDtcTraccarIngest -TraccarBaseUrl "http://<traccar-host>:8082" -TraccarIngestFromUtc ([DateTimeOffset]::UtcNow.AddDays(-7)) -TraccarIngestToUtc ([DateTimeOffset]::UtcNow) -TraccarIngestIncludeIo30Fallback

# optional: include io30 zero baseline in ingest stage
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_regression.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarDeviceId 5 -BindingTestDeviceId 1999999999 -RunDtcTraccarIngest -TraccarBaseUrl "http://<traccar-host>:8082" -TraccarIngestFromUtc ([DateTimeOffset]::UtcNow.AddDays(-7)) -TraccarIngestToUtc ([DateTimeOffset]::UtcNow) -TraccarIngestIncludeIo30Fallback -TraccarIngestIncludeIo30ZeroBaseline

# optional: restrict io30 fallback to expected Traccar status/event types
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_regression.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarDeviceId 5 -BindingTestDeviceId 1999999999 -RunDtcTraccarIngest -TraccarBaseUrl "http://<traccar-host>:8082" -TraccarIngestFromUtc ([DateTimeOffset]::UtcNow.AddDays(-7)) -TraccarIngestToUtc ([DateTimeOffset]::UtcNow) -TraccarIngestIncludeIo30Fallback -TraccarIngestIncludeIo30ZeroBaseline -TraccarIngestIo30FallbackAllowedStatuses alarm,obd

# optional: allow empty status/type records too
pwsh -ExecutionPolicy Bypass -File ".\scripts\phase5_regression.ps1" -ApiBaseUrl "http://localhost:5124" -TraccarDeviceId 5 -BindingTestDeviceId 1999999999 -RunDtcTraccarIngest -TraccarBaseUrl "http://<traccar-host>:8082" -TraccarIngestFromUtc ([DateTimeOffset]::UtcNow.AddDays(-7)) -TraccarIngestToUtc ([DateTimeOffset]::UtcNow) -TraccarIngestIncludeIo30Fallback -TraccarIngestIncludeIo30ZeroBaseline -TraccarIngestIo30FallbackAllowedStatuses alarm,obd,'(empty)'
```

Expected summary line:

- `REGRESSION SUMMARY: PASS phase 5 smoke, binding integrity, and build checks completed.`

## Trip Identity Correctness Checks

```powershell
npm test
dotnet run --project tests/TripIdentity.Tests/TripIdentity.Tests.csproj
# Separate output avoids the DLL lock when the development API is already running.
dotnet build backend/VehicleApp.Api/VehicleApp.Api.csproj --no-restore -o .artifacts/trip-identity-api -p:UseAppHost=false
```

These checks do not modify the live database. Restart/rebuild the development API to
activate `GET /api/trips/resolve` before using the updated trip metadata editor.
Only an exact, unique saved trip can be edited; nearby, partial, and duplicate trips
are not guessed. Bindings must use the actual Traccar device `id`, not `uniqueId`.
See `AI_OVERVIEW.md` for the current correctness milestone and remaining work.

## Safe Trip Import Regression

Run from the repository root:

```powershell
dotnet run --project tests/TripImport.IntegrationTests/TripImport.IntegrationTests.csproj --artifacts-path .artifacts/import-tests
```

The runner uses `TRIP_IMPORT_TEST_CONNECTION` when set; otherwise it reads the API
appsettings files and environment overrides (including `ConnectionStrings__VehicleApp`).
Optional `TRIP_IMPORT_TEST_HOST` and `TRIP_IMPORT_TEST_PORT` override only the target
host/port while retaining the configured credentials. Use your local/private runtime
database host and port; repository defaults may be placeholders.
Supply the working connection through your local environment, not a command-line argument or
committed file. The configured role needs permission to create a schema in the selected
database. The runner creates a random `trip_import_test_<guid>` schema, loads the baseline
DDL there, sets a search path with no fallback to app tables, runs the actual import
handler, then removes only that schema. Existing vehicles, bindings, trips, and tags
are never used as fixtures. An interrupted process can leave its disposable schema;
normal failures clean it up in `finally`.

Coverage includes 12 concurrent exact retries, competing overlapping requests, atomic
batch rollback, source-ID conflicts, annotation preservation, binding changes on replay,
and duplicate-safe uniqueness migration behavior. This runner requires PostgreSQL;
a successful build alone is not a passing integration test.

Import policy: exact device/time identities reuse the saved UUID without replacing
metrics or annotations. Changed overlapping boundaries produce HTTP 409 and save
nothing from that request. This deliberately does not merge or recalculate trips.

For extra protection against exact duplicates from direct SQL writers, first run
`scripts/trip_import_audit.sql`, then apply `scripts/trip_import_uniqueness.sql` while
connected to the **vehicle_app database** with the app's search path. The migration
locks the trips table briefly and refuses existing duplicates without changing records.
Do not run the Phase 3 database bootstrap against an existing deployment. The unique
index does not enforce the overlap rule; writes must still go through the import API.
## Phase 6 operations

The repository includes read-only operational reports for the `vehicle_app` database:

- `scripts/phase6_daily_health.sql` — daily trip and DTC activity, including no-import warnings.
- `scripts/phase6_growth_health.sql` — table and schema size thresholds.
- `scripts/phase6_maintenance_health.sql` — dead-row and stale-statistics review.
- `scripts/phase6_vehicle_app_retention.sql` — 24-month archive workflow, safe by default with an explicit commit step.

Recommended cadence:

- Daily: run the activity report after the normal import window.
- Weekly: review maintenance health and schedule `VACUUM (ANALYZE)` when flagged.
- Monthly: review growth and backup duration.
- As needed: archive trips older than 24 months during a low-traffic window.

## VehicleApp authentication and deployment

Authentication is optional for local development. To enable the single-user
session, configure the API process with environment variables (keep the values
out of source control and logs):

```text
VEHICLE_APP_AUTH_USERNAME=<login name>
VEHICLE_APP_AUTH_PASSWORD=<secret>
```

The API issues an HttpOnly `vehicle_app_session` cookie after `/auth/login`;
all `/api/*` endpoints require that session. The frontend provides the login
screen and sign-out control. If either variable is absent, authentication is
disabled for local compatibility.

Deployment hostnames and ports are environment-specific. Keep them in local
environment variables and deployment files, not in committed docs or scripts.
The Vite development proxy exposes the backend under `/vehicle-api/`. See
`docs/internal/runbooks/vehicle_app_backup_restore.md` and
`VEHICLE_APP_DOCKER_DEPLOYMENT.md` for Linux/Docker deployment and backup
guidance.

The Import / Export panel also accepts Bouncie CSV trip history. Apply
`scripts/phase8_bouncie_import_schema.sql` to `vehicle_app` first. Rows match
catalog vehicles by VIN (with make/model/year fallback), preserve Bouncie speed
and event flags, and use a durable external identity so overlapping exports
skip previously imported trips. Bouncie exports do not include event timestamps;
those imported event records use the trip start time and retain the original
flag in their evidence JSON. Start/end coordinates and addresses are preserved
for map markers and trip details; odometer, Curfew, and alert-only fields are
ignored as metrics but the original CSV row is retained as trip source metadata
for future mapping. Bouncie summaries belong in `vehicle_app`; raw
Traccar telemetry remains in the Traccar database.

The same Restore CSV control also recognizes the application's own position
export by its `timestampIso,latitude,longitude,speedMph,...` headers. Select the
target Traccar device first; the file's points are restored into the current
session and the existing duplicate-safe trip import is attempted. This is a
raw-position restore, so it does not recreate server-side notes, tags, or
events. Use the PostgreSQL backup procedure above for a complete `vehicle_app`
backup and restore.

The Settings panel also has a Bouncie REST connection and rate-limited history
importer. Enter the OAuth client ID and registered redirect URL, then use
Connect with Bouncie to complete the provider consent flow before choosing an
inclusive From/Through date range. The callback authorization code is exchanged
and discarded by the API; it is never stored in the browser. The separate
Bouncie API Key shown in its portal is not used by this OAuth token exchange.
The API encrypts the client secret and refresh token before storing them in
`bouncie_credentials`; set
`VEHICLE_APP_BOUNCIE_ENCRYPTION_KEY` to a base64-encoded 32-byte deployment
secret and keep that key outside the database and source tree. The API can
restore the encrypted connection after a restart without sending secrets
back to the browser. Requests are split into seven-day windows with a delay
between calls and bounded retries for transient provider failures. Completed
windows are checkpointed in `bouncie_import_checkpoints`; a rerun skips those
windows and retries failed ones. Raw trip payloads are retained, GPS route
points are stored when returned, and Bouncie vehicles are matched to the
existing Vehicle Catalog by VIN or make/model/year. Unmatched vehicles are
reported and are not created automatically. Settings shows completed backfill
coverage and failed-window counts.

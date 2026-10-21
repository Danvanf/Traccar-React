# Traccar Scope: AI handoff

## Product identity

The selected product name is **Traccar Scope**. Source code, project names, installers, and active documentation use the Traccar Scope names. The one-time development data and runtime cutover is complete. See the [archived renaming plan](docs/archive/project-plans/TRACCAR_SCOPE_RENAMING_PLAN.md) for the completed transition record. Do not add permanent old-name aliases or compatibility readers.

## Backend status

The backend is **Traccar Scope API**. Its project is `backend/TraccarScope.Api/TraccarScope.Api.csproj`, assembly is `traccar_scope_api.dll`, database is `traccar_scope_api`, and proxy prefix is `/traccar-scope-api`. The development database has been renamed from `traccar_react_api` after a readable backup was verified. The renamed API is running, saved Traccar credentials decrypt successfully, and the browser app has passed core sign-in, map/history, telemetry graph, profile editor, access-list, and reports smoke checks. Fresh combined installations create the Scope database with `scripts/docker_init_traccar_scope_api_db.sh`. Remaining old strings are deliberate migration inputs, historical references, or immutable credential-encryption metadata.

## Stack and boundaries

- `src/`: React 19 + Vite 8 single-page UI; Leaflet maps. `src/App.jsx` coordinates live/history views, imports, telemetry, settings, and reports. API clients: `src/lib/traccarApi.js` and `src/lib/traccarScopeApi.js`.
- `backend/TraccarScope.Api/`: ASP.NET Core 9 minimal API with Npgsql/PostgreSQL. Endpoint files group trips, events, reports, Bouncie, users, and telemetry shares. No ORM. `scripts/` holds SQL migrations, audits, and health checks.
- Dev routes: `/api` proxies to Traccar; `/traccar-scope-api` rewrites to the Traccar Scope API (`vite.config.js`). Defaults and browser settings are in `src/lib/settings.js`. Production URLs must reach both services.
- PostgreSQL has **two databases**: `traccar` owns raw tracker positions, devices, and other Traccar records (`tc_*` tables); `traccar_scope_api` owns derived trips and app metadata. Traccar IDs in `traccar_scope_api` are soft references, not cross-database foreign keys. Traccar Scope API connects only to `traccar_scope_api`; the browser queries Traccar's REST API for raw positions.

## Data sources and workflows

| Source | Access | Use |
| --- | --- | --- |
| Traccar REST (`/devices`, `/positions`, `/server`, `/session`) | Browser via `/api`; credentials/session handled by `traccarApi.js` | Live devices and positions, time-range history, raw telemetry, maps, CSV export. The device list can instead use the Traccar Scope API catalog, with Traccar fallback. |
| Traccar PostgreSQL (`traccar`) | Traccar server; optional SQL audits in `scripts/` | Raw telemetry source of truth. Do not treat saved app trips as raw position records. |
| Traccar Scope API REST (`/api/*` behind `/traccar-scope-api`) | Browser via `traccarScopeApi.js`; cookie auth when enabled | Vehicle catalog and effective-date device bindings; saved trips, day/history summaries, route points, recalculation, tags/notes, named places, driving events/thresholds, DTCs, preferences, user/group access, reports. Optional test/development tooling: `/api/device-protocol-diagnostics/{deviceId}` captures Traccar version, model/category, and decoded telemetry for a bounded 24-hour sample. It uses server-side Traccar read-only credentials and is loopback-only, so run `scripts/capture_device_protocol_diagnostics.ps1` on the test API host. It is not required by production installations. The capture omits coordinates and unique device IDs; raw tracker packets are unavailable. `/health` checks DB connectivity; OpenAPI is mapped in development. |
| Traccar Scope API PostgreSQL (`traccar_scope_api`) | .NET API via `ConnectionStrings:TraccarScopeApi` | `vehicles`, `vehicle_device_bindings`, `trips`, route points, external identities, tags/notes, places, trip events, DTC catalog/events, Bouncie credentials/checkpoints/source snapshots, users/groups/access, preferences, telemetry share snapshots. Schema SQL is in `scripts/`. |
| Bouncie REST/OAuth or CSV | Bouncie integration endpoints or browser CSV import | Backfills historical trips into `traccar_scope_api`, including available routes, telemetry, and events. OAuth import tracks coverage/checkpoints; external identities make retries safe. CSV has only fields present in the file. |
| Browser local storage | `settings.js`, profile stores, UI preferences | API settings and some display/profile preferences; not authoritative trip history. |

Flow: tracker -> Traccar -> live/history UI. For durable trip history, assign a Traccar device to a vehicle with an effective-date binding, then import/derive trips into `traccar_scope_api`; repeat imports skip existing identities. Recalculation keeps saved trip identity and metadata. The UI joins saved trip data with Traccar positions for route, telemetry graphs, event overlays, and export. Bouncie imports provide an alternate historical source. Optional Traccar Scope API sign-in uses `/auth/*`; admin controls configuration and access. Telemetry shares copy selected series/points into share tables and expose token-scoped public read/export endpoints.

Telemetry graph export has four outputs: a native-sample telemetry CSV, telemetry metadata JSON, and (when named track places produce events) a track-timing CSV plus track metadata JSON. Track metadata includes route distance in meters and miles for observed start/finish, drag, and split segments when continuous GPS is available; unavailable distances are `null`. GPS is joined during export by trip and nearest timestamp; missing values remain blank and are marked in `quality_json`, and samples are not interpolated. Track place roles drive timing boundaries (`track_start`, `track_finish`, `track_start_finish`, `track_split`, `drag_start`, `drag_finish`). The shared builders are in `src/lib/csvExport.js`; if one export changes, check the other builders and `TelemetryGraphViewer.exportGraphTelemetry` for consistent GPS and session behavior.

## Reports

`src/components/reports/ReportsWorkspace.jsx` offers Usage Summary, Trip Log, Monthly Summary, Named Places, Data Completeness, Driving Events, Utilization Calendar, Business Mileage, Speed Bands, Vehicle Health, and Tracker Health; export is JSON, CSV, or print/save PDF. The saved-data reports use Traccar Scope API `/api/reports/*`. Speed Bands starts with Traccar Scope API trip windows, then reads Traccar point speeds; Vehicle/Tracker Health similarly use live Traccar telemetry. Admin-only `/api/admin/reports/{daily|growth|maintenance|retention-preview}` reads `traccar_scope_api` operational metrics. Related SQL: `scripts/phase6_*_health.sql` and `scripts/traccar_scope_api_*audit.sql`.

Start points: `README.md` (run/test), `docs/INSTALL_TRACCAR_SCOPE_MANUAL_DEPLOYMENT.md` (manual deployment), `docs/TELTONIKA_FMB003_DATA_CATALOG.md` (device fields), and the API endpoint files for exact contracts. Keep hosts, credentials, and production data out of this handoff.

## Planning documents

Start with NEXT_TODO.md for active plans. The current telemetry and device-profile plans are linked there. Historical plans and session notes are preserved in docs/archive/project-plans/README.md; check the archive status banner and prefer current docs/code when older notes conflict.

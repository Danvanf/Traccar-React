The next thing we're going to work on is related to each trip and the datapoints in that trip.  We are going to want to report on things like hard braking, maximum speed, long idle times, hard acceleration for each trip providing the distance moved was large enough to include maximum speed all the time, and the others when they go off.  Hard cornering would be another that would be added to that list.  Consider other possiblities that would be interesting.

I'd also like to see dots on each line that represent the 5 second data points.  Each dot should be clickable then a flag should show up with the current location, speed, any g force above or below reasonable of possible, and select ODB2 data points if possible.

Then we're going to add some vehicle information related to trips

## Design references (summarized)

- Add a vehicle stats area with selectable aggregation granularity (trip/day/week) and filterable date ranges.
- Include key totals and averages such as distance, travel time, idle time, and event counts.
- Add a notification panel with categories for Drive, Vehicle, Care, and user-pinned items.
- Add a compact fixed vehicle-information card (fuel, battery, engine, and device status) that can be shown as a map-adjacent overlay.
- Keep deployment architecture behind a reverse proxy: / for UI, /vehicle-api/ for the app API, and /traccar-api/ only when needed.

# Next Work Checklist

## Confirmed feature decisions

- Event thresholds use three levels: global defaults, system overrides, and vehicle overrides.
- Event detection prefers tracker-provided values, then calculates from position samples when unavailable.
- Position samples are treated as approximately five-second data, but gaps are expected and must be represented honestly.
- OBD2 values are authoritative and read-only. Traccar values fill gaps; user-editable values are only allowed when neither source provides a value.
- Notifications show both Traccar-originated and VehicleApp-derived events, with the source identified.
- Detected events are stored as durable records for reuse in trip details, notifications, filters, and reports.
- Vehicle statistics use their own date and tag filters over all saved trips; they are independent of the map’s current range.
- Vehicle status is presented as a fixed card rather than a map overlay.

## New feature track: trip events and vehicle insights

- [x] Persist vehicle-specific speed-band definitions through the VehicleApp API; Settings and the map load saved vehicle bands, with local browser values retained as a fallback.
- [x] Add an explicit “Copy from vehicle” speed-band action; copied bands are saved independently and do not create hidden automatic inheritance.

- [x] Add a main-panel “Show Named Places” toggle independent of the Settings panel.

- [x] Define durable trip-event schema with source, event type, severity, timestamp, position reference, measured value, threshold, and raw evidence (`scripts/phase7_trip_events_schema.sql`).
- [x] Apply the Phase 7 event schema to the live `vehicle_app` database.
- [x] Add threshold tables and resolution order foundation: vehicle override → system override → global default.
- [x] Add the initial pure event-detection layer for speed, acceleration, braking, and threshold resolution (`src/lib/tripEvents.js`).
- [x] Add tracker-value extraction for speed, acceleration, and common OBD2 attribute names; preserve raw attributes for auditability.
- [x] Add calculated idle detection from sampled telemetry; cornering was intentionally removed because course changes do not measure lateral G.
- [x] Add calculated acceleration fallback from adjacent speed samples, respecting actual timestamps.
- [x] Add a read-only trip-event API path (`GET /api/trips/{tripId}/events`).
- [x] Add a read-only threshold API path (`GET /api/event-thresholds`).
- [x] Add validated threshold updates (`POST /api/event-thresholds`) for global, system, and vehicle scopes.
- [x] Add calculated fallback for long idle across irregular or missing intervals.
- [x] Add event detection during trip selection/recalculation with idempotent replay behavior.
- [x] Recalculate unprocessed trips automatically when a day is selected, using `derivation_version` as the per-trip completion flag; retain a force-capable code path for maintenance recalculation.
- [x] Make completed event derivation versioned and collapse legacy maximum-speed rows to one representative event per trip.
- [x] Add five-second-or-available point markers to selected-trip map display.
- [x] Add identifying event icons at detected event positions on the selected-trip line.
- [x] Add point-click details for location, timestamp, speed, and available OBD2/telemetry values.
- [x] Add event markers and source labels to trip details and notifications.
- [x] Replace the manual Load Range/Days controls with a recent-history navigator: automatic 30-day startup window, expandable month groups, and day selection.
- [x] Allow the history navigator to merge older and newer 30-day windows without discarding already loaded days.
- [x] Add lightweight saved-trip day summaries and load Traccar position points only for the selected day (`/api/trips/day-summaries`).
- [x] Support multi-day history selection: Ctrl/Cmd-click toggles individual days, Shift-click selects a contiguous range, with a touch-friendly selection-mode fallback.
- [x] Add independent statistics filters for date range and tags, with Trip/Day/Week aggregation.
- [x] Add backend vehicle-statistics aggregation endpoint with independent date and grouping parameters.
- [x] Add fixed vehicle status cards for fuel, battery, engine, and device connection state.
- [x] Add initial fixed vehicle status card with latest known values, freshness age, and expandable raw fields.
- [ ] During status-card implementation, catalog actual tracker/OBD2 attribute names over several days; treat missing fuel and other values as unavailable rather than inferred.
- [x] Initial CSV catalog: Fuel Level, RPM, throttle, runtime, control-module voltage, and DTC count are intermittent; tracker battery voltage, ignition, coolant, OBD speed, intake temperature, MAF, odometer, and connection metrics are consistently present in this export. VIN was not present in the exported fields.
- [x] Treat RPM specially in freshness diagnostics: unchanged RPM can be legitimate under cruise control or steady operation, but prolonged absence while ignition/motion indicates a likely tracker or decoder issue.
- [ ] Define editable fallback vehicle fields while keeping OBD2-originated values read-only.

This list follows the current architecture update. The core trip persistence, identity, binding, enrichment, automatic synchronization, map/trip interaction, retention reports, and Admin Operations report UI are complete.

## 1. Live `vehicle_app` audit and migrations

- [x] Add a Vehicle Catalog editor for creating and editing app-owned vehicles (name, VIN, year, make, model, notes, active state). Keep this separate from Traccar device names and historical device bindings.
- [x] Assign the Device Protocol Profile to the Vehicle Catalog record. Device bindings determine ownership over time; they should not define protocol mappings. Keep an explicit no-profile option for non-vehicle devices.
- [x] Consolidate device assignment editing into Vehicle Catalog with an effective-from date and confirmation when moving a device between vehicles.

- [x] Run the read-only trip audit against the live `vehicle_app` database.
- [x] Check for duplicate or misbound historical trips; remove the three confirmed Phase 5 smoke-test trips with a guarded transaction.
- [x] Apply pending schema migrations in order, including derivation metadata and uniqueness protection.
- [x] Run the read-only migration status check (`scripts/vehicle_app_migration_status.sql`) against the live database and apply only the missing additive migrations.
- [x] Confirm indexes, foreign keys, and archived-table prerequisites.
- [x] Record the actual database/schema/table results in the deployment notes.

## 2. Full regression run

- [x] Run frontend tests and production build (17 frontend tests passing).
- [x] Run TripIdentity tests.
- [x] Run TripImport integration tests against the configured disposable schema (29 checks passing).
- [x] Run backend build and endpoint smoke checks.
- [x] Exercise the live UI flow: history range/day selection, trip selection, automatic synchronization, export, edit notes/tags, and recalculate. Manual import was removed because synchronization is automatic.
- [x] Record the final test commands and results.

## 3. Authentication and access control

- [x] Use single-user authentication so a future public deployment does not expose an unauthenticated API.
- [x] Define deployment credentials through environment variables only; never commit credentials or hashes to the repository (`VEHICLE_APP_AUTH_USERNAME`, `VEHICLE_APP_AUTH_PASSWORD`).
- [x] Add an HttpOnly authenticated session cookie with login, logout, and session-status endpoints.
- [x] Add a frontend login gate and logout control for the VehicleApp session.
- [x] Protect VehicleApp API endpoints, including write operations, when authentication is configured.
- [x] Restrict Admin / Operations reports to authorized users.
- [x] Document credential and secret storage; keep passwords out of repository files and logs.

## 4. Backup and restore

- [x] Define the backup command and destination for `vehicle_app` (`docs/internal/runbooks/vehicle_app_backup_restore.md`).
- [x] Verify that backups include schema, migrations, trips, notes, tags, bindings, DTC data, and archives.
- [x] Perform a restore test into a disposable database (44 trips restored successfully; disposable database removed).
- [x] Record backup retention, restore steps, and the expected recovery point/objectives.

## 5. Retention and operations

- [x] Run the first retention preview and review the eligible-trip count (0 trips older than 24 months).
- [x] Choose the archive cadence and low-traffic maintenance window.
- [ ] Run a small archive batch with an explicit transaction and verify trip/tag preservation (deferred until a trip is eligible; the live audit found 0 trips older than 24 months).
- [x] Establish daily activity, weekly maintenance, and monthly growth review cadence.
- [ ] Tune growth thresholds after observing storage and backup duration.

## 6. Release closeout

- [x] Update the architecture document with live-audit evidence and final status.
- [x] Update `AI_OVERVIEW.md` and `README.md` with the final deployment checklist.
- [x] Confirm the Traccar host, Docker network, database port, and API connection settings are documented.
- [ ] Create a release snapshot/tag after the checks above pass (kept as a deliberate release-management action).

## Deferred enhancements

- [x] Add Bouncie CSV trip-history import with VIN/catalog matching, durable external identities, and duplicate-safe repeated imports (`scripts/phase8_bouncie_import_schema.sql`). Bouncie event timestamps are retained at trip start because the export provides event flags but no event timestamps.
- [x] Auto-detect and restore the application's own raw position CSV export. Restored points use the selected device and the existing trip import deduplication; PostgreSQL dump/restore remains the complete backup path for notes, tags, events, and other app-owned records.
- [x] Add an initial rate-limited Bouncie REST connection and import flow in Settings. OAuth secrets/tokens remain transient, imports use inclusive date ranges and seven-day windows, progress/cancel state is visible, raw trip payloads are retained, and only existing catalog vehicles are matched/imported.
- [x] Persist Bouncie REST GPS route geometry in `trip_route_points` and expose it through the selected-trip route API so imported trips can draw their full path on the map; repeated imports remain point-index deduplicated.
- [x] Move Bouncie persistence behind the API: discard the authorization code after exchange, encrypt the client secret and refresh token with an external 32-byte deployment key, and restore the connection after API restart (`scripts/phase9_bouncie_credentials.sql`).
- [x] Serialize Bouncie refreshes, include the registered redirect URI on refresh, and provide a reconnect instruction when the provider rejects an expired or revoked refresh token.
- [x] Replace manual Bouncie authorization-code entry with a backend-managed OAuth callback: Settings opens Bouncie consent, `/signin-bouncie` exchanges the callback code, and the browser never handles the code as a settings value.
- [x] Keep explicit ignition-off, low-speed GPS drift from becoming a normal trip while preserving meaningful short movement and event-bearing movement; day selection now loads saved route geometry and fits the green day layer, while trip selection fits the red route layer.
- [x] Make Bouncie historical imports resumable with durable per-vehicle seven-day checkpoints and bounded retries for transient 429/5xx responses (`bouncie_import_checkpoints`).
- [x] Add a Bouncie backfill coverage endpoint and Settings summary so completed vehicle windows are visible after restart and gaps can be identified.
- [x] Continue past individual Bouncie window failures, report failed window count, and leave failed windows eligible for retry.
- [x] Validate the live Bouncie response shapes with small historical ranges: vehicle matching, trip metrics/events, start/end data, and GPS route points are confirmed. No separate health or alert polling was added because Bouncie is a historical backfill source and the platform will be retired; this avoids unnecessary provider traffic.

- [x] Add a local FMB003/Teltonika catalog reference and keep executable mappings in the profile metadata (`docs/TELTONIKA_FMB003_DATA_CATALOG.md`). Preserve source IDs, units, scaling, conversions, and sentinel values so future fields can be added without rediscovering the device protocol.
- [x] Add CSV export header selection: human-readable translated labels with the source attribute key, or raw Teltonika attribute IDs and values.
- [x] Expand the initial executable FMB003 catalog with common OBD graph fields: load, rail pressure, EGR, MIL history, ambient/oil temperature, fault-code text, intake MAP, fuel type, and related conversions.
- [ ] Expand the FMB003 catalog from the official firmware-specific table as fields are observed or needed by trip graphs.
- [x] Add the initial telemetry graph viewer: graph a selected trip or selected days in chronological order, separate trips visually, expose available numeric elements as checkboxes, and support independent per-series scaling.
- [x] Add saved user preferences for telemetry graph series, scoped by translation profile and filtered against available data.
- [x] Add a customizable vehicle data card backed by the catalog; unavailable selected fields remain hidden until telemetry supplies them.
- [x] Hide currently unavailable fields in the information panel so it stays compact and grows visibly as telemetry becomes available.

- [ ] Expand DTC decoding only when hardware data requires it.
- [ ] Re-evaluate TimescaleDB only if measured size, latency, or maintenance needs justify it.
- [ ] Add scheduled report delivery only if an email or other notification channel becomes available.

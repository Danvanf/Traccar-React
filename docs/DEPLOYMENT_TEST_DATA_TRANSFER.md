# Deployment test data transfer

Design and implementation plan for reproducing the developer system's user experience on a fresh Traccar + Traccar Scope installation without redirecting physical trackers.

Implementation progress (2026-10-16): the source status/export endpoints and admin-only download panel are implemented using the existing development API bypass. The export passed a runtime check against the live source: Traccar 6.14.5, four devices, 172,491 positions, 739 events, and 240,105 total records across 24 JSONL data files. All manifest record counts and SHA-256 checksums matched. The temporary 23,023,092-byte archive was inspected by manifest and entry metadata only, then deleted; no copy was retained. The offline restore utility is implemented at `scripts/restore_deployment_test.py`. It validates the package, checks target Traccar version/devices and database emptiness, requires an explicit device-ID map, refuses Timescale hypertables, supports PostgreSQL or MySQL for Traccar history and PostgreSQL for app data, restores IDs and app rows in dependency order, and resets sequences. Eight synthetic package/mapping/preflight tests pass, including MySQL and PostgreSQL preflight checks that stop before writes. A real database import against Traccar 6.16.0 remains outstanding.

## Goal

Create a portable, administrator-controlled snapshot of a selected period of real historical data (initial default: the previous three months). Restore it into a fresh test installation so that maps, trips, telemetry graphs, shared profile interpretations, and profile editing can be exercised immediately. Keep the destination's normal Traccar and Traccar Scope API databases; the export is a transfer package, not a replacement for configuration or a full server backup.

## Decisions

- The source export reuses the existing development API bypass; it has no separate server-role variable. It is available only when the API is running with `ASPNETCORE_ENVIRONMENT=Development`, `TraccarScopeApi:Auth:AllowUnauthenticatedDevelopment=true`, and the request is loopback, matching `TraccarScopeApiAuthOptions.IsDevelopmentBypass`. Authenticated callers still need an active admin account. The destination must not run with this bypass enabled.
- Every export route also requires an authenticated app administrator. The feature is absent/disabled on ordinary and destination installations, even if the caller is an administrator there.
- The initial period defaults to the previous three calendar months, represented as explicit UTC instants in the archive manifest. The administrator can choose a bounded date range. Data is selected by event/position time, not database creation time.
- The archive source is pinned to Traccar 6.14.5. Targets may run Traccar 6.14.5 or 6.16.0. The 6.16.0 target exception is limited to this tested transfer path: its intervening 6.15 schema migration widens ID columns in `tc_devices` and `tc_actions`, while the importer writes history to `tc_positions` and `tc_events` and checks their target columns and storage engines before import. Other target versions remain refused.
- No tracker redirection, forwarding, replay, or new background collector is part of this test. Static historical data is enough to reproduce the experience.
- Include shared telemetry profile definitions, profile assignment history, immutable profile revisions, and per-device field mapping revisions. These are application data needed to interpret the copied history, even though they are configuration-like.
- Do not transfer server settings, credentials, provider secrets, account passwords/hashes, SMTP/SMS configuration, Bouncie credentials, auth users, session state, or source host URLs.

## Transfer package

Use a ZIP containing a versioned manifest and UTF-8 JSONL data files. JSONL supports streaming large histories and gives each record a clean boundary. The archive should include:

- `manifest.json`: package format version, generated time, inclusive/exclusive UTC range, app schema/build version, source Traccar version, per-file row counts and SHA-256 digests, and a source-device inventory sufficient to map old numeric IDs to destination devices.
- `traccar/devices.jsonl`: only devices represented in the selected Traccar Scope API fleet/history, with IDs, names, protocol, and a private matching key needed to associate destination devices. Avoid exposing that key in UI/logs; protect the archive as sensitive data.
- `traccar/positions.jsonl`: all Traccar positions for those devices in range, including coordinates and raw attributes. Position IDs are retained so app trip/event references can be restored exactly into a clean target.
- `traccar/events.jsonl`: Traccar event records for the same devices and interval, retrieved from the reports/events API and retaining event and position IDs for app references.
- `traccar-scope-api/vehicles.jsonl` and supporting rows for trips, route points, tags and tag links, trip events, event thresholds, speed bands, status-card preferences, named places, fuel/maintenance entries, telemetry profiles, profile assignment history, profile revisions, and source-field mapping revisions. Include rows needed as references even when their own creation time falls outside the selected period; apply the date range to time-series/activity rows.
- A checksum file is redundant with the manifest and is not needed.

Do not include `app_users`, groups, user/group access tables, password hashes, general settings, provider accounts/secrets, email/SMS preferences, Bouncie credentials, database connection settings, migrations unrelated to format validation, or Traccar server configuration. The destination keeps its own admin account, URL, credentials, and service settings.

Vehicle profile mapping revisions are keyed by Traccar device ID; the archive must preserve a stable source-device key and rewrite those IDs during restore. For the first restore, preserve Traccar position and event IDs only when the destination `tc_positions` and `tc_events` tables are empty. This keeps app trip/event references intact and avoids creating a large ID translation table. Device IDs are matched by the private unique identifier and rewritten in positions, events, vehicle bindings, trips, and device-profile assignments. Preserve app UUIDs where possible.

## Source export flow

1. Admin selects a start/end date (pre-filled to the last three months). The first export UI does not run a separate count-preview request; exact per-file counts are written into the completed archive manifest.
2. API validates the existing development-bypass gate, maximum range, and date order. It reads Traccar's version, devices, positions, and events through the existing configured Traccar API credentials and reads only an allowlisted set of Traccar Scope API tables.
3. API produces the ZIP as a streamed response or a short-lived temporary file. It does not persist an archive indefinitely. Audit only the admin, timestamp, range, counts, result, and request ID; never log device matching keys, coordinates, or archive content.
4. UI states that the export contains sensitive location/history data and should be stored securely. The package is not automatically emailed or uploaded.

The current API routes are `GET /api/admin/deployment-transfer/status` and `GET /api/admin/deployment-transfer/export?from=<UTC>&to=<UTC>`. Both return 404 unless the existing development bypass is active for the loopback request. A development-bypass identity is treated as the existing local development admin; authenticated callers are checked against active `app_users` role data. The date range is half-open, defaults to three months, and is capped at 184 days. The UI uses UTC calendar dates and explains that the archive contains precise locations. The API streams Traccar positions, events, and minimized device identity records plus a fixed allowlist of Traccar Scope API tables; it omits `traccar_sources.base_url` and profile-editor `changed_by` fields, and never includes users or credentials.

The source UI needs no additional setting. Start the local API with its existing Development launch profile so the already configured `AllowUnauthenticatedDevelopment` bypass applies to loopback requests. Do not enable that bypass on the fresh destination or a public installation.

The API uses the existing Traccar API connection for extraction; no Traccar database password is added to the browser or the application. Before finalizing query behavior, verify the configured Traccar API can return every selected position and that the app's shared Traccar account has visibility over the intended developer fleet.

## Destination restore

The restore should be a separate, explicit admin operation on the fresh test installation (or a reviewed offline importer), not an endpoint that accepts an arbitrary archive on every normal server. Before writing, it must:

1. Validate archive format, safe ZIP entry paths, file checksums/counts, range, and supported source/target Traccar versions.
2. Show a preview of source devices and require an explicit mapping to destination Traccar devices. Use unique ID as a match hint, with a clear manual choice when it differs or collides. Never silently overwrite a different device.
3. Require an empty or explicitly selected target Traccar Scope API dataset, then take/require a restorable target backup.
4. Import Traccar positions into the target using a version-pinned importer, while Traccar is stopped or while using a tested maintenance procedure. The public Traccar REST API is read-oriented for position history, so restoring historical positions requires a controlled database import or a protocol replay; use database import for exact records and verify the target schema/version first.
5. Build source-to-target device and position ID maps, import Traccar Scope API rows in FK dependency order, and rewrite all soft Traccar ID references and profile mapping device keys. Commit each database atomically where practical and fail with a clear rollback path.
6. Verify counts, time bounds, trip/route associations, telemetry assignment resolution at historical times, and representative graph/map rendering before declaring restore complete.

Do not copy or restore `traccar.xml`, app environment files, source base URLs, encryption keys, or source account records. Changing display names at the destination remains safe because association uses IDs/mapping, not names.

## Safety and operational limits

- Three-month scope and max range are explicit, configurable limits; never default to an unbounded export.
- Export includes exact GPS locations and raw telemetry by design because the goal is to reproduce maps and graph behavior. Treat ZIPs like database backups and delete local copies when the test is complete.
- The export endpoint must fail closed if the developer role is unset, the app caller is not admin, Traccar version is unavailable, or a required schema/table is missing. It must not silently omit required records.
- For the first test, keep the same Traccar release and use a disposable destination database so a failed import cannot damage a working environment.
- The time range is UTC and half-open (`from <= occurred_at < to`) to avoid duplicate boundary rows in future incremental packages.

## Delivery sequence

1. **Inventory and contract**: finalize the allowlisted app tables and required references against the live Traccar Scope API schema; record exact source Traccar release and confirm historical positions are obtainable through the configured API.
2. **Export**: complete. The existing development API bypass gates the admin-only status/export endpoints and Settings panel. The ZIP manifest, JSONL checksums/counts, date validation, audit logging, and live-source package integrity have been verified.
3. **Restore prototype**: implemented as an offline Python 3 utility for a disposable Linux target. It requires pre-created destination devices, explicit ID mapping, supported target Traccar 6.14.5 or 6.16.0, empty history/allowlisted app tables, and operator confirmation. Back up the target and verify rollback before using the real export.
4. **End-to-end test**: export three months from Limestone, restore to the new server, compare record counts and IDs through the translation maps, and walk through a regular user's login, map, history, graph, status cards, and profile editor.
5. **Operationalize**: document server provisioning and cleanup. Add incremental/delta packages only if repeated refreshes become useful; they are not needed for the first reproduction test.

## Open implementation checks

- Record the target Traccar release. The archive must be from 6.14.5; the target must be 6.14.5 or 6.16.0. The utility enforces these supported versions and checks the history table schema before import.
- Confirm the target Traccar Scope API schema is migrated and compatible. The utility checks included table presence and emptiness, and PostgreSQL rejects incompatible columns/constraints transactionally; a real schema/import test remains outstanding.
- Run the importer against the disposable Linux host, validate counts and application behavior, and confirm restore/rollback before using it for the first deployment test.
- Confirm archive storage/encryption before copying it to another host. The test archive was deleted after validation; future retained packages contain precise GPS and raw telemetry and should be protected like a database backup.

## Offline restore utility

The utility is separate from the API and supports format version 2, archives exported from Traccar 6.14.5, and targets running Traccar 6.14.5 or 6.16.0. It does not create destination devices or application users, copy server configuration, or replace a target database. It translates the API's camelCase fields into Traccar's database columns, including the `eventTime` to `eventtime` rename in the Traccar schema, and serializes API JSON objects for the database's text columns. Traccar history can be restored to PostgreSQL or MySQL; the Traccar Scope API database must be PostgreSQL. First migrate both target databases using the normal Traccar/TraccarScopeApi startup procedure, create the destination Traccar devices, and use a dedicated disposable target Traccar Scope API database. Before executing the import, stop the Traccar Scope API and ensure no devices are sending data. Keep the Traccar server online because the utility checks its version and destination devices through the Traccar API. Take restorable backups of both target databases and protect the export ZIP as sensitive location data. The field mapping follows the pinned [Traccar v6.14.5 source](https://github.com/traccar/traccar/tree/v6.14.5); the 6.16.0 target allowance is based on its [6.15 schema migration](https://github.com/traccar/traccar/blob/v6.16.0/schema/changelog-6.15.0.xml).

Install Python 3 and the PostgreSQL client on the Linux host. For a host-reachable Traccar Scope API database, configure an alias in the restore user's `~/.pg_service.conf` (mode 0600) and store its password in `~/.pgpass` (mode 0600) or another libpq-supported secret mechanism. For a database container without a published host port, use the container option shown below; the tool stages a temporary mode-600 password file inside the container and removes it when the run ends. PostgreSQL Traccar targets can use a service alias or a container. MySQL Traccar targets use the MySQL client inside the existing database container and require Docker access plus a MySQL database username/password. Passwords are prompted without echoing and are not placed in command-line arguments.

Run the synthetic safety tests from the repository root with `python3 scripts/test_restore_deployment_test.py` before handling a real export.

```ini
[traccar_scope_api_restore]
host=127.0.0.1
port=5432
dbname=traccar_scope_api
user=traccar_scope_api_restore
```

The device map is a JSON object from source numeric Traccar IDs to destination IDs. Create the target devices first, then confirm each mapping by device name in the preview. For example:

```json
{
  "1": 3,
  "2": 4
}
```

Validate the archive without contacting the target:

```sh
python3 scripts/restore_deployment_test.py deployment-export.zip --validate-only
```

Run target checks without writing. The Traccar API URL is its origin, such as `http://127.0.0.1:8082`; the tool prompts for API credentials without echoing the password. Database credentials come from libpq configuration:

```sh
python3 scripts/restore_deployment_test.py deployment-export.zip \
  --target-traccar-url http://127.0.0.1:8082 \
  --traccar-service traccar_restore \
  --traccar-scope-api-service traccar_scope_api_restore \
  --device-map device-map.json \
  --confirm-empty-target
```

For a MySQL Traccar database, replace `--traccar-service traccar_restore` with the target database container and MySQL account. If the Scope API database is also in an unpublished container, use its container option too. The tool prompts for both database passwords without echoing them. For example:

```sh
python3 scripts/restore_deployment_test.py deployment-export.zip \
  --target-traccar-url http://127.0.0.1:8082 \
  --traccar-mysql-container traccar-database-1 \
  --traccar-mysql-user MYSQL_DATABASE_USER \
  --traccar-mysql-database traccar \
  --traccar-scope-api-postgres-container deploy-database-1 \
  --traccar-scope-api-postgres-user traccar_scope_api \
  --traccar-scope-api-postgres-database traccar_scope_api \
  --device-map device-map.json \
  --confirm-empty-target
```

Add `--docker-sudo` if your Linux user needs `sudo docker` to access the database containers. The MySQL history tables must use InnoDB. The tool checks the target table engines and required columns before import, and maps the exported UTC timestamps to MySQL datetime values.

After reviewing the mapping, supported version, and empty-target checks, perform the import with `--execute`:

```sh
python3 scripts/restore_deployment_test.py deployment-export.zip \
  --target-traccar-url http://127.0.0.1:8082 \
  --traccar-service traccar_restore \
  --traccar-scope-api-postgres-container deploy-database-1 \
  --traccar-scope-api-postgres-user traccar_scope_api \
  --traccar-scope-api-postgres-database traccar_scope_api \
  --docker-sudo \
  --device-map device-map.json \
  --confirm-empty-target --execute
```

For a MySQL Traccar target, rerun the same preflight command with `--execute` added:

```sh
python3 scripts/restore_deployment_test.py deployment-export.zip \
  --target-traccar-url http://127.0.0.1:8082 \
  --traccar-mysql-container traccar-database-1 \
  --traccar-mysql-user MYSQL_DATABASE_USER \
  --traccar-mysql-database traccar \
  --traccar-scope-api-service traccar_scope_api_restore \
  --device-map device-map.json \
  --confirm-empty-target --execute
```

The utility asks the operator to type `RESTORE`. It commits Traccar history first and Traccar Scope API data second; each database uses a transaction, but there is no cross-database atomic transaction. If the app import fails after Traccar commits, restore both target databases from pre-import backups before retrying. Start services only after the importer completes. Compare database row counts with the archive manifest and check device visibility, map/history, trips, telemetry graphs, status cards, and profile editing. Do not use the utility on an installation with real data: it refuses nonempty history and allowlisted app tables and does not merge datasets.

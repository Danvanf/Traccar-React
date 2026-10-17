#!/usr/bin/env python3
"""Restore a Traccar React deployment-test export into a disposable Linux host.

The tool deliberately supports only the export format/version documented in
docs/DEPLOYMENT_TEST_DATA_TRANSFER.md. It validates everything before writes,
and requires separate, explicit PostgreSQL services for Traccar and TraccarReactApi.
"""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import getpass
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Iterable


EXPECTED_FORMAT = 1
SUPPORTED_TRACCAR_VERSION = "6.14.5"
MAX_ARCHIVE_UNCOMPRESSED = 8 * 1024 * 1024 * 1024
APP_TABLE_ORDER = (
    "vehicles", "traccar_sources", "vehicle_device_bindings", "trips",
    "trip_route_points", "trip_tags", "trip_tag_map", "trip_events",
    "trip_event_thresholds", "named_places", "fuel_fills", "maintenance_records",
    "alert_rules", "alert_events", "telemetry_profiles", "telemetry_profile_assignments",
    "telemetry_profile_revisions", "telemetry_source_mapping_revisions",
    "vehicle_speed_bands", "vehicle_status_card_preferences", "trip_external_identities",
)
REQUIRED_APP_TABLES = {
    "vehicles", "vehicle_device_bindings", "trips", "telemetry_profiles",
    "telemetry_profile_assignments", "telemetry_profile_revisions",
    "telemetry_source_mapping_revisions",
}
EXPECTED_ENTRIES = {
    "traccar/devices.jsonl", "traccar/positions.jsonl", "traccar/events.jsonl",
}
TRACCAR_VERSION_URL_PATH = "api/server"
TRACCAR_DEVICES_URL_PATH = "api/devices"
IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")


class RestoreError(Exception):
    pass


def fail(message: str) -> "NoReturn":
    raise RestoreError(message)


def read_json_lines(archive: zipfile.ZipFile, name: str) -> Iterable[dict[str, Any]]:
    with archive.open(name, "r") as stream:
        for line_number, raw in enumerate(stream, 1):
            if not raw.strip():
                continue
            try:
                record = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                fail(f"{name}:{line_number}: invalid UTF-8 JSON: {exc}")
            if not isinstance(record, dict):
                fail(f"{name}:{line_number}: each JSONL record must be an object")
            yield record


def inspect_archive(path: Path) -> tuple[dict[str, Any], dict[str, zipfile.ZipInfo]]:
    if not path.is_file():
        fail(f"Archive does not exist: {path}")
    try:
        archive = zipfile.ZipFile(path, "r")
    except (OSError, zipfile.BadZipFile) as exc:
        fail(f"Could not read ZIP archive: {exc}")
    with archive:
        infos: dict[str, zipfile.ZipInfo] = {}
        total_uncompressed = 0
        for info in archive.infolist():
            name = info.filename
            if name in infos:
                fail(f"Archive has a duplicate entry: {name}")
            if name.startswith("/") or "\\" in name or any(part in ("", ".", "..") for part in name.split("/")):
                fail(f"Unsafe archive entry path: {name!r}")
            if info.is_dir():
                fail(f"Unexpected directory entry: {name}")
            total_uncompressed += info.file_size
            if total_uncompressed > MAX_ARCHIVE_UNCOMPRESSED:
                fail("Archive exceeds the 8 GiB uncompressed safety limit")
            infos[name] = info
        if "manifest.json" not in infos:
            fail("Archive is missing manifest.json")
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            fail(f"manifest.json is invalid: {exc}")
        if not isinstance(manifest, dict) or manifest.get("formatVersion") != EXPECTED_FORMAT:
            fail(f"Only deployment transfer format version {EXPECTED_FORMAT} is supported")
        source = manifest.get("source") or {}
        if source.get("traccarVersion") != SUPPORTED_TRACCAR_VERSION:
            fail(f"This restore utility supports Traccar {SUPPORTED_TRACCAR_VERSION}; archive is {source.get('traccarVersion')!r}")
        date_range = manifest.get("range") or {}
        if not date_range.get("fromInclusiveUtc") or not date_range.get("toExclusiveUtc"):
            fail("Manifest is missing the selected UTC date range")
        try:
            from_time = datetime.fromisoformat(date_range["fromInclusiveUtc"].replace("Z", "+00:00"))
            to_time = datetime.fromisoformat(date_range["toExclusiveUtc"].replace("Z", "+00:00"))
            if (from_time.utcoffset() != timezone.utc.utcoffset(from_time)
                    or to_time.utcoffset() != timezone.utc.utcoffset(to_time)
                    or from_time >= to_time):
                fail("Manifest UTC date range is reversed or empty")
        except (KeyError, TypeError, ValueError):
            fail("Manifest UTC date range is invalid")
        app_prefix = "traccar-react-api"
        included = manifest.get("includedTraccarReactApiTables")
        if not isinstance(included, list) or any(not isinstance(t, str) or t not in APP_TABLE_ORDER for t in included):
            fail("Manifest has an unknown Traccar React API table list")
        missing_required = REQUIRED_APP_TABLES - set(included)
        if missing_required:
            fail("Archive is missing required Traccar React API tables: " + ", ".join(sorted(missing_required)))

        summaries = manifest.get("files")
        if not isinstance(summaries, list):
            fail("Manifest is missing its file summary list")
        expected: dict[str, dict[str, Any]] = {}
        for entry in summaries:
            if not isinstance(entry, dict):
                fail("Manifest contains an invalid file summary")
            name = entry.get("path")
            if not isinstance(name, str) or name in expected:
                fail("Manifest has a missing or duplicate file path")
            allowed = EXPECTED_ENTRIES | {f"{app_prefix}/{table}.jsonl" for table in included}
            if name not in allowed:
                fail(f"Manifest lists an unsupported file: {name}")
            if not isinstance(entry.get("records"), int) or entry["records"] < 0:
                fail(f"Manifest record count is invalid for {name}")
            if not re.fullmatch(r"[0-9a-f]{64}", str(entry.get("sha256", ""))):
                fail(f"Manifest SHA-256 is invalid for {name}")
            expected[name] = entry
        required_files = EXPECTED_ENTRIES | {f"{app_prefix}/{table}.jsonl" for table in included}
        if required_files != set(expected) or set(infos) != required_files | {"manifest.json"}:
            missing = sorted((required_files | {"manifest.json"}) - set(infos))
            extra = sorted(set(infos) - (required_files | {"manifest.json"}))
            fail(f"Archive entry set mismatch (missing={missing}, unexpected={extra})")

        for name, summary in expected.items():
            digest = hashlib.sha256()
            records = 0
            with archive.open(name, "r") as stream:
                for line_number, raw in enumerate(stream, 1):
                    digest.update(raw)
                    if raw.strip():
                        try:
                            item = json.loads(raw)
                        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                            fail(f"{name}:{line_number}: invalid JSON: {exc}")
                        if not isinstance(item, dict):
                            fail(f"{name}:{line_number}: JSONL entries must be objects")
                        records += 1
            if records != summary["records"] or digest.hexdigest() != summary["sha256"]:
                fail(f"Integrity check failed for {name}: expected {summary['records']} records / {summary['sha256']}, got {records} / {digest.hexdigest()}")
        manifest["includedTraccarReactApiTables"] = included
        return manifest, infos


def load_device_map(path: Path, source_devices: list[dict[str, Any]]) -> dict[int, int]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"Could not read device map JSON: {exc}")
    if not isinstance(raw, dict):
        fail("Device map must be a JSON object from source numeric IDs to target numeric IDs")
    try:
        mapping = {int(source): int(target) for source, target in raw.items()}
    except (TypeError, ValueError):
        fail("Device map keys and values must be numeric Traccar IDs")
    source_ids = {int(device["id"]) for device in source_devices}
    if set(mapping) != source_ids:
        fail(f"Device map must include exactly these source IDs: {', '.join(map(str, sorted(source_ids)))}")
    targets = list(mapping.values())
    if any(target < 1 for target in targets) or len(targets) != len(set(targets)):
        fail("Target device IDs must be positive and unique")
    return mapping


def traccar_get(base_url: str, username: str, password: str, path: str) -> Any:
    url = base_url.rstrip("/") + "/" + path
    token = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
    request = urllib.request.Request(url, headers={"Authorization": f"Basic {token}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        fail(f"Could not query target Traccar API ({path}): {exc}")


def psql(service: str, sql: str, *, check: bool = True) -> str:
    command = ["psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--dbname", f"service={service}"]
    try:
        result = subprocess.run(command, input=sql, text=True, capture_output=True, check=False)
    except FileNotFoundError:
        fail("psql was not found. Install the PostgreSQL client on the restore host.")
    if check and result.returncode != 0:
        detail = result.stderr.strip() or f"psql exited with status {result.returncode}"
        fail(f"PostgreSQL preflight/import failed for service {service}: {detail}")
    return result.stdout.strip()


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def preflight_databases(traccar_service: str, app_service: str, included_tables: list[str]) -> None:
    # Reject TimescaleDB/hypertables: Traccar versions can drop primary keys there,
    # which invalidates exact-ID insertion and is not tested by this importer.
    traccar_check = r"""
select json_build_object(
  'version', current_setting('server_version'),
  'positions', (select count(*) from tc_positions),
  'events', (select count(*) from tc_events),
  'devices', (select count(*) from tc_devices),
  'position_hypertable', exists(select 1 from timescaledb_information.hypertables where hypertable_name='tc_positions'),
  'event_hypertable', exists(select 1 from timescaledb_information.hypertables where hypertable_name='tc_events')
)::text;
"""
    # Timescale's metadata schema is absent on ordinary PostgreSQL, so detect it
    # without referring to an optional relation in the primary query.
    ts = psql(traccar_service, "select to_regclass('timescaledb_information.hypertables') is not null;")
    if ts.lower() == "true":
        info = json.loads(psql(traccar_service, traccar_check))
        if info["position_hypertable"] or info["event_hypertable"]:
            fail("Target uses Timescale hypertables for Traccar history; this first restore version refuses that schema.")
    traccar_rows = psql(traccar_service, "select (select count(*) from tc_positions)::text || ',' || (select count(*) from tc_events)::text || ',' || (select count(*) from tc_devices)::text;")
    try:
        positions, events, devices = (int(part) for part in traccar_rows.split(","))
    except (ValueError, TypeError):
        fail("Could not validate target Traccar tables")
    if positions or events:
        fail(f"Target Traccar history is not empty (positions={positions}, events={events}); refusing to import.")
    if devices == 0:
        fail("Target Traccar has no devices. Create the destination devices in Traccar first.")

    names = ",".join(sql_literal(table) for table in included_tables)
    sql = f"""
select coalesce(json_agg(json_build_object('table', table_name, 'rows', row_count)), '[]'::json)::text
from (
  select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text::bigint as row_count
  from information_schema.tables
  where table_schema=current_schema() and table_type='BASE TABLE' and table_name in ({names})
) counts;
"""
    rows = json.loads(psql(app_service, sql))
    found = {row["table"] for row in rows}
    if found != set(included_tables):
        fail("Target Traccar React API schema must be migrated before restore; missing: " + ", ".join(sorted(set(included_tables) - found)))
    nonempty = [f"{row['table']}={row['rows']}" for row in rows if row["rows"]]
    if nonempty:
        fail("Target Traccar React API transfer tables are not empty; refusing to overwrite: " + ", ".join(nonempty))


def map_record(record: dict[str, Any], mapping: dict[int, int], table: str) -> dict[str, Any]:
    result = dict(record)
    if table == "traccar/positions.jsonl":
        renames = {
            "deviceId": "deviceid", "serverTime": "servertime", "deviceTime": "devicetime",
            "fixTime": "fixtime",
        }
    elif table == "traccar/events.jsonl":
        renames = {
            "deviceId": "deviceid", "positionId": "positionid", "geofenceId": "geofenceid",
            "maintenanceId": "maintenanceid",
        }
    else:
        renames = {}
    for source, target in renames.items():
        if source in result:
            if target in result:
                fail(f"Ambiguous duplicate {source}/{target} column in {table}")
            result[target] = result.pop(source)
    if table == "traccar/positions.jsonl":
        result.pop("geofenceIds", None)
        result.pop("outdated", None)
        for key in ("attributes", "network"):
            if key in result and result[key] is not None and not isinstance(result[key], str):
                result[key] = json.dumps(result[key], separators=(",", ":"), ensure_ascii=False)
    elif table == "traccar/events.jsonl":
        event_time = result.pop("eventTime", None)
        server_time = result.pop("serverTime", None)
        result["eventtime"] = event_time if event_time is not None else server_time
        if result.get("attributes") is not None and not isinstance(result["attributes"], str):
            result["attributes"] = json.dumps(result["attributes"], separators=(",", ":"), ensure_ascii=False)
    if table == "traccar-react-api/traccar_sources.jsonl" and "base_url" in result:
        fail("Archive contains excluded traccar_sources.base_url data")
    if table in {"traccar-react-api/telemetry_profile_revisions.jsonl", "traccar-react-api/telemetry_source_mapping_revisions.jsonl"} and "changed_by" in result:
        fail(f"Archive contains excluded changed_by data in {table}")
    device_columns = {"deviceid"} if table.startswith("traccar/") else {"traccar_device_id"}
    for key in device_columns:
        if key in result and result[key] is not None:
            try:
                source_id = int(result[key])
            except (ValueError, TypeError):
                fail(f"Non-numeric {key} in {table}")
            if source_id not in mapping:
                fail(f"No target mapping for source Traccar device ID {source_id}")
            result[key] = mapping[source_id]
    return result


def psql_stream(service: str, emit) -> None:
    command = ["psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--dbname", f"service={service}"]
    try:
        with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as errors:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors, text=True)
            assert process.stdin is not None
            try:
                emit(process.stdin)
                process.stdin.close()
                status = process.wait()
            except BaseException:
                process.kill()
                process.wait()
                raise
            if status:
                errors.seek(0)
                detail = errors.read().strip() or f"psql exited with status {status}"
                fail(f"PostgreSQL import failed for service {service}: {detail}")
    except FileNotFoundError:
        fail("psql was not found. Install the PostgreSQL client on the restore host.")


def copy_archive_to_psql(archive_path: Path, traccar_service: str, app_service: str,
                         included_tables: list[str], mapping: dict[int, int]) -> None:
    # Stage JSON rows with COPY, then insert using PostgreSQL's typed row
    # conversion. This keeps the process streaming and avoids SQL-literal data.
    def restore_database(service: str, items: list[tuple[str, str]]) -> None:
        def emit(stdin) -> None:
            stdin.write("BEGIN;\nSET CONSTRAINTS ALL DEFERRED;\n")
            for index, (entry, table) in enumerate(items):
                if not IDENTIFIER.fullmatch(table):
                    fail(f"Unsafe SQL table name {table!r}")
                stage = f"restore_stage_{index}"
                stdin.write(f'CREATE TEMP TABLE "{stage}" (payload text) ON COMMIT DROP;\n')
                stdin.write(f'COPY "{stage}" (payload) FROM STDIN;\n')
                with zipfile.ZipFile(archive_path, "r") as archive:
                    for record in read_json_lines(archive, entry):
                        mapped = map_record(record, mapping, entry)
                        encoded = base64.b64encode(json.dumps(mapped, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).decode("ascii")
                        stdin.write(encoded + "\n")
                stdin.write("\\.\n")
                # The archive is trusted only after strict checksum verification;
                # column names still come from records and are constrained here.
                # Build the target column union in a validation pass, then COPY in
                # a second pass, so absent optional fields keep target defaults.
                columns: set[str] = set()
                with zipfile.ZipFile(archive_path, "r") as archive:
                    for record in read_json_lines(archive, entry):
                        for key in map_record(record, mapping, entry):
                            if not IDENTIFIER.fullmatch(key):
                                fail(f"Unsafe SQL column name {key!r} in {entry}")
                            columns.add(key)
                if not columns:
                    continue
                quoted = ", ".join('"' + column + '"' for column in sorted(columns))
                values = ", ".join(
                    f'(jsonb_populate_record(NULL::public."{table}", convert_from(decode(payload, \'base64\'), \'UTF8\')::jsonb))."{column}"'
                    for column in sorted(columns)
                )
                stdin.write(f'INSERT INTO public."{table}" ({quoted}) SELECT {values} FROM "{stage}";\n')
            stdin.write("COMMIT;\n")
        psql_stream(service, emit)

    # Keep Traccar and app imports in separate transactions. Backups are the
    # rollback boundary if the second database fails after the first commits.
    restore_database(traccar_service, [("traccar/positions.jsonl", "tc_positions"), ("traccar/events.jsonl", "tc_events")])
    app_items = [(f"traccar-react-api/{table}.jsonl", table) for table in APP_TABLE_ORDER if table in included_tables]
    restore_database(app_service, app_items)


def write_app_sequence_sql(included_tables: list[str]) -> str:
    names = ",".join(sql_literal(table) for table in included_tables)
    return f"""
DO $$
DECLARE item record; sequence_name text;
BEGIN
  FOR item IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='id' AND table_name IN ({names})
  LOOP
    sequence_name := pg_get_serial_sequence('public.' || item.table_name, 'id');
    IF sequence_name IS NOT NULL THEN
      EXECUTE format('SELECT setval(%L, coalesce(max(id), 1), max(id) is not null) FROM public.%I', sequence_name, item.table_name);
    END IF;
  END LOOP;
END $$;
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Deployment export ZIP")
    parser.add_argument("--validate-only", action="store_true", help="Validate package and print record counts; do not contact servers or write data")
    parser.add_argument("--target-traccar-url", help="Destination Traccar base URL, e.g. http://127.0.0.1:8082")
    parser.add_argument("--traccar-service", help="pg_service.conf alias for target Traccar PostgreSQL")
    parser.add_argument("--traccar-react-api-service", help="pg_service.conf alias for target Traccar React API PostgreSQL")
    parser.add_argument("--device-map", type=Path, help="JSON object mapping source Traccar device IDs to destination IDs")
    parser.add_argument("--confirm-empty-target", action="store_true", help="Confirm both destination databases are disposable and transfer tables are empty")
    parser.add_argument("--execute", action="store_true", help="Perform writes after all preflight checks; requires --confirm-empty-target")
    args = parser.parse_args()

    try:
        manifest, _ = inspect_archive(args.archive)
        with zipfile.ZipFile(args.archive, "r") as archive:
            counts = {item["path"]: item["records"] for item in manifest["files"]}
            source_devices = list(read_json_lines(archive, "traccar/devices.jsonl"))
        try:
            source_ids = [int(device["id"]) for device in source_devices]
        except (KeyError, TypeError, ValueError):
            fail("Source device inventory contains an invalid numeric ID")
        if len(source_ids) != len(set(source_ids)):
            fail("Source device inventory contains duplicate IDs")
        if manifest.get("deviceCount") != len(source_devices):
            fail("Manifest device count does not match the device inventory")
        if args.validate_only:
            print(f"Valid package: format {manifest['formatVersion']}, Traccar {manifest['source']['traccarVersion']}")
            print(f"Source device count: {len(source_devices)}")
            for name, count in counts.items():
                print(f"{count:>10}  {name}")
            print("Validation only: no target connection or database writes were attempted.")
            return 0

        if not all((args.target_traccar_url, args.traccar_service, args.traccar_react_api_service, args.device_map)):
            fail("Restore requires --target-traccar-url, --traccar-service, --traccar-react-api-service, and --device-map (or use --validate-only).")
        if args.execute and not args.confirm_empty_target:
            fail("--execute requires --confirm-empty-target")
        if args.confirm_empty_target:
            print("The archive contains precise GPS locations, raw telemetry, and device identifiers.")
            confirmation = input("Type RESTORE to continue with target preflight: ")
            if confirmation != "RESTORE":
                fail("Confirmation did not match; no changes were made.")

        mapping = load_device_map(args.device_map, source_devices)
        username = input("Target Traccar username: ")
        password = getpass.getpass("Target Traccar password: ")
        server = traccar_get(args.target_traccar_url, username, password, TRACCAR_VERSION_URL_PATH)
        if server.get("version") != SUPPORTED_TRACCAR_VERSION:
            fail(f"Target Traccar version is {server.get('version')!r}; exact {SUPPORTED_TRACCAR_VERSION} is required.")
        devices = traccar_get(args.target_traccar_url, username, password, TRACCAR_DEVICES_URL_PATH)
        target_ids = {int(device["id"]) for device in devices if "id" in device}
        missing_targets = set(mapping.values()) - target_ids
        if missing_targets:
            fail("Mapped destination device IDs do not exist in target Traccar: " + ", ".join(map(str, sorted(missing_targets))))
        source_by_id = {int(item["id"]): item for item in source_devices}
        target_by_id = {int(item["id"]): item for item in devices if "id" in item}
        for source_id, target_id in mapping.items():
            source_name = source_by_id[source_id].get("name", "(unnamed)")
            target_name = target_by_id[target_id].get("name", "(unnamed)")
            print(f"Device mapping: {source_id} {source_name!r} -> {target_id} {target_name!r}")
        included = manifest["includedTraccarReactApiTables"]
        preflight_databases(args.traccar_service, args.traccar_react_api_service, included)
        print("Preflight passed: exact Traccar version, mapped devices, supported PostgreSQL tables, and empty target transfer/history tables.")
        if not args.execute:
            print("No writes were made. Add --execute --confirm-empty-target after reviewing the mappings and taking target backups.")
            return 0
        print("Importing Traccar history (positions, then events) and Traccar React API rows in dependency order.")
        copy_archive_to_psql(args.archive, args.traccar_service, args.traccar_react_api_service, included, mapping)
        psql(args.traccar_service, "\n".join(
            f"select setval(pg_get_serial_sequence('public.{table}', 'id'), coalesce(max(id), 1), max(id) is not null) from public.{table};"
            for table in ("tc_positions", "tc_events")
        ) + "\n")
        psql(args.traccar_react_api_service, write_app_sequence_sql(included))
        print("Import completed. Compare manifest counts with both databases before starting Traccar React API or Traccar services.")
        return 0
    except RestoreError as exc:
        print(f"Restore refused: {exc}", file=sys.stderr)
        return 2
    except (KeyError, TypeError, ValueError, zipfile.BadZipFile) as exc:
        print(f"Restore refused: malformed package or mapping ({exc})", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

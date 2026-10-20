#!/usr/bin/env python3
"""Restore a Traccar Scope deployment-test export into a disposable Linux host.

The tool deliberately supports only the export format/version documented in
docs/DEPLOYMENT_TEST_DATA_TRANSFER.md. It validates everything before writes,
and supports PostgreSQL or MySQL for Traccar plus PostgreSQL for Traccar Scope API.
"""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import getpass
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Iterable


EXPECTED_FORMAT = 2
SUPPORTED_TRACCAR_VERSION = "6.14.5"
# The package remains pinned to 6.14.5. Traccar 6.16.0 is also accepted as a
# target: its intervening 6.15 migration widens IDs in tc_devices/tc_actions,
# while this importer writes history only to tc_positions/tc_events and checks
# those target table schemas before any write.
SUPPORTED_TARGET_TRACCAR_VERSIONS = {"6.14.5", "6.16.0"}
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
        app_prefix = "traccar-scope-api"
        included = manifest.get("includedTraccarScopeApiTables")
        if not isinstance(included, list) or any(not isinstance(t, str) or t not in APP_TABLE_ORDER for t in included):
            fail("Manifest has an unknown Traccar Scope API table list")
        missing_required = REQUIRED_APP_TABLES - set(included)
        if missing_required:
            fail("Archive is missing required Traccar Scope API tables: " + ", ".join(sorted(missing_required)))

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
        manifest["includedTraccarScopeApiTables"] = included
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


def preflight_databases(traccar_service: str, app_service, included_tables: list[str]) -> None:
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
    rows = json.loads(psql_target(app_service, sql))
    found = {row["table"] for row in rows}
    if found != set(included_tables):
        fail("Target Traccar Scope API schema must be migrated before restore; missing: " + ", ".join(sorted(set(included_tables) - found)))
    nonempty = [f"{row['table']}={row['rows']}" for row in rows if row["rows"]]
    if nonempty:
        fail("Target Traccar Scope API transfer tables are not empty; refusing to overwrite: " + ", ".join(nonempty))


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
    if table == "traccar-scope-api/traccar_sources.jsonl" and "base_url" in result:
        fail("Archive contains excluded traccar_sources.base_url data")
    if table in {"traccar-scope-api/telemetry_profile_revisions.jsonl", "traccar-scope-api/telemetry_source_mapping_revisions.jsonl"} and "changed_by" in result:
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


class MysqlTarget:
    """Run the MySQL client inside an existing disposable database container."""

    def __init__(self, container: str, user: str, database: str, password: str, docker_sudo: bool = False):
        self.container = container
        self.docker_prefix = ["sudo", "docker"] if docker_sudo else ["docker"]
        self.config_path = f"/tmp/traccar-scope-restore-{os.getpid()}.cnf"
        escaped_password = password.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        config = f'[client]\nuser="{user}"\npassword="{escaped_password}"\ndatabase="{database}"\n'
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as stream:
                self.host_config = Path(stream.name)
                stream.write(config)
            os.chmod(self.host_config, 0o600)
            copied = subprocess.run(
                [*self.docker_prefix, "cp", str(self.host_config), f"{container}:{self.config_path}"],
                capture_output=True, text=True, check=False,
            )
            if copied.returncode:
                fail("Could not securely stage temporary MySQL client configuration in the database container: " + copied.stderr.strip())
            secured = subprocess.run(
                [*self.docker_prefix, "exec", container, "chmod", "600", self.config_path],
                capture_output=True, text=True, check=False,
            )
            if secured.returncode:
                fail("Could not restrict temporary MySQL client configuration permissions: " + secured.stderr.strip())
        except OSError as exc:
            if hasattr(self, "host_config"):
                self.host_config.unlink(missing_ok=True)
            fail(f"Could not prepare MySQL client configuration: {exc}")
        except RestoreError:
            if hasattr(self, "host_config"):
                self.host_config.unlink(missing_ok=True)
            subprocess.run([*self.docker_prefix, "exec", container, "rm", "-f", self.config_path], capture_output=True, check=False)
            raise

    def close(self) -> None:
        try:
            subprocess.run([*self.docker_prefix, "exec", self.container, "rm", "-f", self.config_path], capture_output=True, check=False)
        finally:
            if hasattr(self, "host_config"):
                self.host_config.unlink(missing_ok=True)

    def command(self) -> list[str]:
        return [*self.docker_prefix, "exec", "-i", self.container, "mysql", f"--defaults-extra-file={self.config_path}", "--batch", "--skip-column-names", "--default-character-set=utf8mb4"]

    def query(self, sql: str) -> str:
        try:
            result = subprocess.run(self.command(), input=sql, text=True, capture_output=True, check=False)
        except FileNotFoundError:
            fail("Docker CLI was not found; it is required to run the MySQL client in the database container.")
        if result.returncode:
            fail("MySQL target preflight failed: " + (result.stderr.strip() or f"mysql exited with status {result.returncode}"))
        return result.stdout.strip()

    def stream(self, emit) -> None:
        try:
            with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as errors:
                process = subprocess.Popen(self.command(), stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors, text=True)
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
                    fail("MySQL import failed: " + (errors.read().strip() or f"mysql exited with status {status}"))
        except FileNotFoundError:
            fail("Docker CLI was not found; it is required to run the MySQL client in the database container.")


class PostgresContainerTarget:
    """Run psql inside a PostgreSQL container without publishing its port."""

    def __init__(self, container: str, user: str, database: str, password: str, docker_sudo: bool = False):
        self.container = container
        self.user = user
        self.database = database
        self.docker_prefix = ["sudo", "docker"] if docker_sudo else ["docker"]
        self.passfile_path = f"/tmp/traccar-scope-restore-{os.getpid()}.pgpass"
        escaped_password = password.replace("\\", "\\\\").replace(":", "\\:").replace("\n", "\\n")
        passfile = f"127.0.0.1:5432:{database}:{user}:{escaped_password}\n"
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as stream:
                self.host_passfile = Path(stream.name)
                stream.write(passfile)
            os.chmod(self.host_passfile, 0o600)
            copied = subprocess.run(
                [*self.docker_prefix, "cp", str(self.host_passfile), f"{container}:{self.passfile_path}"],
                capture_output=True, text=True, check=False,
            )
            if copied.returncode:
                fail("Could not securely stage temporary PostgreSQL password file in the database container: " + copied.stderr.strip())
            secured = subprocess.run(
                [*self.docker_prefix, "exec", container, "chmod", "600", self.passfile_path],
                capture_output=True, text=True, check=False,
            )
            if secured.returncode:
                fail("Could not restrict temporary PostgreSQL password file permissions: " + secured.stderr.strip())
        except OSError as exc:
            if hasattr(self, "host_passfile"):
                self.host_passfile.unlink(missing_ok=True)
            fail(f"Could not prepare PostgreSQL password file: {exc}")
        except RestoreError:
            if hasattr(self, "host_passfile"):
                self.host_passfile.unlink(missing_ok=True)
            subprocess.run([*self.docker_prefix, "exec", container, "rm", "-f", self.passfile_path], capture_output=True, check=False)
            raise

    def close(self) -> None:
        try:
            subprocess.run([*self.docker_prefix, "exec", self.container, "rm", "-f", self.passfile_path], capture_output=True, check=False)
        finally:
            if hasattr(self, "host_passfile"):
                self.host_passfile.unlink(missing_ok=True)

    def command(self) -> list[str]:
        return [*self.docker_prefix, "exec", "-i", "-e", f"PGPASSFILE={self.passfile_path}", self.container,
                "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--host=127.0.0.1", "--username", self.user,
                "--dbname", self.database]

    def query(self, sql: str) -> str:
        command = self.command() + ["--tuples-only", "--no-align"]
        try:
            result = subprocess.run(command, input=sql, text=True, capture_output=True, check=False)
        except FileNotFoundError:
            fail("Docker CLI was not found; it is required to run psql in the PostgreSQL container.")
        if result.returncode:
            fail("PostgreSQL container query failed: " + (result.stderr.strip() or f"psql exited with status {result.returncode}"))
        return result.stdout.strip()

    def stream(self, emit) -> None:
        try:
            with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as errors:
                process = subprocess.Popen(self.command(), stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors, text=True)
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
                    fail("PostgreSQL container import failed: " + (errors.read().strip() or f"psql exited with status {status}"))
        except FileNotFoundError:
            fail("Docker CLI was not found; it is required to run psql in the PostgreSQL container.")


def psql_target(target, sql: str) -> str:
    return target.query(sql) if isinstance(target, PostgresContainerTarget) else psql(target, sql)


def psql_target_stream(target, emit) -> None:
    target.stream(emit) if isinstance(target, PostgresContainerTarget) else psql_stream(target, emit)


def mysql_value(value: Any, column: str) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not (float("-inf") < value < float("inf")):
            fail("Archive contains a non-finite number")
        return repr(value)
    if isinstance(value, (dict, list)):
        value = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    if not isinstance(value, str):
        fail(f"Unsupported value type for MySQL column {column}")
    if column in {"servertime", "devicetime", "fixtime", "eventtime"}:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
            value = parsed.strftime("%Y-%m-%d %H:%M:%S.%f")
        except ValueError:
            fail(f"Invalid UTC timestamp in MySQL column {column}")
    encoded = value.encode("utf-8").hex()
    return f"CONVERT(X'{encoded}' USING utf8mb4)"


def preflight_mysql_traccar(target: MysqlTarget, archive_path: Path, mapping: dict[int, int]) -> None:
    rows = target.query("SELECT (SELECT COUNT(*) FROM tc_positions), (SELECT COUNT(*) FROM tc_events), (SELECT COUNT(*) FROM tc_devices);\n")
    try:
        positions, events, devices = (int(part) for part in rows.split("\t"))
    except (ValueError, TypeError):
        fail("Could not validate target MySQL Traccar tables")
    if positions or events:
        fail(f"Target Traccar history is not empty (positions={positions}, events={events}); refusing to import.")
    if devices == 0:
        fail("Target Traccar has no devices. Create the destination devices in Traccar first.")
    engines = target.query("SELECT TABLE_NAME, COALESCE(ENGINE, '') FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tc_positions', 'tc_events') ORDER BY TABLE_NAME;\n")
    engine_map = dict(line.split("\t", 1) for line in engines.splitlines() if "\t" in line)
    if set(engine_map) != {"tc_positions", "tc_events"}:
        fail("Target MySQL Traccar database is missing tc_positions or tc_events.")
    if any(engine.upper() != "INNODB" for engine in engine_map.values()):
        fail("Target MySQL Traccar history tables must use InnoDB so imports can roll back safely.")

    available = target.query("SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tc_positions', 'tc_events');\n")
    columns_by_table: dict[str, set[str]] = {"tc_positions": set(), "tc_events": set()}
    for line in available.splitlines():
        table, column = line.split("\t", 1)
        columns_by_table[table].add(column)
    expected_by_table: dict[str, set[str]] = {"tc_positions": set(), "tc_events": set()}
    for entry, table in (("traccar/positions.jsonl", "tc_positions"), ("traccar/events.jsonl", "tc_events")):
        with zipfile.ZipFile(archive_path, "r") as package:
            for record in read_json_lines(package, entry):
                expected_by_table[table].update(map_record(record, mapping, entry))
    for table, expected in expected_by_table.items():
        missing = expected - columns_by_table[table]
        if missing:
            fail(f"Target MySQL {table} schema is missing columns required by the export: " + ", ".join(sorted(missing)))


def preflight_app_database(app_service, included_tables: list[str]) -> None:
    names = ",".join(sql_literal(table) for table in included_tables)
    sql = f"""
select coalesce(json_agg(json_build_object('table', table_name, 'rows', row_count)), '[]'::json)::text
from (
  select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text::bigint as row_count
  from information_schema.tables
  where table_schema=current_schema() and table_type='BASE TABLE' and table_name in ({names})
) counts;
"""
    rows = json.loads(psql_target(app_service, sql))
    found = {row["table"] for row in rows}
    if found != set(included_tables):
        fail("Target Traccar Scope API schema must be migrated before restore; missing: " + ", ".join(sorted(set(included_tables) - found)))
    nonempty = [f"{row['table']}={row['rows']}" for row in rows if row["rows"]]
    if nonempty:
        fail("Target Traccar Scope API transfer tables are not empty; refusing to overwrite: " + ", ".join(nonempty))


def import_mysql_traccar(archive_path: Path, target: MysqlTarget, mapping: dict[int, int]) -> None:
    def emit(sql) -> None:
        sql.write("START TRANSACTION;\n")
        for entry, table in (("traccar/positions.jsonl", "tc_positions"), ("traccar/events.jsonl", "tc_events")):
            columns: set[str] = set()
            with zipfile.ZipFile(archive_path, "r") as archive:
                for record in read_json_lines(archive, entry):
                    columns.update(map_record(record, mapping, entry))
            if not columns:
                continue
            if any(not IDENTIFIER.fullmatch(column) for column in columns):
                fail(f"Archive contains an unsafe MySQL column name in {entry}")
            ordered = sorted(columns)
            quoted = ", ".join(f"`{column}`" for column in ordered)
            values: list[str] = []
            with zipfile.ZipFile(archive_path, "r") as archive:
                for record in read_json_lines(archive, entry):
                    mapped = map_record(record, mapping, entry)
                    values.append("(" + ", ".join(mysql_value(mapped.get(column), column) for column in ordered) + ")")
                    if len(values) >= 250:
                        sql.write(f"INSERT INTO `{table}` ({quoted}) VALUES\n" + ",\n".join(values) + ";\n")
                        values.clear()
            if values:
                sql.write(f"INSERT INTO `{table}` ({quoted}) VALUES\n" + ",\n".join(values) + ";\n")
        sql.write("COMMIT;\n")
    target.stream(emit)


def copy_archive_to_psql(archive_path: Path, traccar_service,
                         app_service,
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
        psql_target_stream(service, emit)

    # Keep Traccar and app imports in separate transactions. Backups are the
    # rollback boundary if the second database fails after the first commits.
    if traccar_service:
        restore_database(traccar_service, [("traccar/positions.jsonl", "tc_positions"), ("traccar/events.jsonl", "tc_events")])
    app_items = [(f"traccar-scope-api/{table}.jsonl", table) for table in APP_TABLE_ORDER if table in included_tables]
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
    parser.add_argument("--traccar-mysql-container", help="Running Traccar MySQL database container name")
    parser.add_argument("--traccar-mysql-user", help="MySQL account used for the target Traccar database")
    parser.add_argument("--traccar-mysql-database", default="traccar", help="Target MySQL database name (default: traccar)")
    parser.add_argument("--docker-sudo", action="store_true", help="Run Docker CLI commands through sudo (use when Docker access is not granted to your user)")
    parser.add_argument("--traccar-scope-api-service", help="pg_service.conf alias for target Traccar Scope API PostgreSQL")
    parser.add_argument("--traccar-scope-api-postgres-container", help="Running PostgreSQL container for Traccar Scope API database")
    parser.add_argument("--traccar-scope-api-postgres-user", help="Database account used for the Traccar Scope API database")
    parser.add_argument("--traccar-scope-api-postgres-database", default="traccar_scope_api", help="Traccar Scope API database name (default: traccar_scope_api)")
    parser.add_argument("--device-map", type=Path, help="JSON object mapping source Traccar device IDs to destination IDs")
    parser.add_argument("--confirm-empty-target", action="store_true", help="Confirm both destination databases are disposable and transfer tables are empty")
    parser.add_argument("--execute", action="store_true", help="Perform writes after all preflight checks; requires --confirm-empty-target")
    args = parser.parse_args()

    mysql_target = None
    app_postgres_target = None
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

        use_mysql = bool(args.traccar_mysql_container)
        if bool(args.traccar_service) == use_mysql:
            fail("Specify exactly one of --traccar-service (PostgreSQL) or --traccar-mysql-container (MySQL).")
        if use_mysql and not args.traccar_mysql_user:
            fail("--traccar-mysql-user is required with --traccar-mysql-container.")
        use_app_container = bool(args.traccar_scope_api_postgres_container)
        if bool(args.traccar_scope_api_service) == use_app_container:
            fail("Specify exactly one of --traccar-scope-api-service or --traccar-scope-api-postgres-container.")
        if use_app_container and not args.traccar_scope_api_postgres_user:
            fail("--traccar-scope-api-postgres-user is required with --traccar-scope-api-postgres-container.")
        if not all((args.target_traccar_url, args.device_map)):
            fail("Restore requires --target-traccar-url, one Traccar database option, one Traccar Scope API database option, and --device-map (or use --validate-only).")
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
        if server.get("version") not in SUPPORTED_TARGET_TRACCAR_VERSIONS:
            supported_targets = ", ".join(sorted(SUPPORTED_TARGET_TRACCAR_VERSIONS))
            fail(f"Target Traccar version is {server.get('version')!r}; supported target versions are {supported_targets}.")
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
        included = manifest["includedTraccarScopeApiTables"]
        if use_app_container:
            app_password = getpass.getpass("Target Traccar Scope API PostgreSQL password: ")
            app_postgres_target = PostgresContainerTarget(
                args.traccar_scope_api_postgres_container,
                args.traccar_scope_api_postgres_user,
                args.traccar_scope_api_postgres_database,
                app_password,
                args.docker_sudo,
            )
        else:
            app_postgres_target = args.traccar_scope_api_service
        if use_mysql:
            mysql_password = getpass.getpass("Target Traccar MySQL password: ")
            mysql_target = MysqlTarget(args.traccar_mysql_container, args.traccar_mysql_user, args.traccar_mysql_database, mysql_password, args.docker_sudo)
            preflight_mysql_traccar(mysql_target, args.archive, mapping)
            preflight_app_database(app_postgres_target, included)
            traccar_database_kind = "MySQL"
        else:
            preflight_databases(args.traccar_service, app_postgres_target, included)
            traccar_database_kind = "PostgreSQL"
        print(f"Preflight passed: supported Traccar version, mapped devices, supported {traccar_database_kind} tables, and empty target transfer/history tables.")
        if not args.execute:
            print("No writes were made. Add --execute --confirm-empty-target after reviewing the mappings and taking target backups.")
            return 0
        print("Importing Traccar history (positions, then events) and Traccar Scope API rows in dependency order.")
        if mysql_target:
            import_mysql_traccar(args.archive, mysql_target, mapping)
            for table in ("tc_positions", "tc_events"):
                maximum = int(mysql_target.query(f"SELECT COALESCE(MAX(id), 0) FROM `{table}`;\n"))
                mysql_target.query(f"ALTER TABLE `{table}` AUTO_INCREMENT = {maximum + 1};\n")
            copy_archive_to_psql(args.archive, None, app_postgres_target, included, mapping)
        else:
            copy_archive_to_psql(args.archive, args.traccar_service, app_postgres_target, included, mapping)
            psql(args.traccar_service, "\n".join(
                f"select setval(pg_get_serial_sequence('public.{table}', 'id'), coalesce(max(id), 1), max(id) is not null) from public.{table};"
                for table in ("tc_positions", "tc_events")
            ) + "\n")
        psql_target(app_postgres_target, write_app_sequence_sql(included))
        print("Import completed. Compare manifest counts with both databases before starting Traccar Scope API or Traccar services.")
        return 0
    except RestoreError as exc:
        print(f"Restore refused: {exc}", file=sys.stderr)
        return 2
    except (KeyError, TypeError, ValueError, zipfile.BadZipFile) as exc:
        print(f"Restore refused: malformed package or mapping ({exc})", file=sys.stderr)
        return 2
    finally:
        if mysql_target:
            mysql_target.close()
        if app_postgres_target and isinstance(app_postgres_target, PostgresContainerTarget):
            app_postgres_target.close()


if __name__ == "__main__":
    raise SystemExit(main())

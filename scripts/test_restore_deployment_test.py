import hashlib
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


TOOL_PATH = Path(__file__).with_name("restore_deployment_test.py")
SPEC = importlib.util.spec_from_file_location("restore_deployment_tool", TOOL_PATH)
TOOL = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(TOOL)

TABLES = [
    "vehicles", "vehicle_device_bindings", "trips", "telemetry_profiles",
    "telemetry_profile_assignments", "telemetry_profile_revisions",
    "telemetry_source_mapping_revisions",
]


def make_archive(path: Path, *, tamper: bool = False, unsafe: bool = False) -> None:
    entries = {
        "traccar/devices.jsonl": b'{"id":7,"name":"Synthetic"}\n',
        "traccar/positions.jsonl": b"",
        "traccar/events.jsonl": b"",
    }
    prefix = "traccar-scope-api"
    entries.update({f"{prefix}/{table}.jsonl": b"" for table in TABLES})
    summaries = [
        {
            "path": name,
            "records": sum(bool(line.strip()) for line in content.splitlines()),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        for name, content in entries.items()
    ]
    if tamper:
        entries["traccar/devices.jsonl"] = b'{"id":8,"name":"Changed"}\n'
    manifest = {
        "formatVersion": 2,
        "source": {"traccarVersion": "6.14.5"},
        "range": {
            "fromInclusiveUtc": "2026-10-01T00:00:00Z",
            "toExclusiveUtc": "2026-10-02T00:00:00Z",
        },
        "deviceCount": 1,
        "includedTraccarScopeApiTables": TABLES,
        "files": summaries,
    }
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for name, content in entries.items():
            archive.writestr(f"../{name}" if unsafe and name == "traccar/devices.jsonl" else name, content)


class RestorePackageTests(unittest.TestCase):
    def test_valid_synthetic_archive_passes_integrity_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "valid.zip"
            make_archive(path)
            manifest, _ = TOOL.inspect_archive(path)
            self.assertEqual(manifest["source"]["traccarVersion"], "6.14.5")

    def test_checksum_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tampered.zip"
            make_archive(path, tamper=True)
            with self.assertRaises(TOOL.RestoreError):
                TOOL.inspect_archive(path)

    def test_unsafe_zip_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unsafe.zip"
            make_archive(path, unsafe=True)
            with self.assertRaises(TOOL.RestoreError):
                TOOL.inspect_archive(path)

    def test_traccar_api_fields_and_device_ids_are_mapped(self):
        record = TOOL.map_record(
            {
                "id": 4,
                "deviceId": 7,
                "serverTime": "2026-10-01T18:00:00Z",
                "deviceTime": "2026-10-01T18:00:00Z",
                "fixTime": "2026-10-01T18:00:00Z",
                "attributes": {"io1": 1},
                "network": {"radioType": "lte"},
                "geofenceIds": [8],
                "outdated": False,
            },
            {7: 22},
            "traccar/positions.jsonl",
        )
        self.assertEqual(record["deviceid"], 22)
        self.assertEqual(record["attributes"], '{"io1":1}')
        self.assertEqual(record["network"], '{"radioType":"lte"}')
        self.assertNotIn("geofenceIds", record)
        self.assertNotIn("outdated", record)

    def test_event_time_maps_to_versioned_eventtime_column(self):
        record = TOOL.map_record(
            {"id": 9, "deviceId": 7, "positionId": 4, "eventTime": "2026-10-01T18:00:00Z", "type": "ignitionOn"},
            {7: 22},
            "traccar/events.jsonl",
        )
        self.assertEqual(record["deviceid"], 22)
        self.assertEqual(record["positionid"], 4)
        self.assertEqual(record["eventtime"], "2026-10-01T18:00:00Z")

    def test_full_target_preflight_stops_before_any_import(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "synthetic.zip"
            device_map_path = root / "device-map.json"
            make_archive(archive_path)
            device_map_path.write_text('{"7":22}', encoding="utf-8")

            def fake_traccar_get(_url, _username, _password, path):
                if path == TOOL.TRACCAR_VERSION_URL_PATH:
                    return {"version": "6.14.5"}
                return [{"id": 22, "name": "Synthetic target"}]

            def fake_psql(_service, sql, **_kwargs):
                if "to_regclass('timescaledb_information.hypertables')" in sql:
                    return "false"
                if "from tc_positions" in sql:
                    return "0,0,1"
                return json.dumps([{"table": table, "rows": 0} for table in TABLES])

            argv = [
                "restore_deployment_test.py", str(archive_path),
                "--target-traccar-url", "http://127.0.0.1:8082",
                "--traccar-service", "traccar_restore",
                "--traccar-scope-api-service", "traccar_scope_api_restore",
                "--device-map", str(device_map_path),
                "--confirm-empty-target",
            ]
            output = io.StringIO()
            with (
                mock.patch.object(sys, "argv", argv),
                mock.patch.object(TOOL, "traccar_get", side_effect=fake_traccar_get),
                mock.patch.object(TOOL, "psql", side_effect=fake_psql),
                mock.patch.object(TOOL, "copy_archive_to_psql") as import_mock,
                mock.patch("builtins.input", return_value="RESTORE"),
                mock.patch("getpass.getpass", return_value="synthetic-password"),
                contextlib.redirect_stdout(output),
            ):
                result = TOOL.main()
            self.assertEqual(result, 0)
            self.assertIn("Preflight passed", output.getvalue())
            self.assertIn("No writes were made", output.getvalue())
            import_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()

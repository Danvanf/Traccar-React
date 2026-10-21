> **Archived and closed (2026-10-20).** This historical profile-expansion checkpoint is superseded by current device profiles and catalogs. Its unresolved research notes are not active tasks from this snapshot.
>
> This file records the original project discussion and its status at that time. Verify claims and commands against the current code and documentation before reusing them.

# Device Profile Expansion Progress

**Started:** 2026-10-08  
**Location:** Outside the traccar-react repository so this working log is not included in GitHub commits.

## Goal

Expand the device protocol profile library while keeping each profile tied to the correct tracker model, firmware/configuration, Traccar decoder behavior, and observed API fields. Keep raw Traccar records and raw exports intact. Do not copy a meaning, multiplier, unit, or sentinel from one model to another without evidence.

## Candidate profiles

The current repository contains only device-profiles/teltonika-fmm003.json. The review refers to these next candidates; confirm exact model variants and firmware before adding final profiles:

1. Teltonika FMB003
2. Teltonika FMM00A
3. Queclink GL200 / GL300 (decoder branch appears to vary by protocol message)
4. Digital Matter Oyster3

The FMM003 remains the existing baseline. Candidate profiles should use distinct stable IDs and must not alter FMM003 mappings as a side effect.

## Work completed in this pass

- Confirmed the translation code converted every numeric-looking string to a JavaScript number, even for identifiers. Added explicit profile valueType support (number default, text, identifier), a profile-editor control, and identifier metadata for FMM003 io11/io14, the CAN ID fields, and VIN. The raw input is retained; the translated value for these fields is text.
- Confirmed malformed input under canonicalScale could produce NaN and still report mapped. Translation now reports invalid and null values when canonical numeric parsing or the canonical result is not finite.
- Added schema 14 migration to add identifier type to saved default FMM003 identifier mappings while preserving their existing labels and other mapping properties.
- Added regression tests for leading-zero identifier preservation, invalid canonical input, and migration preservation. Updated the catalog with an attributed implementation note (by Luna).
- Test suite and production build have not yet been run in this session.

## Evidence needed before profile mappings

### Existing FMM003

- **Decoder key/provenance conflict:** Compare a position from this app's /api/positions response against the exact device model/configuration and installed Traccar version. The existing FMM003 profile uses io36/io32/io239 in places where the reviewed Traccar decoder may emit rpm/coolantTemp/ignition. Do not rewrite mappings until the installed decoder and sample confirm the actual keys.
- **Normalized keys:** Obtain a raw Teltonika packet plus the decoder version to identify which AVL source produced normalized rpm or other copied/computed values.
- **AVL 12/13:** Still unresolved. Existing samples change but do not prove whether configured values mean fuel or CAN data. Need the tracker's enabled AVL list/configuration and a simultaneous known vehicle reading. Keep values raw/unitless meanwhile.
- **io50/io51:** Existing FMM003 samples support io50 as kPa and io51 as millivolts. These facts are FMM003-specific; confirm the Traccar keys in a sample before reusing on another tracker.

### New candidates

- **FMB003:** Manufacturer table proposes pressure and voltage mappings, but capture an API response from the installed Traccar version to confirm keys, types, and scaling. Keep FMB003 in its own profile.
- **FMM00A:** Capture exact model/firmware and API positions. Confirm whether power: 12.5 is already volts before any scaling. Confirm decoded coolant temperature key and Celsius behavior.
- **Queclink GL200 / GL300:** Need exact model, protocol version, message/report type, raw message, and corresponding Traccar position. In the reviewed GL300 decoder branch, a decimal-form tail may be odometer while an integer may be battery level; do not infer from the value alone. Missing battery data is missing, not zero.
- **Digital Matter Oyster3:** Need OEM I/O configuration, firmware, raw report and matching Traccar position. Analogue mappings can be reconfigured. Do not derive battery percentage from voltage without a device-supported chemistry/model rule.


## Traccar decoder provenance review (checked 2026-10-08)

Reviewed Traccar's current master Teltonika decoder source: https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java. This is a moving branch and is not proof of the installed Traccar host version.

The current decoder source has a model predicate FM[B-Z]...; the FMM003 name matches that pattern if Traccar has the device model set to FMM003. Under that predicate, the decoder maps AVL IDs to normalized keys, including:

- AVL 11 -> iccid string (not io11).
- AVL 12 -> fuelUsed scaled by 1/1000 (not io12).
- AVL 13 -> fuelConsumption scaled by 1/100 (not io13).
- AVL 32 -> coolantTemp; AVL 36 -> rpm.
- AVL 239 -> ignition boolean.
- AVL 85 can also write rpm for the applicable FM[B-Z] models, so normalized rpm alone does not prove which AVL ID supplied it.
- AVL 206 is temporarily stored as lac and may be consumed into Traccar's network/cell-tower object later in decoding. It may not remain as an io206 position attribute on this decoder path.
- IDs without a matching model-specific handler fall back to ioN. Current source does not register handlers for AVL 237 or 250, so those IDs appear to use the generic fallback if present in the packet.

This confirms the review's warning: the bundled FMM003 io36/io32 mappings will not label normalized rpm/coolantTemp keys; io239 is already covered by the normalized ignition mapping, but that is a separate mapping key from io239. The current profile's io11/io12/io13/io206 mappings may not match the keys left by current-master decoding. Do not remove or migrate any of these based on master alone: Dan's observed API payloads have contained ioN keys, and the installed server version/model setting is not confirmed here.

The repository does not pin a Traccar image version. A current-master source review cannot establish the behavior of the server actually decoding production positions. Resolve this by recording the version from the authenticated Traccar /api/server response and capturing a position from that same installation with its device model/configuration. Compare one packet if available, the resulting API attributes, and the exact decoder source tag/commit. Traccar's own support answer confirms /api/server returns the server version: https://www.traccar.org/forums/topic/how-can-i-know-wich-version-of-traccar-is-installed-on-my-server/.


## Installed-version sample comparison (Dan supplied 2026-10-08)

Traccar /api/server reports version 6.14.5. The supplied live /api/positions response for the Teltonika device confirms these observed attributes: io11=8988228066, io14=6800032603, io12=4435, io13=16, io32/io36 absent in this particular record, io113=84, io206=47359, io237=3, plus normalized ignition=false and motion=false. io250 was absent. The sample also contains io238=0, but its meaning remains unverified; do not infer it from the nearby ignition AVL ID.

The matching v6.14.5 source is https://github.com/traccar/traccar/blob/v6.14.5/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java. Its model-specific predicate is FM[B-Z]...; the exact string FMM003 matches it. When that predicate matches, this release maps AVL 11 to iccid, 12 to fuelUsed / 1000, 13 to fuelConsumption / 100, 32 to coolantTemp, 36 to rpm, 113 to batteryLevel, and 206 to lac. AVL 239 always maps to ignition regardless of model. Unmatched model-dependent IDs fall back to ioN.

Because the supplied sample has io11/io12/io13/io113/io206 as raw ioN while 239 is already normalized to ignition, the decoder path is consistent with a model that does not match FM[B-Z]... (for example a blank model or a different label), rather than the device hardware not supporting those values. This is a strong inference from the 6.14.5 source and sample, not direct proof: the sample lacks the Traccar device object's model property. Do not change the Traccar model or migrate profile mappings until that property is checked. Request GET /api/devices/5 from the same authenticated Traccar session, keeping only the model field if desired and redacting name/uniqueId. If model is exactly FMM003, investigate whether positions are being received through another decoder/configuration path or retained from before model assignment.

Observed values specifically settle these points: io237 is present with code 3 in this live record; io250 is not evidenced by it. io11/io14 raw values are retained in this decoder path and the app's identifier valueType is appropriate. The displayed unit/value conversions for io12/io13 must remain pending because this exact sample shows raw keys, and does not reveal their configured Teltonika semantics.

## Safeguards / design items still open

1. **API/raw preservation:** Verify the position object and raw export remain untouched when translated profile values are added. A profile conversion is display metadata; never rewrite stored Traccar data.
2. **Boolean/status fields:** Verify booleans remain booleans, are never sent through numeric conversion, and have no invented units.
3. **Unknown keys:** Keep unknown ioN values visible as unmapped and preserve their original type/value.
4. **Sentinels:** Only add sentinel rules with device-specific evidence. Test raw sentinel retention plus translated null/status sentinel. Do not treat absent keys as zero.
5. **Profile assignments over time:** Vehicle-to-device binding is time-aware, but vehicle profile assignment history is not. A profile change could reinterpret old records. Design effective-dated profile assignments or immutable profile snapshots before relying on profile reassignment for historical reports.
6. **Independent profile additions:** Add each experimental profile under a new ID only when absent; do not overwrite a user's saved definition. Preserve custom mappings and unknown JSON properties.
7. **Graph scaling:** Automatic plot scaling must affect plotted coordinates only; labels/exports should distinguish it from a real unit conversion.

## Proposed verification matrix

| Area | Case | Expected |
| --- | --- | --- |
| Raw preservation | FMB003 io51: 14500 | Raw stays 14500; translated/canonical volts 14.5; original position and raw export unchanged. |
| Pressure units | FMB003 io50: 99 | Metric 99 kPa; Imperial about 29.2347 inHg; raw stays 99. |
| Already-scaled value | FMM00A power: 12.5 | 12.5 V, never divided again. |
| Coolant | FMB003 coolantTemp: 90 | 90 °C or 194 °F after confirming source key. |
| Boolean/status | ignition: false | Boolean false, no numeric conversion/unit. |
| Unknown field | io999 | Raw type/value retained, visibly unmapped. |
| Missing/sentinel | Absent key, null, and documented sentinel | Absent/null is missing; documented sentinel is retained raw but translated as unavailable. |
| Identifier | Text 001234 | Raw remains 001234; translated value remains string with leading zeroes. |
| Invalid measurement | bad with canonical scale | Status invalid; no NaN value. |
| Migration | Existing schema-14 definition with user edits | No changed fields; new IDs added only when absent; FMM003 custom mappings preserved. |
| Historical assignment | Reassigned device/profile over time | Historical record resolves the profile effective at that timestamp. |
| Graph/export | Same point in graph, status, translated CSV, raw CSV | Physical value/unit agree; plot auto-scale changes only coordinates. |

## Next steps

1. Run focused tests and the full test/build checks for the value-type and invalid-number changes; fix any failures.
2. Review the actual API payload and installed Traccar version before deciding whether the current FMM003 mappings need provenance corrections.
3. For each candidate, collect one sanitized sample that includes exact device/firmware/version context, then compare decoder keys against its manufacturer catalog.
4. Build each profile separately, add evidence/source references and focused tests, and keep unresolved fields raw until confirmed.
5. Design effective-dated vehicle profile assignment before any production workflow changes profile IDs for vehicles with historical telemetry.


## Reusable Traccar evidence capture API (2026-10-08)

Added an admin-only endpoint to Traccar React API: `GET /api/device-protocol-diagnostics/{deviceId}?fromUtc=...&throughUtc=...`. It calls Traccar `/api/server`, `/api/devices/{id}`, and `/api/positions` with server-side read-only credentials. A request is limited to 24 hours and 2,000 positions. The response includes Traccar version, configured device model/category, timestamps, decoded telemetry attributes, and an explicit limitation that raw tracker packets and the tracker AVL configuration are not available through the positions API. Coordinates and device unique IDs are excluded. Requires Traccar React API authentication plus `TRACCAR_BASE_URL`, `TRACCAR_USERNAME`, `TRACCAR_PASSWORD`; documented in `traccar-react/TRACCAR_REACT_API_DOCKER_DEPLOYMENT.md`.

For the supplied device 5, Traccar 6.14.5 reports model `null`; sample position attributes include `io11`, `io12`, `io13`, and `io206`, alongside normalized `ignition`, `battery`, and `odometer`. This supports testing the unset-model explanation. It does not settle AVL 12/13 semantics or establish source IDs for normalized properties. Capture raw packet/tracker configuration separately for provenance.

### Development test environment usage

The development Traccar React API runs on development workstation and can reach the test Traccar server on Traccar host at `http://Traccar host:8082` ([private address omitted]:8082). The Traccar read-only account is configured in the API process environment; never copy its username/password into project files or chat output. Production Docker should instead use the Traccar service name on its Docker network. The API endpoint uses its own server-side Traccar read-only credentials and is loopback-only. A PowerShell script running on development workstation against `localhost:5124` needs no Traccar React API cookie or Traccar password in the shell. Run `scripts/capture_device_protocol_diagnostics.ps1` from PowerShell on development workstation to save a sanitized capture. The initial admin-cookie requirement was a mistake and was removed. The first live attempt returned `Traccar diagnostics are not configured`; username/password alone were insufficient because the API had no Traccar base URL. Added the test host to `appsettings.Development.json`; restart the development API to load it.

This capture is development/test support tooling only. A normal production installation does not need the extra Traccar diagnostic account or these environment variables. The tool lets profile maintainers collect decoder evidence without asking an operator to copy raw `/api/positions` records by hand.


## FMM003 test capture review (2026-10-08)

Dan ran the test API capture for Traccar device 5 over 2026-10-08 20:45–21:15 UTC. It returned 1,429 decoded positions; Traccar 6.14.5; device model null; and no raw packet. The test Traccar account is configured as admin-level read-only, with device access read-only and command sending disabled.

- This capture was taken before the Traccar device model was set. Its ioN keys are therefore pre-model-change evidence; do not use it to predict the normalized keys the decoder emits now. Dan has since set the model to FMM003. Capture a new range and compare raw ioN and normalized keys before changing profile mappings; the Traccar React API profile assignment remains separate from Traccar’s model setting.
- io12 spans 4416–4435 and increases during this range; io13 remains 16. This pattern favors a changing/cumulative role for 12 over a fixed program ID, but it does not prove configured meaning or scale. Keep both labels and values raw. The tracker AVL configuration or a known fuel reading is still needed.
- io11 and io14 are stable. Their concatenated shape is consistent with the catalog's split ICCID interpretation; identifier remains the right value type. The actual ID is not copied into project notes.
- io206=47359 and io237=3 are stable through the range. The current catalog describes these as GSM location area code and LTE Cat M1 respectively.
- io250=0 occurred once, consistent with the catalog's trip-stop code, but one occurrence does not validate all trip-state transitions. io252=1 also occurred once and remains unmapped here.
- io50=97–98 and io51=12392–15266 align with the prior pressure/voltage evidence. The 467 positions with the OBD field group also show io32=99–105, io36=0–3237, io37=0–107, io40=0–10544, io45=288–1197, and io53=20–27; these look plausible under the current metric source assumptions but are not scan-tool validation.

The development appsettings base URL is now http://Traccar host:8082; API credentials remain process environment values. A release/production app does not need the diagnostic account or this tooling.


## Candidate profile archive review (2026-10-08)

Dan clarified the active Teltonika tracker is an FMM003 (not FMB003); current device model is now set in Traccar. OBD-II items should still be interpreted using the relevant OBD PID definitions, while tracker-specific network fields can differ by model. A fresh diagnostics capture after the model change is needed to observe this installation’s decoder output.

`AddingOtherDevices.zip` contains a snapshot of the existing FMM003 `teltonika-fmm003.json` profile (schema 13, 91 mappings), a copy of `carProfiles.js`, its tests, and copies of the TODO and catalog. It does not contain additional device profile definitions for other models. The checked-in profile is now schema 14; the material differences are `valueType: identifier` on VIN, `io256`, `io11`, `io14`, `io100`, `io101`, `io388`, and `io529`. Treat the archive as an older review snapshot, not as a profile update to import. Its existing FMM003 JSON already labels AVL 12/13 as device-configured raw values and keeps network IDs unscaled.

The archive’s `TELTONIKA_FMB003_DATA_CATALOG.md` is specifically a manufacturer catalog reference and does not change the active tracker model. Keep FMM003 installation evidence distinct from FMB003-specific claims, especially for network and hardware-support details. No JSON profile or application code was changed from this archive review.

## AddingOtherDevices session output review (2026-10-08)

The correct working directory is `AddingOtherDevices/Output` (spelling: Adding). Read session documents alongside the matching numbered ledger. No experimental profile was copied into the application or bundled profile directory.

Five stand-alone experimental definitions are present: FMB120 (80 mappings), FMC130 (78), FMC003 (79), Queclink GV300 (30), and Queclink GV55 (23). These are potential profiles for those exact models; the FMC003 definition is not a profile for Dan's FMM003. README1/ledger1 and README4/ledger4 are byte-identical; README2/ledger2 and README3/ledger3 are byte-identical. The translation test scripts 3 and 4 are also byte-identical. Session labels should be preserved when referencing these deliverables.

Good structure: profiles have distinct opt-in IDs; ledgers distinguish illustrative values from captured samples and retain model/firmware, key, source ID, decoder, units, and evidence gaps; uncertain device-configured fields are left unscaled; and GPS/device fields outside `position.attributes` are not fabricated as attributes. These are useful review artifacts, not verified device support.

Review issues before adoption:

- All candidate JSON files are schema 13; the app is now schema 14. ID-like fields in the candidate profiles (for example `vin`, `iccid`, and `driverUniqueId`) need `valueType: identifier` where they are strings. Existing test assertions check `rawValue` but do not assert that the translated `value` preserves leading zeroes.
- The duplicated translation test script imports only FMB120, FMC130, and GV55. It does not exercise the FMC003/GV300 definitions described by README2/3 and `TEST_VECTORS3.md`; there is no distinct executable test in the folder for those two profiles.
- Dan has set the active Traccar model to FMM003 since the previous diagnostics capture. In Traccar 6.14.5, FMM003 matches the Teltonika `FM[B-Z]...` model predicate. This changes `position.attributes` keys for some IDs: e.g. 31→`engineLoad`, 32→`coolantTemp`, 36/85→`rpm`, 81→`obdSpeed`, and 12/13→`fuelUsed`/`fuelConsumption`; AVL 24 becomes top-level speed. The current FMM003 profile mostly maps the pre-model `ioN` keys and lacks aliases for these normalized keys. Existing historical positions are still the pre-change capture; verify with newly received records after model assignment.
- More significantly, Traccar 6.14.5 scales AVL 12 by 1/1000 into `fuelUsed` and AVL 13 by 1/100 into `fuelConsumption` when the model predicate matches. The FMM003 catalog lists GPS fuel semantics for those IDs but its hardware-support column does not list FMM003 in those rows; the prior raw sample alone did not establish meaning. A profile cannot recover the wire value after Traccar has normalized/scaled it. Compare post-change output and actual configured AVL settings before describing these as fuel metrics. The official FMM003 catalog explicitly lists FMM003 support for several OEM-specific fields such as 389, 390, 402, 410, 411, 755, and 1151/1152; a matching map can be expanded from those when Traccar key handling is confirmed.
- Keep FMM003-specific manufacturer support separate from FMB003/FMC003 support. Shared OBD PID semantics may be the same, but Traccar aliases and model-specific OEM/network handling still differ.

The next evidence step is a new short diagnostic capture after the model change, using positions generated after that change. Compare the `position.attributes` keys and sample values with the current FMM003 map before adding normalized-key aliases. At the user’s direction on 2026-10-08, the candidate profiles were bundled as optional experimental choices before live device validation. Keep them unassigned by default and validate schema, Traccar keys, multipliers, sentinels, and identifiers when matching devices are available.
## Optional bundled profiles — 2026-10-08

Added five experimental, manually selectable Traccar React profile definitions under traccar-react/device-profiles/: Teltonika FMB120, FMC003, FMC130 and Queclink GV300, GV55. They use separate experimental IDs; the existing FMM003 definition and current vehicle assignment are unchanged. Updated these JSON definitions to schema 14 and explicitly preserve known identifier/text fields as text types.

Added a focused test covering JSON parse, current schema, distinct IDs, mapping validation, and migration preservation. Updated the bundled profiles README to explain availability, manual assignment, and the need to validate model-specific Traccar fields against live data. An FMM00A definition remains future work until its Traccar output/profile evidence is available.

Validation limitation: this environment could not execute project Node processes because the sandbox denied path traversal at D:\Cust\Developement\... (EPERM). Both npm test and npm run build were attempted and failed before tests/build code ran. No device integration validation was possible; candidate semantics remain experimental.

## Post-model-change FMM003 capture (2026-10-08/09)

Captured via the development API's read-only diagnostics endpoint for device 5 over 2026-10-08 21:00 through 2026-10-09 03:15 UTC. Traccar 6.14.5 reported model FMM003 and returned 1,518 positions. The capture was summarized in memory; raw coordinates and identifiers were not added to this note.

- The profile TODO’s need for a fresh sample after setting the Traccar model is resolved. The timestamps show the decoder behavior changed partway through this range; older stored positions remain raw and were not re-decoded. The model-specific decoder output includes normalized `fuelUsed`, `fuelConsumption`, `batteryLevel`, and `iccid`, while several raw `ioN` keys remain in the same capture. The capture separates into two streams: raw `io12`/`io13` appeared from 21:00–21:29 UTC (611 positions); normalized `fuelUsed`/`fuelConsumption` first appeared at 22:29 UTC (907 positions), with no single position containing both forms. Their values match the raw `/1000` and `/100` scaling arithmetically across the adjacent streams, but this is not a per-position comparison.
- The current app FMM003 profile does not yet map the normalized `fuelUsed`, `fuelConsumption`, `batteryLevel`, or `iccid` keys. It also lacks normalized `engineLoad`, `coolantTemp`, `rpm`, and `obdSpeed` mappings; this capture did not contain these four fields, so a driving sample is still needed before asserting those outputs.
- The captured interval had ignition false throughout. It therefore does not validate live OBD temperature, RPM, engine load, speed, pressure, or accelerometer behavior. Keep the follow-up capture focused on an ignition-on drive.
- `odometer` varied from 389,000 to 565,005 while Traccar `totalDistance` advanced about 1.2 km. Do not revise the odometer mapping based on this sample; investigate its source/unit and sample ordering with an active-drive capture.
- New raw fields include `io238` (constant 0), `io387` (hex-like text), `io13201` (numeric), and one-off `io246`; preserve them as unknown until the FMM003 catalog and a known observation identify them.

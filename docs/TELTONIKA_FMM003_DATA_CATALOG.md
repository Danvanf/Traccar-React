# Teltonika FMM003 data catalog

Reviewed 2026-10-16 against the official [FMM003 parameter table](https://wiki.teltonika-gps.com/view/FMM003_Teltonika_Data_Sending_Parameters_ID) and the [Traccar v6.14.5 decoder](https://github.com/traccar/traccar/blob/v6.14.5/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java). The reference states firmware FMB.Ver.03.29.00 and newer.

The [complete shared AVL reference](TELTONIKA_FMM003_FMM00A_AVL_REFERENCE.md) covers all **349 IDs** from both requested pages: wire types, ranges, units, multipliers, complete hardware lists, state meanings, sensor errors, conditional encodings, and source inconsistencies. Its [structured companion](../device-field-catalog/teltonika/fmx003-reference.json) retains all factual table entries and additional links.

## Bundled profile

[device-profiles/teltonika-fmm003.json](../device-profiles/teltonika-fmm003.json) contains **348 mappings**, up from 91: 296 raw AVL definitions and 52 decoded/derived keys. Coverage includes permanent and event fields, OBD, OEM, ELD, EV, and BLE sensors. Documented meanings are mappings rather than yellow label guesses; reporting availability still depends on the vehicle, firmware, configuration, and decoder. Missing source units remain unknown.

The internal profile ID remains **buick-enclave-2010** to preserve existing assignments. The legacy key names the original vehicle but remains the stable profile identifier. The display name is **Teltonika FMM003**. The two current model pages share a manufacturer table; this does not mean every vehicle reports the same fields or that their configurations are interchangeable.

The definitions come from the [reviewed Teltonika FMX003 dictionary](../device-field-catalog/teltonika/fmx003-mappings.json). Per-model overrides preserve profile identity, source evidence, and status-card choices. Generated JSON files remain self-contained; no new runtime inheritance or backend schema is needed.

## Confirmed examples

| Raw field | Decoded counterpart | Interpretation |
| --- | --- | --- |
| io31 | engineLoad | Engine Load (%); both use scale 1. |
| io32 | coolantTemp | Coolant Temperature: signed raw byte versus decoded °C. |
| io33 | — | Signed Short Fuel Trim (%), not an unsigned byte. |
| io34 / io35 / io542 | — | Fuel pressure / intake MAP in kPa; io542 is the two-byte MAP form. |
| io36 | rpm | Engine RPM. Decoded rpm can also originate from AVL 85, so it does not claim a unique source ID. |
| io13201 | — | PCB temperature, signed 16-bit raw count ×0.1 °C. For example 65526 means −1 °C, not 6552.6 °C. |
| io66 / io67 / io68 | power / battery / batteryCurrent | Raw ×0.001 V/A; decoded values already use V/A. |
| io200 | sleepMode | Sleep Mode; the former eco-driving label is corrected. |
| io12 / io13 | fuelUsed / fuelConsumption | GPS fuel used and distance-based consumption; each received representation has its own scale. |
| io389 / io390 / io402 / io411 | See full reference | OEM distance, fuel volume, service distance, and battery state. Raw io389 is km; decoded obdOdometer is metres. |
| io25–io28 | bleTemp1–bleTemp4 | Raw hundredths of °C versus decoded °C; modern sensor error values are filtered in both representations. |
| io259 | — | Packed EcoAverage acceleration data, retained as text rather than plotted as one giant number. |

Manufacturer-defined meaning is separate from proof that a particular vehicle reports a field. The earlier Traccar Model configuration error explains historical generic keys; it does not invalidate documented field names. Neither a new drive nor a database rewrite is needed to document these IDs. New observations can validate the vehicle/decoder path.

## Applying the update

Profile schema 16 fills missing mappings and corrects fields that exactly match previous bundled defaults. Custom edits remain intact. The existing app migration flow backs up and synchronizes shared profile changes. This is a frontend/profile-data update: no new SQL migration or API restart is required. A newly created profile uses the expanded defaults immediately.

Existing historical profile snapshots retain their recorded definitions. This update does not silently replace old revisions or rewrite stored telemetry. Consequently, an old graph pinned to an earlier profile revision can still show its former labels/conversions; the current and new profiles receive the improvements.

Raw/decoded alternatives are explicitly listed for status-card selections, and each alternative keeps its own conversion. Graph, Status and the editor use the same translation functions. Known-field/value counts describe coverage or availability; they are not a claimed probability of correctness. Label-only suggestions do not conflict with confirmed units they never asserted.

## Deliberate limitations

- The complete reference preserves 53 additional accessory/hardware-specific rows that are not advertised as tracker capabilities by these defaults.
- EYE angles/voltage fields with omitted units retain known names without invented scales.
- Custom and packed structures stay raw/text. Configuration-dependent quantities have no unconditional conversion.
- VIN, ICCID and other identifiers remain text. Upstream numeric rounding cannot be repaired here.
- Source inconsistencies, including charge-count multipliers, remain flagged in the common reference.
- Decoder behavior is pinned to 6.14.5. Recheck representation when the installed version, device firmware or configuration changes.

> **Archived snapshot (2026-10-18).** Earlier session notes for experimental profile/ledger outputs; not a current profile definition.
>
> This file records the original project discussion and its status at that time. Verify claims and commands against the current code and documentation before reusing them.

# Experimental vehicle profiles, batch 3

These are stand-alone schemaVersion 13 JSON definitions for review. They are not installed, do not alter the current FMM003 profile, and do not modify a saved user's attribute map. Each mapping has a row in `field-ledger.csv` with model/firmware scope, manufacturer field and ID, wire type, sample-shaped illustrative value, decoded Traccar value, unit, multiplier, classification, sentinels, conversion, sources, and remaining uncertainty. Illustrations are **not captured samples**.

| Profile | Fields | Most useful additions | Primary references |
|---|---:|---|---|
| FMB120 | 80 | Two outputs, configurable DIN3/AIN2, Dallas temperatures, iButton, optional CAN speed/RPM/mileage/VIN, EYE movement | [Manufacturer AVL table](https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID), [Traccar decoder](https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java) |
| FMC130 | 78 | Two analog inputs and outputs, Dallas temperatures, iButton, optional CAN vehicle data | [Manufacturer AVL table](https://wiki.teltonika-gps.com/view/FMC130_Teltonika_Data_Sending_Parameters_ID), [Traccar decoder](https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java) |
| GV55 | 23 | Power, backup battery, CSQ, mileage, engine hours, input/output states, firmware codes | [Manufacturer @Track V1.05](https://www.eddywireless.com/assets/docs/GV55_Track_Air_Interface_Protocol_V105_decrypted.99185028.pdf), [Traccar GL200 text decoder](https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/Gl200TextProtocolDecoder.java) |

Location, time, speed, heading, altitude and device IMEI are top-level Traccar position/device properties and are intentionally not made up as `attributes` entries. Graph auto-scaling is display-only. Where canonical metadata exists it interprets the **already decoded Traccar attribute**, never rewrites the received value. `io6` is the special case: Traccar leaves AVL 6 as raw millivolts, so its canonical scale is 0.001 V.

## Conflicts and unsupported fields

- FMB120 DIN3 and AIN2 can depend on the same configured pin; confirm mode. FMC130 has no DIN3 in the manufacturer's shared hardware-support column, despite other models on the same catalog page listing AVL 3.
- The catalog's ICCID AVL 11 row does not name FMC130; no `iccid` mapping was copied there. A Traccar device's IMEI is independent of this AVL.
- Dallas wire 850 produces decoded 85 °C, which overlaps a physically valid temperature. It remains a measurement; decoded 200, 300, 400, 500 are marked invalid. If the raw packet or sensor status is available, this ambiguity can be resolved upstream.
- Dallas sensor ID AVL 76/77/79/71 is 64-bit. The generic fallback may lose precision in JSON; omitted pending a captured position and decoder/version inspection. The iButton driver ID AVL 78 is specially formatted as hexadecimal text.
- AVL 4 pulse counter conflicts with Traccar's generic `in4` decoding; omitted. AVL 10 appears as SD status in the table and may collide with generic `adc2`; omitted. PCB temperature AVL 13201 may be signed in the manufacturer table but generic fallback interpretation needs confirmation; omitted.
- CAN AVL 83 fuel consumed shares Traccar's `fuelUsed` key with the GPS estimate at AVL 12, and AVL 84/89 distinguish volume from percent. AVL 83 is omitted pending actual enabled I/O and sample. CAN fields need separately configured adapter plus vehicle support; `throttle` is labeled accelerator pedal as the manufacturer does.
- GV55's text protocol does not establish VIN, OBD PIDs, g-force axes or analog input channels. Do not copy GV300's ADC/fuel mappings into GV55. The GL200 decoder emits `charge=true` for wire 1 and `null` for wire 0. A label cannot repair this loss.
- `event`, `alarm`, and GV55 status bitmasks can be present only for particular message types and decoder branches. Their examples in the ledger are illustrative. Inspect a real `tc_positions.attributes` object before relying on these labels.
- The inherited Teltonika BLE one-byte temperature scale, EYE sensor selection, ignition source, fuel estimate, GNSS status enum, ICCID precision, and the catalog's broad hardware-support table still need model/configuration samples. The field ledger flags these conditions. Do not use the profiles as proof that a tracker is configured to transmit each field.

## Migration and checks

Keep each profile as a separate opt-in choice; do not merge its `attributeMap` over a saved map. Load through the supplied `createCarProfile` / `migrateProfileDefinition` paths. Save and graph the raw Traccar value separately from translated display values. Run:

```sh
CAR_PROFILES_MODULE=/absolute/path/to/carProfiles.mjs node test-profile-translations.mjs
```

The test checks raw preservation, mV-to-V, °C-to-°F, km/h-to-mph, m-to-mi, fuel volume, status-code and identifier behavior, invalid Dallas and RSSI codes, as well as preservation of an existing user's custom mappings. It is not a decoder integration test; use real wire packets, tracker Configurator exports, firmware number, and decoded positions to approve deployment.

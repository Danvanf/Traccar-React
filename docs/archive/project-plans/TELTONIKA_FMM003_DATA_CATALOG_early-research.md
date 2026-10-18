> **Archived snapshot (2026-10-18).** Early research catalog originally given the incorrect FMB003 filename. Current manufacturer references are docs/TELTONIKA_FMM003_DATA_CATALOG.md and docs/TELTONIKA_FMM00A_DATA_CATALOG.md.
>
> This file records the original project discussion and its status at that time. Verify claims and commands against the current code and documentation before reusing them.

# Teltonika FMB003 data catalog

This project keeps the FMB003 AVL vocabulary locally so a future graph or user
data-card editor can add fields without rediscovering the device protocol.

The authoritative reference is Teltonika's [FMB003 Teltonika Data Sending
Parameters ID](https://wiki.teltonika-gps.com/view/FMB003_Teltonika_Data_Sending_Parameters_ID)
page. Teltonika organizes the table into permanent I/O, eventual I/O, OBD,
OBD OEM, ELD, OEM EV, and BLE sensor groups. The page is firmware-sensitive
(currently documented for FMB firmware 03.29.00 and newer), so this file records
the source and scope rather than copying a snapshot that could silently become
wrong.

## What the application stores

`src/lib/carProfiles.js` is the executable catalog. Each entry records, where
known:

- the Traccar/Teltonika attribute key (`io36`, `io40`, `power`, etc.);
- the Teltonika AVL ID;
- a human label and display unit;
- scaling or unit conversion;
- sentinel values that mean “not available.”

`ioN` values in a Traccar position are not automatically renamed to the
manufacturer's semantic fields. Traccar's [Teltonika decoder](https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java)
stores generic I/O items as `io<ID>` attributes. AVL meanings can differ by
device model and data context, so use the FMM003-specific mapping when decoding
the current tracker; do not apply the similarly numbered FMB003 GPS-fuel entry
to FMM003 CAN values.

| Traccar key | FMM003 AVL meaning | Profile handling |
| --- | --- | --- |
| `io12` | Configuration-dependent: CAN Program ID or GPS fuel-used value appears in catalogs | Preserve raw as “AVL 12 (device-configured value)” until the tracker’s configured AVL list confirms meaning and unit. |
| `io13` | Configuration-dependent: CAN Module ID or GPS fuel-rate value appears in catalogs | Preserve raw as “AVL 13 (device-configured value)” until the tracker’s configured AVL list confirms meaning and unit. |
| `io100` / `io101` | Alternate AVL IDs for CAN Program ID / CAN Module ID | Map to the same semantic fields when present. |
| `io388` / `io529` | CAN Module ID in hexadecimal form | Preserve as text; do not parse as a measurement. |
| `io50` | Barometric pressure, kPa | Convert kPa to inHg for Imperial display. A Traccar value of 99 is about 29.23 inHg. |
| `io51` | Control module voltage, raw count × 0.001 V | Convert millivolts to volts. |
| `io206` | GSM Area Code (Location Area Code), unsigned network identifier | Preserve as a raw code with no unit or multiplier; it can change as the tracker moves between cellular location areas. |
| `io11` | SIM ICCID 1 (MSB), identifier | Preserve the raw identifier; it is not a measurement and has no unit or multiplier. |
| `io14` | SIM ICCID 2 (LSB), identifier | Preserve the raw identifier; it is not a measurement and has no unit or multiplier. |
| `io237` | Network Type | Preserve the raw code without scaling or a unit; Teltonika codes include 3 = LTE Cat M1. |
| `io250` | Trip state | Preserve the raw code without scaling or a unit; 0 = trip stop and 1 = trip start, with further state codes documented by Teltonika. |

The [FMM003 device parameter catalog](https://flespi.com/devices/teltonika-fmm003)
lists overlapping meanings for IDs 12 and 13, even within its FMM003 catalog.
The sample collected on 2026-10-07 had 934 positions: `io12` changed from
4189 to 4207 and `io13` changed from 19 to 16. This confirms that treating
these as fixed CAN identifiers is unsafe, but the values alone do not prove
which configured meaning or multiplier is active. The current profile therefore
keeps both raw and unconverted. The profile also maps `io11`/`io14` as raw split SIM ICCID identifiers, `io237` as the cellular network type, and `io250` as trip state; those mappings add labels only and do not apply measurement conversions. Check the tracker’s actual AVL configuration
and a known fuel or CAN reading before assigning units. The sample had no
`io100`, `io101`, `io138`, `io388`, or `io529` values, so it cannot confirm
those aliases. `io50` values 97–98 support kPa-to-inHg conversion, and `io51`
values 12,557–15,384 support millivolts-to-volts conversion.

Other Teltonika models may assign different meanings to the same IDs. The
FMB003 AVL page remains useful for model-specific multiplier and hardware
support details, but is not sufficient on its own to identify FMM003 fields.
Retain raw exports and recheck mappings when firmware, device configuration,
or the Traccar decoder changes.

To inspect existing received values directly on the Docker host, run
`scripts/export_fmm003_avl_samples.sh` with the Traccar device ID and a
time-bounded UTC range. It reads `tc_positions` from the `traccar` database
and writes a restricted-permission JSONL file containing position IDs, fix
times, and selected AVL attributes; it never changes database records.

The current profile covers the common FMB003 permanent, OBD, and OBD OEM
values needed for trip graphs: speed, RPM, coolant and intake temperature, MAF,
throttle, runtime, fuel, voltage, diagnostics, GNSS quality, odometer, VIN,
operator, tracker battery data, load, fuel-rail pressure, EGR, MIL history,
ambient and oil temperature, fault-code text, intake MAP, and fuel type.

## Adding a field later

1. Confirm the AVL ID and multiplier in the official FMB003 table for the
   device firmware.
2. Add an `attributeMap` entry with `avlId`, `label`, `units`, and conversion or
   sentinel metadata as needed.
3. Add a test using a representative raw value and its displayed value.
4. Keep unknown `ioN` fields visible in the raw “Other fields” view until the
   mapping is verified.

Not every catalog entry will be present in every packet. Teltonika only sends
configured/enabled elements, and vehicle support varies for OBD/OEM values.

## AVL 31 review note (by Luna)

The current profile maps `io31` as **Engine Load??** with no multiplier and an
tentative label. The FMM003 Teltonika parameter table labels AVL 31
as Engine Load in percent, but the hardware-support list for that row does not
include FMM003. A user-provided current position contained `io31: 62`, which
shows the key is present but does not independently prove its meaning. Keep the
question marks until the two full trip samples or a known ECU reading confirms
it. Do not remove this caveat based only on another device model's mapping.
Source: [Teltonika FMM003 Data Sending Parameters ID](https://wiki.teltonika-gps.com/view/FMM003_Teltonika_Data_Sending_Parameters_ID).

## CSV headers

The export dialog offers both forms:

- **Human-readable labels**: for example `Mass Air Flow (g/s) [attr_io40]`.
- **Teltonika attribute IDs**: for example `io40`.

The raw-ID form is the safest interchange/backup format. The human form is
intended for spreadsheets and graphing while retaining the source key in
brackets so it can still be traced back to the device packet.


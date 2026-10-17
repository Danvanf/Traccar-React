# Teltonika FMM003 / FMM00A AVL reference

Reviewed 2026-10-16. This reference covers every one of the **349 distinct AVL rows** on the requested [FMM003 page](https://wiki.teltonika-gps.com/view/FMM003_Teltonika_Data_Sending_Parameters_ID) and [FMM00A page](https://wiki.teltonika-gps.com/view/FMM00A_Teltonika_Data_Sending_Parameters_ID), across all seven parameter groups. Both pages currently render the same FMX003_Teltonika_Data_Sending_Parameters_ID template; their extracted tables are identical. Device and vehicle availability can still differ. The pages state firmware **FMB.Ver.03.29.00 and newer**.

The [structured reference](../device-field-catalog/teltonika/fmx003-reference.json) retains each ID, name, byte width, type/signedness, source range, multiplier, unit, full hardware list, parameter group, additional links, and interpretation notes. It records page revisions 104961/104963, retrieval date, and table fingerprints. Page revisions alone do not freeze transcluded templates; use the dated factual inventory for this review. Prose here summarizes technical facts rather than reproducing the source descriptions.

## Shared dictionary and device profiles

The [reviewed family dictionary](../device-field-catalog/teltonika/fmx003-mappings.json) is the common source for the two model profiles. It separates shared field definitions from model overrides and stable profile IDs. Each generated profile contains **296 raw AVL mappings and 52 decoded/derived keys (348 total)** and remains self-contained for import/export. Run the following from the repository root after editing the dictionary:

~~~powershell
node .\scripts\build_teltonika_profiles.mjs
node .\scripts\build_teltonika_profiles.mjs --check
~~~

Defaults include the 268 rows whose hardware list contains FMB003, FMM003, or FMM00A, plus eight previously observed/decoder-backed rows and 20 additional event definitions from these model pages. The remaining 53 rows are preserved for research; unrelated accessory hardware is not advertised as supported. A hardware-list omission is an availability caveat, not evidence that a manufacturer-defined field name or its stated unit is a guess. Several older shared hardware lists omit FMM003/FMM00A despite their model pages containing those definitions.

The [Traccar v6.14.5 decoder](https://github.com/traccar/traccar/blob/v6.14.5/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java) determines whether an AVL value becomes a raw io key or an already decoded key. Their conversions are separate. Neither a documented mapping nor a known-field count proves that a particular vehicle emits a measurement, or that its sensor has been calibrated. The original telemetry stays unchanged.

## Corrections and exceptions

| Field | Reviewed interpretation |
| --- | --- |
| AVL 31 / engineLoad | Engine Load, percent. The old question marks are removed. |
| AVL 36 / rpm | Engine RPM, revolutions per minute. Traccar can also produce rpm from AVL 85, so the decoded key does not claim one unique AVL ID. |
| AVL 200 / sleepMode | Sleep Mode; the old eco-driving label was wrong. Green-driving type is AVL 253. |
| AVL 12 / fuelUsed | GPS fuel used: raw ×0.001 L. Decoded fuelUsed is already L and can also originate from other fuel handlers. These pages do not identify AVL 12 as a CAN program ID. |
| AVL 13 / fuelConsumption | GPS distance-based consumption: raw ×0.01 L/100km. The decoder result is already L/100km on this path, despite the generic Traccar key comment suggesting L/h. |
| AVL 66 / power, 67 / battery, 68 / batteryCurrent | Raw counts use ×0.001 V/A; decoded values already use V/A. Do not divide them a second time. |
| AVL 181/182 / pdop/hdop | Raw coefficients use ×0.1; decoded coefficients are already scaled. |
| Signed 1/2/4-byte raw values | Interpret two’s complement before scaling because Traccar’s generic fallback reads unsigned integers. Already signed inputs remain signed. |
| BLE temperatures 25–28 | Raw ×0.01 °C; bleTemp1–4 are already °C. Modern error values are filtered in the correct representation. Older error codes overlap real temperatures and are not blanket-filtered. |
| BLE humidity 86/104/106/108 | Raw ×0.1 %RH; 65535/65534/65533 are unavailable, not humidity readings. |
| AVL 389 / obdOdometer | Raw io389 uses km; decoded obdOdometer uses metres on the reviewed paths. The AVL-389 handler is explicitly FMB003-only in v6.14.5, so FMM003/FMM00A normally keep io389. |
| AVL 100/101/388/529 | Neither requested page defines them. Unchanged unsupported CAN-ID guesses are removed; user-authored mappings are preserved. |
| Conditional and packed values | AVL 254 depends on event/configuration. AVL 258/259, 285 and beacon/custom/HEX payloads cannot be converted to one unconditional scalar. |
| EYE pitch/roll and battery voltage | Identity is known, but source units/scales are omitted. Keep units unknown. |
| OEM charge counts 1390/1391 | The source calls these counts but gives multiplier 0.1. Retain raw counts pending clarification. |
| ELD signed maximum 32768; Driver Card ID 406 | A signed 16-bit bound is inconsistent, and 406 repeats a gender description. Retain and flag those source facts rather than claiming validated semantics. |

Identifiers and ASCII/HEX payloads remain text. Leading zeroes survive when received as text; identifiers already rounded by an upstream numeric JSON producer cannot be reconstructed. No customer coordinates, VINs, tracker IDs, or trip data were copied here.

## Complete manufacturer table

Ranges below are the source-table ranges, not enforced validation limits. Some rows mix wire/physical ranges or contain editorial errors. A dash means the source omits that unit/multiplier. HW codes expand to the complete hardware lists below. “Default” means a raw mapping exists in both bundled profiles, not that every tracker or vehicle reports it.

### Permanent I/O elements

| AVL | Manufacturer name | Bytes / type | Min…max | Multiplier | Unit | HW | Default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 239 | Ignition | 1 / Unsigned | 0…1 | - | - | H01 | Yes |
| 240 | Movement | 1 / Unsigned | 0…1 | - | - | H01 | Yes |
| 80 | Data Mode | 1 / Unsigned | 0…5 | - | - | H02 | Yes |
| 21 | GSM Signal | 1 / Unsigned | 0…5 | - | - | H02 | Yes |
| 200 | Sleep Mode | 1 / Unsigned | 0…4 | - | - | H02 | Yes |
| 69 | GNSS Status | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 181 | GNSS PDOP | 2 / Unsigned | 0…500 | 0.1 | — | H02 | Yes |
| 182 | GNSS HDOP | 2 / Unsigned | 0…500 | 0.1 | — | H02 | Yes |
| 66 | External Voltage | 2 / Unsigned | 0…65535 | 0.001 | V | H01 | Yes |
| 24 | Speed | 2 / Unsigned | 0…350 | - | km/h | H02 | Yes |
| 205 | GSM Cell ID | 2 / Unsigned | 0…65535 | - | - | H02 | Yes |
| 206 | GSM Area Code | 2 / Unsigned | 0…65535 | - | - | H02 | Yes |
| 67 | Battery Voltage | 2 / Unsigned | 0…65535 | 0.001 | V | H03 | Yes |
| 68 | Battery Current | 2 / Unsigned | 0…65535 | 0.001 | A | H04 | Yes |
| 241 | Active GSM Operator | 4 / Unsigned | 0…4294967295 | - | - | H02 | Yes |
| 199 | Trip Odometer | 4 / Unsigned | 0…2147483647 | - | m | H02 | Yes |
| 16 | Total Odometer | 4 / Unsigned | 0…2147483647 | - | - | H02 | Yes |
| 1 | Digital Input 1 | 1 / Unsigned | 0…1 | - | - | H05 | Reference only |
| 9 | Analog Input 1 | 2 / Unsigned | 0…65535 | 0.001 | V | H06 | Reference only |
| 179 | Digital Output 1 | 1 / Unsigned | 0…1 | - | - | H07 | Reference only |
| 12 | Fuel Used GPS | 4 / Unsigned | 0…4294967295 | 0.001 | l | H08 | Yes |
| 13 | Fuel Rate GPS | 2 / Unsigned | 0…32767 | 0.01 | l/100km | H08 | Yes |
| 17 | Axis X | 2 / Signed | -8000…8000 | - | mG | H02 | Yes |
| 18 | Axis Y | 2 / Signed | -8000…8000 | - | mG | H02 | Yes |
| 19 | Axis Z | 2 / Signed | -8000…8000 | - | mG | H02 | Yes |
| 11 | ICCID1 | 8 / Unsigned | 0…0xffffffffffffffff | - | - | H02 | Yes |
| 10 | SD Status | 1 / Unsigned | 0…1 | - | - | H09 | Reference only |
| 2 | Digital Input 2 | 1 / Unsigned | 0…1 | - | - | H10 | Reference only |
| 3 | Digital Input 3 | 1 / Unsigned | 0…1 | - | - | H11 | Reference only |
| 6 | Analog Input 2 | 2 / Unsigned | 0…65535 | 0.001 | V | H12 | Reference only |
| 180 | Digital Output 2 | 1 / Unsigned | 0…1 | - | - | H13 | Reference only |
| 72 | Dallas Temperature 1 | 4 / Signed | -550…1150 | 0.1 | °C | H14 | Reference only |
| 73 | Dallas Temperature 2 | 4 / Signed | -550…1150 | 0.1 | °C | H14 | Reference only |
| 74 | Dallas Temperature 3 | 4 / Signed | -550…1150 | 0.1 | °C | H14 | Reference only |
| 75 | Dallas Temperature 4 | 4 / Signed | -550…1150 | 0.1 | °C | H14 | Reference only |
| 76 | Dallas Temperature ID 1 | 8 / Unsigned | 0…0xffffffffffffffff | - | - | H14 | Reference only |
| 77 | Dallas Temperature ID 2 | 8 / Unsigned | 0…0xffffffffffffffff | - | - | H14 | Reference only |
| 79 | Dallas Temperature ID 3 | 8 / Unsigned | 0…0xffffffffffffffff | - | - | H14 | Reference only |
| 71 | Dallas Temperature ID 4 | 8 / Unsigned | 0…0xffffffffffffffff | - | - | H14 | Reference only |
| 78 | iButton | 8 / Unsigned | 0…0xffffffffffffffff | - | - | H14 | Reference only |
| 207 | RFID | 8 / Unsigned | 0…0xffffffffffffffff | - | - | H15 | Reference only |
| 201 | LLS 1 Fuel Level | 2 / Signed | -4…32767 | - | kvants or ltr | H15 | Reference only |
| 202 | LLS 1 Temperature | 1 / Signed | -128…127 | - | °C | H15 | Reference only |
| 203 | LLS 2 Fuel Level | 2 / Signed | -4…32767 | - | kvants or ltr | H15 | Reference only |
| 204 | LLS 2 Temperature | 1 / Signed | -128…127 | - | °C | H15 | Reference only |
| 210 | LLS 3 Fuel Level | 2 / Unsigned | -4…32767 | - | kvants or ltr | H15 | Reference only |
| 211 | LLS 3 Temperature | 1 / Signed | -128…127 | - | °C | H15 | Reference only |
| 212 | LLS 4 Fuel Level | 2 / Signed | -4…32767 | - | kvants or ltr | H15 | Reference only |
| 213 | LLS 4 Temperature | 1 / Signed | -128…127 | - | °C | H15 | Reference only |
| 214 | LLS 5 Fuel Level | 2 / Signed | -4…32767 | - | kvants or ltr | H15 | Reference only |
| 215 | LLS 5 Temperature | 1 / Signed | -128…127 | - | °C | H15 | Reference only |
| 15 | Eco Score | 2 / Unsigned | 0…65535 | 0.01 | - | H16 | Yes |
| 113 | Battery Level | 1 / Unsigned | 0…100 | - | % | H03 | Yes |
| 238 | User ID | 8 / Unsigned | 0…0xffffffffffffffff | - | - | H17 | Reference only |
| 237 | Network Type | 1 / Unsigned | 0…4 (and 99 as separate value) | - | - | H18 | Yes |
| 4 | Pulse Counter Din1 | 4 / Unsigned | 0…4294967295 | - | - | H19 | Reference only |
| 5 | Pulse Counter Din2 | 4 / Unsigned | 0…4294967295 | - | - | H20 | Reference only |
| 263 | BT Status | 1 / Unsigned | 0…4 | - | - | H16 | Reference only |
| 264 | Barcode ID | Variable / ASCII | 0…32 | - | - | H21 | Reference only |
| 303 | Instant Movement | 1 / Unsigned | 0…1 | - | - | H22 | Reference only |
| 327 | UL202-02 Sensor Fuel level | 2 / Signed | -150…32767 | 0.1 | mm | H15 | Reference only |
| 483 | UL202-02 Sensor Status | 1 / Unsigned | 0…255 | - | - | H15 | Reference only |
| 380 | Digital output 3 | 1 / Unsigned | 0…1 | - | - | H23 | Reference only |
| 381 | Ground Sense | 1 / Unsigned | 0…1 | - | - | H24 | Reference only |
| 387 | ISO6709 Coordinates | 34 / HEX | 0…0x7fffffffffffffff | - | - | H25 | Yes |
| 636 | UMTS/LTE Cell ID | 4 / Unsigned | 0…0xFFFFFFFF | - | - | H26 | Reference only |
| 403 | Driver Name | 35 / Unsigned | -…- | - | - | H27 | Reference only |
| 404 | Driver card license type | 1 / Unsigned | 0…8 | - | - | H27 | Reference only |
| 405 | Driver Gender | 1 / Unsigned | 0…2 | - | - | H27 | Reference only |
| 406 | Driver Card ID | 4 / Unsigned | 0…4294967295 | - | - | H27 | Reference only |
| 407 | Driver card expiration date | 1 / Unsigned | 0…9999 | - | - | H27 | Reference only |
| 408 | Driver Card place of issue | 4 / Unsigned | 0…65535 | - | - | H27 | Reference only |
| 409 | Driver Status Event | 1 / Unsigned | 0…2 | - | - | H27 | Reference only |
| 329 | AIN Speed | 2 / Unsigned | 0…65535 | - | - | H28 | Reference only |
| 500 | MSP500 vendor name | 40 / ASCII | 0…40 | - | - | H28 | Reference only |
| 501 | MSP500 vehicle number | 40 / ASCII | 0…40 | - | - | H28 | Reference only |
| 502 | MSP500 speed sensor | 1 / unsigned | 0…1 | - | - | H28 | Reference only |
| 637 | Wake Reason | 1 / Unsigned | 0…1 | - | - | H29 | Reference only |
| 10800 | EYE Temperature 1 | 2 / Signed | -32768…32767 | 0.01 | °C | H30 | Yes |
| 10801 | EYE Temperature 2 | 2 / Signed | -32768…32767 | 0.01 | °C | H30 | Yes |
| 10802 | EYE Temperature 3 | 2 / Signed | -32768…32767 | 0.01 | °C | H30 | Yes |
| 10803 | EYE Temperature 4 | 2 / Signed | -32768…32767 | 0.01 | °C | H30 | Yes |
| 10804 | EYE Humidity 1 | 1 / Unsigned | 0…100 | - | % | H30 | Yes |
| 10805 | EYE Humidity 2 | 1 / Unsigned | 0…100 | - | % | H30 | Yes |
| 10806 | EYE Humidity 3 | 1 / Unsigned | 0…100 | - | % | H30 | Yes |
| 10807 | EYE Humidity 4 | 1 / Unsigned | 0…100 | - | % | H30 | Yes |
| 10808 | EYE Magnet 1 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10809 | EYE Magnet 2 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10810 | EYE Magnet 3 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10811 | EYE Magnet 4 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10812 | EYE Movement 1 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10813 | EYE Movement 2 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10814 | EYE Movement 3 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10815 | EYE Movement 4 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10816 | EYE Pitch 1 | 1 / Signed | -90…90 | - | - | H30 | Yes |
| 10817 | EYE Pitch 2 | 1 / Signed | -90…90 | - | - | H30 | Yes |
| 10818 | EYE Pitch 3 | 1 / Signed | -90…90 | - | - | H30 | Yes |
| 10819 | EYE Pitch 4 | 1 / Signed | -90…90 | - | - | H30 | Yes |
| 10820 | EYE Low Battery 1 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10821 | EYE Low Battery 2 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10822 | EYE Low Battery 3 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10823 | EYE Low Battery 4 | 1 / Unsigned | 0…1 | - | - | H30 | Yes |
| 10824 | EYE Battery Voltage 1 | 2 / Unsigned | 0…65535 | - | - | H30 | Yes |
| 10825 | EYE Battery Voltage 2 | 2 / Unsigned | 0…65535 | - | - | H30 | Yes |
| 10826 | EYE Battery Voltage 3 | 2 / Unsigned | 0…65535 | - | - | H30 | Yes |
| 10827 | EYE Battery Voltage 4 | 2 / Unsigned | 0…65535 | - | - | H30 | Yes |
| 10832 | EYE Roll 1 | 2 / Signed | -180…180 | - | - | H30 | Yes |
| 10833 | EYE Roll 2 | 2 / Signed | -180…180 | - | - | H30 | Yes |
| 10834 | EYE Roll 3 | 2 / Signed | -180…180 | - | - | H30 | Yes |
| 10835 | EYE Roll 4 | 2 / Signed | -180…180 | - | - | H30 | Yes |
| 10836 | EYE Movement count 1 | 2 / Unsigned | 0…32767 | - | - | H30 | Yes |
| 10837 | EYE Movement count 2 | 2 / Unsigned | 0…32767 | - | - | H30 | Yes |
| 10838 | EYE Movement count 3 | 2 / Unsigned | 0…32767 | - | - | H30 | Yes |
| 10839 | EYE Movement count 4 | 2 / Unsigned | 0…32767 | - | - | H30 | Yes |
| 10840 | EYE Magnet count 1 | 2 / Unsigned | 0…65535 | - | - | H30 | Yes |
| 10841 | EYE Magnet count 2 | 2 / Unsigned | 0…65535 | - | - | H30 | Yes |
| 10842 | EYE Magnet count 3 | 2 / Unsigned | 0…65535 | - | - | H30 | Yes |
| 10843 | EYE Magnet count 4 | 2 / Unsigned | 0…65535 | - | - | H30 | Yes |
| 383 | AXL Calibration Status | 1 / Unsigned | 0…3 | - | - | H31 | Yes |
| 451 | BLE RFID #1 | 8 / HEX | 0…0xffffffffffffffff | - | - | H32 | Yes |
| 452 | BLE RFID #2 | 8 / HEX | 0…0xffffffffffffffff | - | - | H32 | Yes |
| 453 | BLE RFID #3 | 8 / HEX | 0…0xffffffffffffffff | - | - | H32 | Yes |
| 454 | BLE RFID #4 | 8 / HEX | 0…0xffffffffffffffff | - | - | H32 | Yes |
| 455 | BLE Button 1 state #1 | 1 / Unsigned | 0…1 | - | - | H32 | Yes |
| 456 | BLE Button 1 state #2 | 1 / Unsigned | 0…1 | - | - | H32 | Yes |
| 457 | BLE Button 1 state #3 | 1 / Unsigned | 0…1 | - | - | H32 | Yes |
| 458 | BLE Button 1 state #4 | 1 / Unsigned | 0…1 | - | - | H32 | Yes |
| 459 | BLE Button 2 state #1 | 1 / Unsigned | 0…1 | - | - | H32 | Yes |
| 460 | BLE Button 2 state #2 | 1 / Unsigned | 0…1 | - | - | H32 | Yes |
| 461 | BLE Button 2 state #3 | 1 / Unsigned | 0…1 | - | - | H32 | Yes |
| 462 | BLE Button 2 state #4 | 1 / Unsigned | 0…1 | - | - | H32 | Yes |
| 622 | Frequency DIN1 | 2 / Unsigned | 0…65535 | 0.1 | Hz | H32 | Yes |
| 623 | Frequency DIN2 | 2 / Unsigned | 0…65535 | 0.1 | Hz | H32 | Yes |
| 1148 | Connectivity quality | 4 / Unsigned | 0…4294967295 | - | - | H33 | Reference only |
| 1149 | Current LTE Band | 1 / Unsigned | 0…255 | - | - | H34 | Reference only |
| 13201 | PCB Temperature | 2 / Signed | -550…1150 | 0.1 | °C | H35 | Yes |

### Eventual I/O elements

| AVL | Manufacturer name | Bytes / type | Min…max | Multiplier | Unit | HW | Default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 155 | Geofence zone 01 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 156 | Geofence zone 02 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 157 | Geofence zone 03 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 158 | Geofence zone 04 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 159 | Geofence zone 05 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 61 | Geofence zone 06 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 62 | Geofence zone 07 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 63 | Geofence zone 08 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 64 | Geofence zone 09 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 65 | Geofence zone 10 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 70 | Geofence zone 11 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 88 | Geofence zone 12 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 91 | Geofence zone 13 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 92 | Geofence zone 14 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 93 | Geofence zone 15 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 94 | Geofence zone 16 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 95 | Geofence zone 17 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 96 | Geofence zone 18 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 97 | Geofence zone 19 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 98 | Geofence zone 20 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 99 | Geofence zone 21 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 153 | Geofence zone 22 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 154 | Geofence zone 23 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 190 | Geofence zone 24 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 191 | Geofence zone 25 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 192 | Geofence zone 26 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 193 | Geofence zone 27 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 194 | Geofence zone 28 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 195 | Geofence zone 29 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 196 | Geofence zone 30 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 197 | Geofence zone 31 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 198 | Geofence zone 32 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 208 | Geofence zone 33 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 209 | Geofence zone 34 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 216 | Geofence zone 35 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 217 | Geofence zone 36 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 218 | Geofence zone 37 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 219 | Geofence zone 38 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 220 | Geofence zone 39 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 221 | Geofence zone 40 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 222 | Geofence zone 41 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 223 | Geofence zone 42 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 224 | Geofence zone 43 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 225 | Geofence zone 44 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 226 | Geofence zone 45 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 227 | Geofence zone 46 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 228 | Geofence zone 47 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 229 | Geofence zone 48 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 230 | Geofence zone 49 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 231 | Geofence zone 50 | 1 / Unsigned | 0…3 | - | - | H02 | Yes |
| 175 | Auto Geofence | 1 / Unsigned | 0…1 | - | - | H02 | Yes |
| 250 | Trip | 1 / Unsigned | 0…1 | - | - | H01 | Yes |
| 255 | Over Speeding | 1 / Unsigned | 0…255 | - | km/h | H21 | Yes |
| 257 | Crash trace data | Variable / HEX | 0…1200 | - | - | H36 | Yes |
| 285 | Blood alcohol content | 2 / Unsigned | 0…9999 | - | - | H37 | Yes |
| 251 | Idling | 1 / Unsigned | 0…1 | - | - | H36 | Yes |
| 253 | Green driving type | 1 / Unsigned | 1…3 | - | - | H38 | Yes |
| 246 | Towing | 1 / Unsigned | 0…1 | - | - | H38 | Yes |
| 252 | Unplug | 1 / Unsigned | 0…1 | - | - | H39 | Yes |
| 247 | Crash detection | 1 / Unsigned | 1…6 | - | - | H36 | Yes |
| 248 | Immobilizer | 1 / Unsigned | 0…2 | - | - | H14 | Yes |
| 254 | Green Driving Value | 1 / Unsigned | 0…255 | acc and braking: 0.01 | G or rad | H38 | Yes |
| 249 | Jamming | 1 / Unsigned | 0…1 | - | - | H01 | Yes |
| 14 | ICCID2 | 8 / Unsigned | 0…0xFFFFFFFFFFFFFFFF | - | - | H02 | Yes |
| 243 | Green driving event duration | 2 / Unsigned | 0…65535 | - | ms | H36 | Yes |
| 236 | Alarm | 1 / Unsigned | 0…1 | - | - | H40 | Yes |
| 258 | EcoMaximum | 8 / Unsigned | 0…0xFFFFFFFFFFFFFFFF | - | - | H41 | Yes |
| 259 | EcoAverage | 8 / Unsigned | 0…0xFFFFFFFFFFFFFFFF | - | - | H41 | Yes |
| 260 | EcoDuration | 2 / Unsigned | 0…65535 | - | ms | H41 | Yes |
| 283 | Driving State | 1 / Unsigned | 0…3 | - | - | H41 | Yes |
| 284 | Driving Records | 2 / Unsigned | 0…65535 | - | - | H41 | Yes |
| 317 | Crash event counter | 1 / Unsigned | 0…255 | - | - | H16 | Yes |
| 318 | GNSS Jamming | 1 / Unsigned | 0…2 | - | - | H42 | Yes |
| 391 | Private mode | 1 / Unsigned | 0…255 | - | - | H05 | Yes |
| 449 | Ignition On Counter | 4 / Unsigned | 0…2147483647 | - | s | H05 | Yes |
| 1412 | Motorcycle Fall Detection | 1 / Unsigned | 0…0 | - | - | H29 | Yes |

### OBD elements

| AVL | Manufacturer name | Bytes / type | Min…max | Multiplier | Unit | HW | Default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 256 | VIN | 17 / ASCII | 0…0xff | - | - | H43 | Yes |
| 30 | Number of DTC | 1 / Unsigned | 0…255 | - | - | H43 | Yes |
| 31 | Engine Load | 1 / Unsigned | 0…100 | - | % | H43 | Yes |
| 32 | Coolant Temperature | 1 / Signed | -128…127 | - | °C | H43 | Yes |
| 33 | Short Fuel Trim | 1 / Signed | -100…99 | - | % | H43 | Yes |
| 34 | Fuel pressure | 2 / Unsigned | 0…765 | - | kPa | H43 | Yes |
| 35 | Intake MAP | 1 / Unsigned | 0…255 | - | kPa | H43 | Yes |
| 36 | Engine RPM | 2 / Unsigned | 0…16384 | - | rpm | H43 | Yes |
| 37 | Vehicle Speed | 1 / Unsigned | 0…255 | - | km/h | H43 | Yes |
| 38 | Timing Advance | 1 / Signed | -64…64 | - | ° | H43 | Yes |
| 39 | Intake Air Temperature | 1 / Signed | -128…127 | - | °C | H43 | Yes |
| 40 | MAF | 2 / Unsigned | 0…65535 | 0.01 | g/sec | H43 | Yes |
| 41 | Throttle Position | 1 / Unsigned | 0…100 | - | % | H43 | Yes |
| 42 | Runtime since engine start | 2 / Unsigned | 0…65535 | - | s | H43 | Yes |
| 43 | Distance Traveled MIL On | 2 / Unsigned | 0…65535 | - | km | H43 | Yes |
| 44 | Relative Fuel Rail Pressure | 2 / Unsigned | 0…5178 | 0.1 | kPa | H43 | Yes |
| 45 | Direct Fuel Rail Pressure | 2 / Unsigned | 0…65535 | 10 | kPa | H43 | Yes |
| 46 | Commanded EGR | 1 / Unsigned | 0…100 | - | % | H43 | Yes |
| 47 | EGR Error | 1 / Signed | -100…100 | - | % | H43 | Yes |
| 48 | Fuel Level | 1 / Unsigned | 0…100 | - | % | H43 | Yes |
| 49 | Distance Since Codes Clear | 2 / Unsigned | 0…65535 | - | km | H43 | Yes |
| 50 | Barometic Pressure | 1 / Unsigned | 0…255 | - | kPa | H43 | Yes |
| 51 | Control Module Voltage | 2 / Unsigned | 0…65535 | 0.001 | V | H43 | Yes |
| 52 | Absolute Load Value | 2 / Unsigned | 0…25700 | - | % | H43 | Yes |
| 759 | Fuel Type | 1 / Unsigned | 0…255 | - | - | H43 | Yes |
| 53 | Ambient Air Temperature | 1 / Signed | -128…127 | - | °C | H43 | Yes |
| 54 | Time Run With MIL On | 2 / Unsigned | 0…65535 | - | min | H43 | Yes |
| 55 | Time Since Codes Cleared | 2 / Unsigned | 0…65535 | - | min | H43 | Yes |
| 56 | Absolute Fuel Rail Pressure | 2 / Unsigned | 0…65535 | 10 | kPa | H43 | Yes |
| 57 | Hybrid battery pack life | 1 / Unsigned | 0…100 | - | % | H43 | Yes |
| 58 | Engine Oil Temperature | 1 / Unsigned | 0…215 | - | °C | H43 | Yes |
| 59 | Fuel injection timing | 2 / Signed | -21000…30200 | 0.01 | ° | H43 | Yes |
| 540 | Throttle position group | 1 / Unsigned | 0…100 | – | % | H44 | Yes |
| 541 | Commanded Equivalence R | 1 / Unsigned | 0…200 | 0.01 | - | H44 | Yes |
| 542 | Intake MAP 2 bytes | 2 / Unsigned | 0…2048 | - | kPa | H44 | Yes |
| 543 | Hybrid System Voltage | 2 / Unsigned | 0…1024 | - | V | H43 | Yes |
| 544 | Hybrid System Current | 2 / Signed | -3277…3277 | - | A | H43 | Yes |
| 281 | Fault Codes | variable / ASCII | 0…128 | - | - | H43 | Yes |
| 60 | Fuel Rate | 2 / Unsigned | 0…32767 | 0.01 | L/h | H43 | Yes |
| 1593 | Calc Remaining Distance | 2 / Unsigned | 0…65535 | 1 | Km | H45 | Yes |

### OBD OEM elements

| AVL | Manufacturer name | Bytes / type | Min…max | Multiplier | Unit | HW | Default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 389 | OBD OEM Total Mileage | 4 / Unsigned | 0…0xffffffff | - | km | H46 | Yes |
| 390 | OBD OEM Fuel Level | 4 / Unsigned | 0…0xffffffff | 0.1 | l | H46 | Yes |
| 402 | OEM Distance Until Service | 4 / Unsigned | 0…0xffffffff | - | km | H46 | Yes |
| 410 | OEM Battery charge state | 1 / Unsigned | 0…1 | - | - | H46 | Yes |
| 411 | OEM Battery charge level | 1 / Unsigned | 0…100 | - | % | H46 | Yes |
| 412 | OEM Battery power consumption | 2 / Unsigned | 0…65535 | - | kWh/100km | H47 | Yes |
| 755 | OEM Remaining distance | 2 / Unsigned | 0…65535 | - | km | H46 | Yes |
| 1151 | OEM Battery State Of Health | 2 / Unsigned | 0…100 | - | % | H46 | Yes |
| 1152 | OEM Battery Temperature | 2 / Signed | -32768…32767 | - | °C | H46 | Yes |
| 1443 | OEM Distance Since Refuel | 2 / Unsigned | 0…65535 | 1 | km | H46 | Yes |

### ELD

| AVL | Manufacturer name | Bytes / type | Min…max | Multiplier | Unit | HW | Default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1202 | ELD Ignition Switch Status | 1 / Unsigned | 0…255 | 1 | - | H46 | Yes |
| 1176 | ELD Mileage | 4 / Unsigned | 0…4294967295 | 1 | km | H46 | Yes |
| 1177 | ELD engine hours | 4 / Unsigned | 0…4294967295 | 1 | h | H46 | Yes |
| 1178 | ELD Ignition | 1 / Unsigned | 0…255 | 1 | - | H46 | Yes |
| 1179 | ELD parking brake status | 1 / Unsigned | 0…255 | 1 | - | H46 | Yes |
| 1180 | ELD Total Fuel Used | 4 / Unsigned | 0…4294967295 | 1 | l | H46 | Yes |
| 1181 | ELD engine idle hours | 4 / Unsigned | 0…4294967295 | 1 | h | H46 | Yes |
| 1182 | ELD DTC Count | 1 / Unsigned | 0…255 | 1 | - | H46 | Yes |
| 1183 | ELD Fuel Level 2 | 1 / Unsigned | 0…255 | 1 | % | H46 | Yes |
| 1184 | ELD Battery Voltage | 2 / Unsigned | 0…65535 | 1 | V | H46 | Yes |
| 1185 | ELD Total Idle Fuel Used | 4 / Unsigned | 0…4294967295 | 1 | l | H46 | Yes |
| 1186 | ELD Trip Distance | 4 / Unsigned | 0…4294967295 | 1 | km | H46 | Yes |
| 1187 | ELD Fuel Economy | 4 / Unsigned | 0…4294967295 | 1 | km/l | H46 | Yes |
| 1188 | ELD Ambient Air Temperature | 2 / Signed | -32768…32768 | 1 | °C | H46 | Yes |
| 1189 | ELD Engine Load | 2 / Unsigned | 0…65535 | 1 | % | H46 | Yes |
| 1190 | ELD Engine Throttle | 1 / Unsigned | 0…255 | 1 | % | H46 | Yes |
| 1191 | ELD Oil Temperature | 2 / Signed | -32768…32768 | 1 | °C | H46 | Yes |
| 1192 | ELD Trip Fuel Used | 4 / Unsigned | 0…4294967295 | 1 | l | H46 | Yes |
| 1193 | ELD Oil Pressure | 2 / Unsigned | 0…65535 | 1 | kPa | H46 | Yes |
| 1194 | ELD Seat Belt Status | 1 / Unsigned | 0…255 | 1 | - | H46 | Yes |
| 1195 | ELD Cruise Control Status | 1 / Unsigned | 0…255 | 1 | - | H46 | Yes |
| 1196 | ELD Throttle Pedal Position | 1 / Unsigned | 0…255 | 1 | - | H46 | Yes |
| 1197 | ELD Engine Coolant Level | 1 / Unsigned | 0…255 | 1 | % | H46 | Yes |
| 1198 | ELD Engine Coolant Pressure | 2 / Unsigned | 0…65535 | 1 | kPa | H46 | Yes |
| 1199 | ELD Transmission Oil Temperature | 2 / Signed | -32768…32768 | 1 | °C | H46 | Yes |
| 1200 | ELD Brake Application Pressure | 2 / Unsigned | 0…65535 | 1 | kPa | H46 | Yes |
| 1201 | ELD Brake Pedal Position | 1 / Unsigned | 0…255 | 1 | % | H46 | Yes |
| 1491 | ELD Engine Minutes | 4 / Unsigned | 0…4294967295 | 1 | min | H46 | Yes |

### OEM EV

| AVL | Manufacturer name | Bytes / type | Min…max | Multiplier | Unit | HW | Default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1378 | OEM HV Battery Min Cell Voltage | 2 / Unsigned | 0…65535 | 0.01 | V | H46 | Yes |
| 1379 | OEM HV Battery Max Cell Voltage | 2 / Unsigned | 0…65535 | 0.01 | V | H46 | Yes |
| 1380 | OEM HV Battery Current | 2 / Unsigned | 0…65535 | 0.1 | A | H46 | Yes |
| 1381 | OEM HV Battery Voltage | 2 / Unsigned | 0…65535 | 0.1 | V | H46 | Yes |
| 1382 | OEM HV Battery Max Energy | 2 / Unsigned | 0…65535 | 0.01 | kWh | H46 | Yes |
| 1383 | OEM HV Battery Measured Energy | 2 / Unsigned | 0…65535 | 0.01 | kWh | H46 | Yes |
| 1386 | OEM HV Battery Min Cell Temperature | 2 / Signed | -32768…32767 | 0.1 | °C | H46 | Yes |
| 1387 | OEM HV Battery Max Cell Temperature | 2 / Signed | -32768…32767 | 0.1 | °C | H46 | Yes |
| 1388 | OEM HV Battery Lifetime Power Use | 4 / Signed | -2147483648…2147483647 | - | kWh | H46 | Yes |
| 1389 | OEM HV Battery Lifetime Charge Power | 4 / Unsigned | 0…2147483648 | - | kWh | H46 | Yes |
| 1390 | OEM Fast Charge Count | 2 / Unsigned | 0…65535 | 0.1 | - | H46 | Yes |
| 1391 | OEM Slow Charge Count | 2 / Unsigned | 0…65535 | 0.1 | - | H46 | Yes |
| 1476 | OEM Remaining Oil Life | 1 / Unsigned | 0…100 | - | % | H46 | Yes |

### BLE Sensors I/O elements

| AVL | Manufacturer name | Bytes / type | Min…max | Multiplier | Unit | HW | Default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 385 | Beacon | Variable / HEX | 0…1024 | - | - | H48 | Yes |
| 548 | Advanced BLE Beacon data | 1024 / HEX | 0…1024 | - | - | H48 | Yes |
| 25 | BLE Temperature #1 | 2 / Signed | -4000…12500 | 0.01* | °C | H25 | Yes |
| 26 | BLE Temperature #2 | 2 / Signed | -4000…12500 | 0.01* | °C | H25 | Yes |
| 27 | BLE Temperature #3 | 2 / Signed | -4000…12500 | 0.01* | °C | H25 | Yes |
| 28 | BLE Temperature #4 | 2 / Signed | -4000…12500 | 0.01* | °C | H25 | Yes |
| 29 | BLE Battery #1 | 1 / Unsigned | 0…100 | - | % | H25 | Yes |
| 20 | BLE Battery #2 | 1 / Unsigned | 0…100 | - | % | H25 | Yes |
| 22 | BLE Battery #3 | 1 / Unsigned | 0…100 | - | % | H25 | Yes |
| 23 | BLE Battery #4 | 1 / Unsigned | 0…100 | - | % | H25 | Yes |
| 86 | BLE Humidity #1 | 2 / Unsigned | 0…1000 | 0.1* | %RH | H25 | Yes |
| 104 | BLE Humidity #2 | 2 / Unsigned | 0…1000 | 0.1* | %RH | H25 | Yes |
| 106 | BLE Humidity #3 | 2 / Unsigned | 0…1000 | 0.1* | %RH | H25 | Yes |
| 108 | BLE Humidity #4 | 2 / Unsigned | 0…1000 | 0.1* | %RH | H25 | Yes |
| 270 | BLE Fuel Level #1 | 2 / Unsigned | 0…65535 | - | - | H25 | Yes |
| 273 | BLE Fuel Level #2 | 2 / Unsigned | 0…65535 | - | - | H25 | Yes |
| 276 | BLE Fuel Level #3 | 2 / Unsigned | 0…65535 | - | - | H25 | Yes |
| 279 | BLE Fuel Level #4 | 2 / Unsigned | 0…65535 | - | - | H25 | Yes |
| 306 | BLE Fuel Frequency #1 | 4 / Unsigned | 0…2147483647 | - | - | H25 | Yes |
| 307 | BLE Fuel Frequency #2 | 4 / Unsigned | 0…2147483647 | - | - | H25 | Yes |
| 308 | BLE Fuel Frequency #3 | 4 / Unsigned | 0…2147483647 | - | - | H25 | Yes |
| 309 | BLE Fuel Frequency #4 | 4 / Unsigned | 0…2147483647 | - | - | H25 | Yes |
| 335 | BLE Luminosity #1 | 2 / Unsigned | 0…0xFFFF | - | lx | H25 | Yes |
| 336 | BLE Luminosity #2 | 2 / Unsigned | 0…0xFFFF | - | lx | H25 | Yes |
| 337 | BLE Luminosity #3 | 2 / Unsigned | 0…0xFFFF | - | lx | H25 | Yes |
| 338 | BLE Luminosity #4 | 2 / Unsigned | 0…0xFFFF | - | lx | H25 | Yes |
| 331 | BLE 1 Custom #1 | Variable / HEX | 0…- | - | - | H25 | Yes |
| 463 | BLE 1 Custom #2 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 464 | BLE 1 Custom #3 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 465 | BLE 1 Custom #4 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 466 | BLE 1 Custom #5 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 332 | BLE 2 Custom #1 | Variable / HEX | 0…- | - | - | H25 | Yes |
| 467 | BLE 2 Custom #2 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 468 | BLE 2 Custom #3 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 469 | BLE 2 Custom #4 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 470 | BLE 2 Custom #5 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 333 | BLE 3 Custom #1 | Variable / HEX | 0…- | - | - | H25 | Yes |
| 471 | BLE 3 Custom #2 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 472 | BLE 3 Custom #3 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 473 | BLE 3 Custom #4 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 474 | BLE 3 Custom #5 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 334 | BLE 4 Custom #1 | Variable / HEX | 0…- | - | - | H25 | Yes |
| 475 | BLE 4 Custom #2 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 476 | BLE 4 Custom #3 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 477 | BLE 4 Custom #4 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |
| 478 | BLE 4 Custom #5 | 4 / UNSIGNED LONG INT | 0…4294967295 | - | - | H25 | Yes |

## Interpretation details

| AVL | Detail / limitation |
| --- | --- |
| 239 | Boolean state: 0 = off; 1 = on. |
| 240 | Movement flag: 0 = stationary; 1 = moving. |
| 80 | 0/1 = home stopped/moving; 2/3 = roaming stopped/moving; 4/5 = unknown network stopped/moving. |
| 21 | Signal-strength code, normally 1–5; this is not a dBm measurement. |
| 200 | Sleep-state codes: 0 awake, 1 GPS sleep, 2 deep sleep, 3 online sleep, 4 ultra sleep. |
| 69 | GNSS codes: 0 off, 1 fix acquired, 2 searching without fix, 3 asleep. |
| 181 | Dilution-of-precision coefficient; smaller values indicate better geometry. |
| 182 | Horizontal dilution-of-precision coefficient. |
| 205 | Cell-tower identifier; not a physical measurement. |
| 206 | Cellular location-area identifier; changes between network areas. |
| 241 | Serving operator code (MCC/MNC). |
| 16 | The description specifies metres even though the unit cell is blank. |
| 12 | GPS-based cumulative fuel estimate; does not identify a CAN program. |
| 13 | GPS fuel estimate per distance (L/100km); this is not litres per hour or a CAN module ID. |
| 11 | Most-significant part of the SIM ICCID; preserve as identifier text. |
| 10 | SD-card presence flag: 0 absent; 1 present. |
| 72 | Dallas errors (wire values): 850/5000 not ready, 2000 read failure, 3000 disconnected, 4000 ID failure. These values are not temperatures. |
| 73 | Dallas errors (wire values): 850/5000 not ready, 2000 read failure, 3000 disconnected, 4000 ID failure. These values are not temperatures. |
| 74 | Dallas errors (wire values): 850/5000 not ready, 2000 read failure, 3000 disconnected, 4000 ID failure. These values are not temperatures. |
| 75 | Dallas errors (wire values): 850/5000 not ready, 2000 read failure, 3000 disconnected, 4000 ID failure. These values are not temperatures. |
| 201 | LLS fuel-level reading; scale/choice of counts versus litres depends on sensor configuration. RS232/RS485. |
| 202 | LLS fuel temperature via RS232/RS485. |
| 203 | LLS fuel-level reading; scale/choice of counts versus litres depends on sensor configuration. RS485. |
| 204 | LLS fuel temperature via RS485. |
| 210 | LLS fuel-level reading; scale/choice of counts versus litres depends on sensor configuration. RS485. |
| 211 | LLS fuel temperature via RS485. |
| 212 | LLS fuel-level reading; scale/choice of counts versus litres depends on sensor configuration. RS485. |
| 213 | LLS fuel temperature via RS485. |
| 214 | LLS fuel-level reading; scale/choice of counts versus litres depends on sensor configuration. RS485. |
| 215 | LLS fuel temperature via RS485. |
| 15 | Distance-based aggregate of driving-event occurrences; the table gives no physical unit. |
| 238 | Bluetooth NMEA receiver MAC address; handle as an identifier. |
| 237 | Network codes: 0 3G, 1 GSM, 2 4G, 3 LTE Cat M1, 4 LTE Cat NB1, 99 unknown. |
| 4 | Pulse count resets on record storage. |
| 5 | Pulse count resets on record storage. |
| 263 | Bluetooth codes: 0 disabled, 1 enabled without connection, 2 Bluetooth v3 only, 3 BLE only, 4 both. |
| 387 | Packed ISO6709 latitude/longitude/altitude; retain text, never chart as one scalar. |
| 403 | Card-derived driver name; dollar-sign separators are removed. |
| 404 | Licence categories: 0 absent; 1–4 B.1–B.4; 5–8 T.1–T.4. |
| 405 | Gender codes in the source: 0 unspecified, 1 male, 2 female. |
| 406 | The source repeats the gender description under Driver Card ID. Treat that description as an unresolved editorial error. |
| 408 | Card-derived place-of-issue data. |
| 409 | Card event: 0 registered, 1 deregistered, 2 swapping. |
| 500 | Integrator identity. |
| 501 | Vehicle registration/number; identifier, not a measurement. |
| 637 | Flag indicating an RTC-alarm wake-up. |
| 10816 | Angle identity is stated, but the table leaves its unit blank; do not invent a degree scale. |
| 10817 | Angle identity is stated, but the table leaves its unit blank; do not invent a degree scale. |
| 10818 | Angle identity is stated, but the table leaves its unit blank; do not invent a degree scale. |
| 10819 | Angle identity is stated, but the table leaves its unit blank; do not invent a degree scale. |
| 10824 | Battery-voltage identity is stated, but neither a unit nor a multiplier is provided; retain raw values. |
| 10825 | Battery-voltage identity is stated, but neither a unit nor a multiplier is provided; retain raw values. |
| 10826 | Battery-voltage identity is stated, but neither a unit nor a multiplier is provided; retain raw values. |
| 10827 | Battery-voltage identity is stated, but neither a unit nor a multiplier is provided; retain raw values. |
| 10832 | Angle identity is stated, but the table leaves its unit blank; do not invent a degree scale. |
| 10833 | Angle identity is stated, but the table leaves its unit blank; do not invent a degree scale. |
| 10834 | Angle identity is stated, but the table leaves its unit blank; do not invent a degree scale. |
| 10835 | Angle identity is stated, but the table leaves its unit blank; do not invent a degree scale. |
| 383 | Calibration code: 0 uncalibrated, 1 calibrated, 2 not configured, 3 fully calibrated. |
| 451 | NBL-T RFID identity for a connectionless slot. |
| 452 | NBL-T RFID identity for a connectionless slot. |
| 453 | NBL-T RFID identity for a connectionless slot. |
| 454 | NBL-T RFID identity for a connectionless slot. |
| 455 | NBL-T button state for a connectionless slot. |
| 456 | NBL-T button state for a connectionless slot. |
| 457 | NBL-T button state for a connectionless slot. |
| 458 | NBL-T button state for a connectionless slot. |
| 459 | NBL-T button state for a connectionless slot. |
| 460 | NBL-T button state for a connectionless slot. |
| 461 | NBL-T button state for a connectionless slot. |
| 462 | NBL-T button state for a connectionless slot. |
| 1148 | Packed cellular signal-quality data; LTE RSSI and eMTC/NB-IoT details require the linked signal reference. |
| 1149 | LTE band code: 0 means none, 1–85 identify bands. |
| 155 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 156 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 157 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 158 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 159 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 61 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 62 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 63 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 64 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 65 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 70 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 88 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 91 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 92 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 93 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 94 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 95 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 96 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 97 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 98 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 99 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 153 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 154 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 190 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 191 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 192 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 193 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 194 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 195 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 196 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 197 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 198 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 208 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 209 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 216 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 217 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 218 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 219 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 220 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 221 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 222 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 223 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 224 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 225 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 226 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 227 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 228 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 229 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 230 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 231 | Zone transition: 0 exit, 1 entry, 2 overspeed ended, 3 overspeed began. |
| 175 | Automatic-geofence transition: 0 exit; 1 entry. |
| 250 | Trip codes: 0 stop, 1 start. BT-app firmware 01.00.24+ also uses 2 business, 3 private, 4–9 custom. |
| 255 | Speed captured at the start/end of an overspeed event. |
| 257 | Encoded crash trace; retain as a composite value. |
| 285 | Packed alcohol reading: upper 14 bits carry per-mille ×1000; low 2 bits identify passive (0), active (1), or reserved (2–3) mode. |
| 251 | Idle flag: 0 moving; 1 idling. |
| 253 | Driving event: 1 acceleration; 2 braking; 3 cornering. |
| 246 | Tow flag: 0 stable; 1 towing. |
| 252 | External-power presence: 0 connected; 1 unplugged. |
| 247 | Crash code: 1 calibrated crash; 2 uncalibrated limited trace; 3 calibrated limited trace; 4 uncalibrated full trace; 5 calibrated full trace; 6 uncalibrated crash. |
| 248 | iButton status: 0 absent; 1 immobilizer connected; 2 authorized-driving connected. |
| 254 | Event/configuration dependent: acceleration/braking uses raw/100 g; GPS cornering uses raw/100 rad/s; accelerometer cornering uses raw/100 g. No unconditional scalar unit. |
| 249 | Jamming transition: 0 ended; 1 started. |
| 14 | Least-significant part of the SIM ICCID; preserve as identifier text. |
| 243 | Duration of the triggering driving event. |
| 236 | Alarm code: 0 reserved; 1 triggered. |
| 258 | Packed maximum acceleration: 2 zero bytes followed by signed 2-byte X/Y/Z values in mg. Not a single scalar. |
| 259 | Packed average acceleration: 2 zero bytes followed by signed 2-byte X/Y/Z values in mg. Not a single scalar. |
| 283 | Driving phase: 1 ignition on; 2 driving; 3 ignition off. |
| 284 | Number of records within an ignition cycle. |
| 317 | Counter used to associate a trace with a crash event. |
| 318 | GNSS interference state: 0 healthy/ended; 1 warning; 2 critical. |
| 391 | Privacy flag: 0 disabled; 1 enabled. |
| 449 | Accumulated time with ignition on, in seconds; the name says counter. |
| 1412 | Motorcycle fall event after configured conditions are satisfied. |
| 33 | Short-term fuel trim for bank 1. |
| 40 | Mass air flow: raw ×0.01 g/s. |
| 759 | 0=unavailable; 1=gasoline; 2=methanol; 3=ethanol; 4=diesel; 5=LPG; 6=CNG; 7=propane; 8=electric; 9=bifuel gasoline; 10=bifuel methanol; 11=bifuel ethanol; 12=bifuel LPG; 13=bifuel CNG; 14=bifuel propane; 15=bifuel electric; 16=bifuel electric/combustion; 17=hybrid gasoline; 18=hybrid ethanol; 19=hybrid diesel; 20=hybrid electric; 21=hybrid electric/combustion; 22=hybrid regenerative; 23=bifuel diesel. |
| 541 | Fuel/air commanded-equivalence ratio: raw ×0.01; dimensionless. |
| 281 | ASCII diagnostic codes separated by commas; Traccar emits space-separated dtcs. |
| 60 | Engine fuel-flow rate: raw ×0.01 L/h. |
| 1593 | Calculated remaining travel distance. |
| 389 | Vehicle-specific OEM PID for total distance; generic raw values are kilometres. |
| 390 | Vehicle-specific OEM PID for fuel volume; raw ×0.1 L. |
| 402 | Vehicle-specific distance remaining before service. |
| 755 | Remaining range until fuel or EV battery is exhausted. |
| 1181 | Cumulative engine time spent idling. |
| 1185 | Cumulative fuel consumed while idling. |
| 1188 |  Source maximum 32768 exceeds signed 16-bit capacity; do not use it as a validated bound. |
| 1189 | Absolute engine load based on intake-stroke air mass. |
| 1191 |  Source maximum 32768 exceeds signed 16-bit capacity; do not use it as a validated bound. |
| 1193 | Gauge pressure in the engine oil circuit. |
| 1197 | Coolant volume expressed as a percentage of cooling-system capacity. |
| 1199 |  Source maximum 32768 exceeds signed 16-bit capacity; do not use it as a validated bound. |
| 1390 | Source says count but lists multiplier 0.1; preserve raw count pending clarification. |
| 1391 | Source says count but lists multiplier 0.1; preserve raw count pending clarification. |
| 548 | Composite advanced-mode beacon identifiers and payloads; no scalar conversion. |
| 25 | Firmware 03.28.00+: wire errors 32767 missing, 32766 parse failure, 32765 sensor fault. Older firmware uses 3000/2000/4000 respectively; these overlap valid temperatures, so do not blanket-filter them. |
| 26 | Firmware 03.28.00+: wire errors 32767 missing, 32766 parse failure, 32765 sensor fault. Older firmware uses 3000/2000/4000 respectively; these overlap valid temperatures, so do not blanket-filter them. |
| 27 | Firmware 03.28.00+: wire errors 32767 missing, 32766 parse failure, 32765 sensor fault. Older firmware uses 3000/2000/4000 respectively; these overlap valid temperatures, so do not blanket-filter them. |
| 28 | Firmware 03.28.00+: wire errors 32767 missing, 32766 parse failure, 32765 sensor fault. Older firmware uses 3000/2000/4000 respectively; these overlap valid temperatures, so do not blanket-filter them. |
| 86 | Firmware 03.28.00+: wire errors 65535 missing, 65534 parse failure, 65533 sensor fault. |
| 104 | Firmware 03.28.00+: wire errors 65535 missing, 65534 parse failure, 65533 sensor fault. |
| 106 | Firmware 03.28.00+: wire errors 65535 missing, 65534 parse failure, 65533 sensor fault. |
| 108 | Firmware 03.28.00+: wire errors 65535 missing, 65534 parse failure, 65533 sensor fault. |

## Hardware-list key

Exact source tokens are retained, including family tokens such as FMBXXX. No target model was silently added to a hardware list.

- **H01**: FMBXXX FMB001 FMC001 FMB010 FMB002 FMB020 FMB003 FMB110 FMB120 FMB122 FMB125 FMB130 FMB140 FMB150 FMC150 FMM150 FMU125 FMB900 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100 FMP100 MSP500 FMC800 FMM800 FMM80A
- **H02**: FMBXXX FMB001 FMC001 FMB010 FMB002 FMB020 FMB003 FMB110 FMB120 FMB122 FMB125 FMU125 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100 FMP100 MSP500 FMC800 FMM800 FMM80A
- **H03**: FMBXXX FMB001 FMC001 FMB010 FMB120 FMB122 FMB125 FMB130 FMB140 FMB150 FMC150 FMM150 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100 FMC800 FMM800 FMM80A
- **H04**: FMBXXX FMB001 FMC001 FMB010 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100 FMB140 FMC800 FMM800 FMM80A
- **H05**: FMBXXX FMB001 FMC001 FMB010 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB962 FMB964 FMB202 FMB204 FMB206 MTB100
- **H06**: FMBXXX FMB001 FMB010 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB900 FMB920 FMB962 FMB964 FMB202 FMB204 FMB206 MTB100
- **H07**: FMBXXX FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB962 FMB964 FMB202 FMB204 FMB206 MTB100
- **H08**: FMBXXX FMB001 FMC001 FMB010 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB900 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100 FMC800 FMM800 FMM80A
- **H09**: FMBXXX FMB001 FMB010 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMB130 FMU130 FMC130 FMB900 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100
- **H10**: FMBXXX FMB900 FMB910 FMB920 FMC920 FMM920 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB150 FMC150 FMM150 FMB202 FMB204 FMB206 FMB640
- **H11**: FMBXXX FMB110 FMB120 FMB122 FMB140 FMB150 FMC150 FMM150 FMB202 FMB204 FMB206 FMB640
- **H12**: FMBXXX FMB110 FMB120 FMB122 FMB130 FMU130 FMC130 FMM130 FMB140
- **H13**: FMBXXX FMB110 FMB120 FMB122 FMB130 FMU130 FMC130 FMM130 FMB140 FMB150 FMC150 FMM150 FMB202 FMB204 FMB206
- **H14**: FMBXXX FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMB140 FMB150 FMC150 FMM150 FMU130 FMC130 FMM130 FMB202 FMB204 FMB206
- **H15**: FMB125 FMB125 FMU125 FMC125 FMM125
- **H16**: FMBXXX FMB001 FMC001 FMB010 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100 FMC800 FMM800 FMM80A
- **H17**: FMBXXX FMB001 FMC001 FMB010 FMB110 FMB120 FMB122 FMB125 FMB130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB202 FMB204 FMB206 FMT100 FMP100 FMC001 FMC125 FMC130 FMC920 FMM001 FMM125 FMM130 FMC800 FMM800 FMM80A FMC880 FMM880 FMM920 FMC250
- **H18**: FMBXXX FM3001 FMU125 FMU126 FMU130 FMC125 FMC130 FMC150 FMM125 FMM130 FMM150 FMC001 FMM001 FMC800 FMM800 FMC880 FMM880 FMM80A
- **H19**: FMBXXX FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130
- **H20**: FMBXXX FMB110 FMB120 FMB122 FMB130 FMU130 FMC130 FMM130
- **H21**: FMBXXX FMB001 FMB010 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100
- **H22**: FMBXXX FMB001 FMC001 FMB010 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100
- **H23**: FMBXXX FMB130 FMU130 FMC130 FMC150 FMM130
- **H24**: FMB130 FMU130 FMC130 FMM130 FMB140
- **H25**: FMBXXX FMB001 FMC001 FMB010 FMB002 FMB020 FMB003 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMB130 FMU130 FMC130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB910 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100 FMP100 FMB140 MSP500 FMC800 FMM800 FMM80A
- **H26**: FMBXXX FMU125 FMU126 FMU130 FMC001 FMC125 FMC130 FMM001 FMM125 FMM130 FMC150 FMM150 FMC800 FMM800 FMM80A
- **H27**: FMBXXX FMU126
- **H28**: MSP500
- **H29**: FMB965
- **H30**: FMBXXX [Expand] FMB001 FMB010 FMB100 FMB110 FMB120 FMB122 FMB125 FMB130 FMB900 FMB920 FMB962 FMB964 FM3001 FM3010 FMB202 FMB204 FMB206 FMB207 FMT100 MTB100 TMT250 GH5200 FMB140 FMB020 FMB002 FMB003 FMU120 FMU122 FMU125 FMU126 FMU130 FMC120 FMC122 FMC125 FMC130 FMM125 FMM130 FMC001 FMM001 TFT100 FMB910
- **H31**: FMBXXX [Expand] FMB001 FMB010 FMB100 FMB110 FMB120 FMB122 FMB125 FMB130 FMB900 FMB920 FMB962 FMB964 FMB202 FMB204 FMB206 FMB207 FMB208 FMB209 FMT100 MTB100 FMB140 FMB020 FMB002 FMB003 FMU120 FMU122 FMU125 FMU126 FMU130 FMC120 FMC122 FMC125 FMC130 FMM125 FMM130 FMC001 FMM001 FMB910 FMC800 FMM800 FMC880 FMM880 FMM80A
- **H32**: FMBXXX [Expand] FMB001 FMB010 FMB100 FMB110 FMB120 FMB122 FMB125 FMB130 FMB900 FMB920 FMB962 FMB964 FM3001 FM3010 FMB202 FMB204 FMB206 FMB207 FMB208 FMB209 FMT100 MTB100 TMT250 GH5200 FMB140 FMB020 FMB002 FMB003 FMU120 FMU122 FMU125 FMU126 FMU130 FMC120 FMC122 FMC125 FMC130 FMM125 FMM130 FMC001 FMM001 TFT100 FMB910 FMP100 FMP1M1 MSP500 FMC800 FMM800 FMC880 FMM880 FMM80A FMB150 FMC150 FMM150
- **H33**: FMBXXX [Expand] FMM130 FMM230 FMM920
- **H34**: FMBXXX [Expand] FMM130 FMM230 FMM920 FMM130 FMM125 FMC130
- **H35**: FMBXXX [Expand] FMB900 FMB910 FMB920 FMC920 FMM920 FMP100 FMB010 FMB020 FMC800 FMM800 FMT100 FMC880 FMM880 FMB110 FMB120 FMB125 FMB130 FMC130 FMM130 FMB202 FMB204 FMB230 FMC225 FMC230 FMC234 FMM230 FMB001 FMB003 FMC003 FMM003 FMM00A FMB140 FMB150 FMC150 FMM150 FMC250 FMM250
- **H36**: FMBXXX [Expand] FMB001 FMC001 FMB010 FMB110 FMB120 FMB122 FMB125 FMB130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB202 FMB204 FMB206 FMT100 FMP100 FMC001 FMC125 FMC130 FMC920 FMM001 FMM125 FMM130 FMC800 FMM800 FMM80A FMC880 FMM880 FMM920 FMC250
- **H37**: FMB125
- **H38**: FMBXXX FMB001 FMB010 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100 FMC800 FMM800 FMM80A
- **H39**: FMBXXX FMB001 FMC001 FMM001 FMB002 FMB003 FMB010 FMB020 FMB120 FMB122 FMB125 FMB130 FMB140 FMB910 FMB920 FMB962 FMB964 FMB202 FMB204 FMB208 FMB209 FMC125 FMM125 FMU125 FMU126 FMC130 FMM130 FMU130 MSP500 FMT100 FMP100 FMC800 FMM800 FMM80A FMC920 FMM920
- **H40**: 
- **H41**: FMT100
- **H42**: FMBXXX FMB001 FMC001 FMB010 FMB110 FMB120 FMB122 FMB125 FMB130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB202 FMB204 FMB206 FMT100 FMP100 FMC001 FMC125 FMC130 FMC920 FMM001 FMM125 FMM130 FMC800 FMM800 FMM80A FMC880 FMM880 FMM920 FMC250 </span
- **H43**: FMBXXX FMB001 FMC001 FMB010 FMB003 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMM125 FMB130 FMU130 FMC130 FMM130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB962 FMB964 FM3001 FMT100 MTB100 FMB202 FMB204 FMB206 FMT100 MTB100 FMB140
- **H44**: FMBXXX FMB001 FMB003 FMC003 FMC00A FMM003 FMM00A
- **H45**: FMBXXX FMB001 FMM003 FMC003 FMB003 FMM00A
- **H46**: FMB001 FMC001 FMM001 FMB003 FMC003 FMM003
- **H47**: FMBXXX FMB003 FMC003 FMM003 FMB001 FMC001 FMM001
- **H48**: FMBXXX FMB001 FMC001 FMB010 FMB002 FMB020 FMB003 FMB110 FMB120 FMB122 FMB125 FMU125 FMC125 FMB130 FMU130 FMC130 FMB140 FMB150 FMC150 FMM150 FMB900 FMB920 FMB910 FMB962 FMB964 FM3001 FMB202 FMB204 FMB206 FMT100 MTB100 FMP100 FMB140 FMC800 FMM800 FMM80A

## Decoder and upgrade boundaries

Aliases are grounded in the pinned decoder, not inferred from similar spelling. A decoded key with multiple possible input IDs records sourceAvlIds instead of claiming a unique AVL ID. AVL 24 updates position speed (knots) inside Traccar; the app handles that position property separately. It is not emitted as a decoded io24 attribute. This decoder moves cid2g/cid4g/lac into the network object, so they are not promised as position attributes.

Raw and decoded alternatives use statusCardAliases to share an existing status selection while preserving their individual conversions. The RPM selection accepts both io36 and rpm; source units are never copied across keys.

Schema 16 uses the [schema-15 baseline](../device-profile-migrations/teltonika-v15.json) to add missing definitions and correct only unchanged defaults. User labels, conversions, additional fields and vehicle assignments are preserved. Existing revision snapshots retain their recorded historical definitions; neither Traccar history nor old profile snapshots are rewritten by this update.

## Reuse with other trackers and brands

This is a Teltonika **FMX003 family dictionary**, not a universal AVL-ID table. Hardware lists provide research leads for other models; verify the exact model, firmware and decoder path before promoting a borrowed mapping. Different Teltonika models can reuse IDs or apply different formats. A model override can replace or omit a family entry. A separate family dictionary is preferable when meanings differ substantially.

Other brands should have separate manufacturer/protocol dictionaries. Match on manufacturer, protocol/family, exact model and received representation, with firmware/configuration constraints where needed. A bare numeric ID is never a global identity. Keep source evidence and uncertain entries separate from reviewed mappings; preserve self-contained profile export and saved user edits.

The reference can support future work without more manual data entry: field-name/unit suggestions, review of emailed support captures, detection of scale/sign/sentinel mistakes, decoder-version comparisons, and choosing useful status fields from the observed vehicle inventory. DTC, EV battery and service fields could support reports/alerts after vehicle availability is demonstrated. These are reuse opportunities, not additional features implemented in this update.

## Maintaining the reference

Compare all seven tables on both official pages, retain factual cells and meaningful links, and review state codes, sentinel values, conditional formats and source inconsistencies. Check a pinned Traccar decoder before changing received units. Update the scoped mapping dictionary and regenerate the portable profiles. Add representative translation and migration tests; never raise confidence by suppressing a real representation conflict.

## Validation for this update

- All 144 repository tests pass, including raw/decoded scale comparisons, negative signed values, sensor sentinels, identifier preservation, generated-profile consistency, and preservation of saved custom edits.
- The production build succeeds. Its main bundle is approximately 1.22 MB before gzip / 275 KB compressed and still triggers Vite’s chunk-size advisory; no bundle optimization is part of this mapping review.
- Changed translation/generator code passes lint with zero errors; the legacy migration destructuring still produces existing unused-variable warnings.
- The signed-in development browser loaded and synchronized both current shared profiles with 348 fields each. The existing FMM00A io31 guess was separately reviewed and updated to sourced Engine Load (%) through the editor; other custom mappings were retained.
- Historical graphs remain tied to saved profile revisions. Current-profile improvements do not imply that all 348 fields have been physically observed or validated against an ECU; unsigned/signed and scaling cases use representative synthetic inputs where no matching live example is available.

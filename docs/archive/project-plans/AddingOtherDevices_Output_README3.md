> **Archived snapshot (2026-10-18).** Earlier session copy; see archive README for provenance and duplicate handling.
>
> This file records the original project discussion and its status at that time. Verify claims and commands against the current code and documentation before reusing them.

# Experimental profiles: FMC003 and GV300

These full JSON files are starting definitions for Traccar React schemaVersion 13. They use new IDs and are not replacements for FMM003, FMM00A, FMB003, or saved user mappings. Counts: FMC003 79 keys; GV300 30 keys. `field-ledger.csv` covers every entry, including scope, manufacturer ID or report field, type, illustrative wire/Traccar value, unit, multiplier, sentinel, classification, display and evidence gap. The examples are **not measured device samples**.

## Sources and scope

- [FMC003 AVL catalog](https://wiki.teltonika-gps.com/view/FMC003_Teltonika_Data_Sending_Parameters_ID) (page says firmware FMB.Ver.03.29.00+), [FMC003 OEM firmware minimum and example IDs](https://wiki.teltonika-gps.com/view/OEM_Parameters), [Traccar Teltonika decoder](https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java). Vehicle support, enabled I/O, model string, and Codec 8/8E record determine actual output. Manufacturer guidance for [FMC003 AVL 389](https://community.teltonika.lt/t/reset-odometer-fmc003/17477) confirms the device can report it when enabled on a supported vehicle.
- [Queclink-authored GV300 @Track protocol TRACGV300AN002](https://www.controlsatperu.com/Manuales/GV300%202/SMS%20comandos%20GV300%20quecklink.pdf), [GV300 hardware input specification](https://www.queclink.com/wp-content/uploads/2020/08/GV300-GV300W-20200527.pdf), and [Traccar GL200 text decoder](https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/Gl200TextProtocolDecoder.java). This profile is for GV300 with the documented ASCII report layout; it does not silently cover GV300W/VC or binary variants. `power`, mileage, hours, `adc1`, and `adc2` are conditional on reporting configuration.

## Important decoder distinctions

The Teltonika decoder has an **FMB003-only** AVL 389 handler converting km to metres under `obdOdometer`. It does not take that branch for FMC003: its fallback leaves AVL 389 as `io389` in **km**. This definition maps that raw Traccar key with a canonical multiplier of 1000 metres per km, preserving the raw km value. The catalog's OEM fuel-level AVL 390 has conflicting scope (one hardware-support listing names only FMB003, while a general OEM document shows 390 for the FMC003 family). It is intentionally omitted until a packet and decoded position confirm it. `io1593` is similarly held out. An FMC003 `cid2g`/`lac` pair is normally removed by the Traccar network builder, so they are not profile attributes. Identifier-like `io256`, `vin`, `iccid`, and `driverUniqueId` have labels only.

For GV300, manufacturer GTFRI mileage is in km but Traccar emits `odometer` in metres. The hour-meter text is parsed into milliseconds. `adc1`/`adc2` are decoded volts, while `fuel1`/`fuel2` are alternate configured readings from an `F` prefix with no established physical unit. GTINF `rssi=99` means unavailable. The `input`/`output` values are bitmasks; their decoded boolean keys do not establish what any accessory is wired to. These are separate status and identifier labels, not graph measurements. The accelerometer can trigger movement and harsh behavior, but no measured three-axis g-force values are evidenced in the ordinary GV300 position report.

GPS latitude, longitude, altitude, speed, course, time, validity, and accuracy are **top-level position fields**. IMEI is generally `device.uniqueId`. The attributeMap only labels `position.attributes`. Graph auto-scaling must remain display-only.

## Deferred third candidate

[Ruptela Plug5](https://ruptela.com/product/plug5/) supports OBD/CAN and behavior monitoring, but the public [Device Center manual](https://doc.ruptela.com/resources/Storage/tracking-devices-publication/PDF/Device%20Center%20User%20Manual.pdf) says the exact enabled IO list is in its configuration. A public Plug5 IO-ID-to-Traccar-key crosswalk, the current decoder file, and an actual configuration/sample were not available from the sources checked. A broad JSON now would be mostly speculative. Build it when those records are available.

## Migration and review

Import under the distinct new IDs. Never overwrite a saved user's labels or conversions; merge only missing keys after comparing maps. Before adopting a profile, collect the exact model string, firmware, enabled I/O list, Traccar version, one raw packet for each report type, and corresponding `tc_positions.attributes`. Verify OEM 389 and 390 on the particular vehicle. The source's translator keeps `rawValue`, but numeric-looking identifier strings can still be coerced in the *display value* path; fix that path before relying on leading zero display.

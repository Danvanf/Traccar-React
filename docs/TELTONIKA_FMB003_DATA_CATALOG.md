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

## CSV headers

The export dialog offers both forms:

- **Human-readable labels**: for example `Mass Air Flow (g/s) [attr_io40]`.
- **Teltonika attribute IDs**: for example `io40`.

The raw-ID form is the safest interchange/backup format. The human form is
intended for spreadsheets and graphing while retaining the source key in
brackets so it can still be traced back to the device packet.


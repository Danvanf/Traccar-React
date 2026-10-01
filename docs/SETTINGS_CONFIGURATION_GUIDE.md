# Settings Configuration Guide

This guide explains each section of the Settings modal and maps it to the current screenshots.

## Screenshots Used

- [Settings panel 1](screenshots/07-Settings1.png)
- [Settings panel 2](screenshots/08-Settings2.png)
- [Settings panel 3](screenshots/09-Settings3.png)
- [Telemetry view](screenshots/06-telemetry.png)

## 1. General

Shown in [Settings panel 1](screenshots/07-Settings1.png).

Use this section to set connection and runtime behavior:

- API base URL
- Vehicle API base URL
- Traccar login credentials
- polling interval
- realtime lookback window
- movement threshold
- theme
- device catalog source mode

## 2. Vehicle Catalog

Shown in [Settings panel 1](screenshots/07-Settings1.png).

Use this section to create or edit app-owned vehicles and assign key metadata:

- display name, VIN, year, make, model
- notes
- protocol profile
- associated Traccar device
- effective assignment time

## 3. Speed Bands

Shown in [Settings panel 1](screenshots/07-Settings1.png).

Use this section to configure per-vehicle speed color ranges for map and trip visualization.

- add/remove bands
- adjust upper limits
- choose colors
- copy from another vehicle

## 4. Device Bindings

Shown in [Settings panel 2](screenshots/08-Settings2.png).

Use this section to verify and maintain the active trip-ownership mapping between Traccar devices and app vehicles.

- review active assignments
- filter by selected device
- refresh binding state

## 5. Named Places

Shown in [Settings panel 2](screenshots/08-Settings2.png).

Use this section to define reusable place markers for trip start/end labeling.

- global or vehicle-specific scope
- latitude/longitude/radius
- notes
- optional map picker for centerpoint

## 6. Trip Tags

Shown in [Settings panel 2](screenshots/08-Settings2.png).

Use this section to manage classification tags for trips.

- global or vehicle-scoped tags
- tag color and naming

## 7. Device Protocol Profile Editor

Shown in [Settings panel 3](screenshots/09-Settings3.png).

Use this section to map/normalize telemetry attributes and profile behavior per device/vehicle context.

## 8. Bouncie REST Import

Shown in [Settings panel 3](screenshots/09-Settings3.png).

Use this section to configure Bouncie OAuth/import settings and run controlled historical imports.

- client settings
- connect/disconnect/restore
- date-windowed import
- import status and coverage feedback

## 9. Telemetry Viewer Context

Telemetry display example is shown in [Telemetry view](screenshots/06-telemetry.png).

This complements settings by validating that profile mappings and selected telemetry fields are rendering as expected.

## Recommended Operator Flow

1. Configure General connectivity and credentials.
2. Build Vehicle Catalog entries.
3. Confirm Device Bindings.
4. Set Speed Bands and Named Places.
5. Define Trip Tags.
6. Tune protocol profile mappings.
7. Configure and run Bouncie imports if needed.
8. Validate output in telemetry and trip views.

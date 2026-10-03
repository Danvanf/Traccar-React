# Settings Configuration Guide

This guide explains each section of the Settings modal, what each setting controls, and what to tune first in production.

## Screenshots Used

- [Settings panel 1](screenshots/07-Settings1.png)
- [Settings panel 2](screenshots/08-Settings2.png)
- [Settings panel 3](screenshots/09-Settings3.png)
- [Telemetry view](screenshots/06-telemetry.png)

## Before You Start

For a reverse-proxy deployment, these two values must be correct before most features work:

- `API Base URL`: Traccar API path (commonly `/api` when proxied).
- `Vehicle API Base URL`: VehicleApp API path (commonly `/vehicle-api` when proxied).

If either URL is wrong, symptoms can include empty device lists, missing history, or JSON parse errors.

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

Field details:

- `API Base URL`:
	- Purpose: base path used for Traccar calls like `/devices` and position history.
	- Typical value: `/api` (when Apache/Nginx maps `/api/` to Traccar).
	- Alternate value: `http://<host>:8082/api` if not using reverse-proxy path mapping.

- `Vehicle API Base URL`:
	- Purpose: base path for app-owned endpoints (`/api/trips/...`, bindings, places, tags, Bouncie).
	- Typical value: `/vehicle-api` (when reverse proxy maps it to port 5124).
	- Alternate value: `http://<host>:5124` when directly exposing VehicleApp API.

- `Username (email)` and `Password`:
	- Purpose: Traccar credentials used for Traccar API access from the frontend session.
	- Notes: keep credentials least-privilege where possible.

- `Poll Interval (ms)`:
	- Purpose: how often realtime mode requests fresh position data.
	- Lower values update faster but increase API and browser load.
	- Typical starting value: `5000` ms (5 seconds).
	- Suggested range:
		- small deployment: `3000-5000`
		- larger deployment / lower churn: `5000-15000`

- `Realtime Hours`:
	- Purpose: size of the realtime map window (how many past hours remain visible in live mode).
	- Example: `3` means points older than 3 hours are not shown in realtime mode.
	- Higher values show more trail context but increase rendering load.

- `Movement Threshold (m)`:
	- Purpose: minimum movement distance used in trip derivation logic to suppress jitter/noise.
	- Lower values create more short trips from small movements/GPS drift.
	- Higher values reduce false starts but may merge or skip very short trips.
	- Typical starting value: `20` meters.
	- Tuning guidance:
		- many tiny stop/start trips: increase threshold.
		- missing short real trips: decrease threshold.

- `Theme`:
	- Purpose: UI appearance (`Auto`, `Light`, `Dark`).

- `Device Source`:
	- `Traccar /devices (default)`: reads active device list directly from Traccar.
	- `Vehicle API /api/vehicles`: reads from app catalog/binding model.
	- Use backend mode when you want catalog-driven visibility instead of raw Traccar device inventory.

## 2. Vehicle Catalog

Shown in [Settings panel 1](screenshots/07-Settings1.png).

Use this section to create or edit app-owned vehicles and assign key metadata:

- display name, VIN, year, make, model
- notes
- protocol profile
- associated Traccar device
- effective assignment time

Notes:

- Display fields (`name`, `VIN`, `year`, `make`, `model`) are straightforward identity metadata.
- `Traccar Device` + `Effective From` determine trip ownership mapping over time.
- If ownership changed historically, set effective times carefully to avoid overlap conflicts.
- `Protocol Profile` controls how telemetry attributes are interpreted and labeled.

## 3. Speed Bands

Shown in [Settings panel 1](screenshots/07-Settings1.png).

Use this section to configure per-vehicle speed color ranges for map and trip visualization.

- add/remove bands
- adjust upper limits
- choose colors
- copy from another vehicle

Operational meaning:

- Bands define map/graph color buckets by speed range.
- They affect visualization only, not saved trip distance/duration math.
- Keep ranges monotonic and meaningful for your fleet (city vs highway behavior).

## 4. Device Bindings

Shown in [Settings panel 2](screenshots/08-Settings2.png).

Use this section to verify and maintain the active trip-ownership mapping between Traccar devices and app vehicles.

- review active assignments
- filter by selected device
- refresh binding state

Operational meaning:

- Bindings map Traccar device IDs to app vehicles over time.
- Import and trip ownership logic relies on these bindings.
- Conflicting or overlapping bindings can block imports (409 conflicts) by design.

## 5. Named Places

Shown in [Settings panel 2](screenshots/08-Settings2.png).

Use this section to define reusable place markers for trip start/end labeling.

- global or vehicle-specific scope
- latitude/longitude/radius
- notes
- optional map picker for centerpoint

Operational meaning:

- Used to auto-label trip start/end context (home/work/site, etc.).
- Radius is in meters; tighter radii reduce false matches.
- Global places apply to all vehicles; scoped places only apply to one vehicle.

## 6. Trip Tags

Shown in [Settings panel 2](screenshots/08-Settings2.png).

Use this section to manage classification tags for trips.

- global or vehicle-scoped tags
- tag color and naming

Operational meaning:

- Tags provide reusable trip classification (commute, service, personal, etc.).
- Keep names consistent to support reporting and filtering.

## 7. Device Protocol Profile Editor

Shown in [Settings panel 3](screenshots/09-Settings3.png).

Use this section to map/normalize telemetry attributes and profile behavior per device/vehicle context.

Operational meaning:

- Profiles translate raw protocol fields into normalized labels/units used in UI.
- Conversions (`kmhToMph`, `cToF`, `millivoltsToVolts`, etc.) should match source units exactly.
- Incorrect mapping can make telemetry appear missing or misleading while raw data still exists.

## 8. Bouncie REST Import

Shown in [Settings panel 3](screenshots/09-Settings3.png).

Use this section to configure Bouncie OAuth/import settings and run controlled historical imports.

- client settings
- connect/disconnect/restore
- date-windowed import
- import status and coverage feedback

Field guidance:

- `OAuth Client ID`, `Client Secret`, `Redirect URL` must match your Bouncie app registration.
- Redirect URL must match deployed host/protocol exactly in production.
- Imports are intentionally windowed/rate-limited for provider safety.
- Coverage output shows completed windows so reruns can continue safely.

## 9. Telemetry Viewer Context

Telemetry display example is shown in [Telemetry view](screenshots/06-telemetry.png).

This complements settings by validating that profile mappings and selected telemetry fields are rendering as expected.

Practical check:

- After profile or field changes, verify that speed/RPM/temp/fuel values look plausible for a known drive.

## Recommended Operator Flow

1. Configure General connectivity and credentials.
2. Build Vehicle Catalog entries.
3. Confirm Device Bindings.
4. Set Speed Bands and Named Places.
5. Define Trip Tags.
6. Tune protocol profile mappings.
7. Configure and run Bouncie imports if needed.
8. Validate output in telemetry and trip views.

## Quick Troubleshooting Map

- Empty device list:
	- Check `API Base URL` and Traccar credentials.
	- Confirm reverse proxy routes `/api/` correctly.

- History only shows recent range:
	- Expand older months/years in History navigator.
	- Confirm backend history span endpoint responds.

- Import conflict (409):
	- Usually overlapping trip identity/binding windows.
	- Verify Device Bindings effective dates and rerun without changing historical boundaries.

- Settings appear to reset:
	- Some fields are browser-local; others are backend persisted.
	- Verify you are signed into the expected VehicleApp environment.

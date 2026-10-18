> **Archived snapshot (2026-10-18).** Historical test-vector notes. Current automated tests and profile JSON are authoritative.
>
> This file records the original project discussion and its status at that time. Verify claims and commands against the current code and documentation before reusing them.

# Focused test vectors (illustrative decoded attributes)

Run against the supplied `carProfiles.js` implementation and the imported schemaVersion 13 definitions. The `rawValue` column must remain exactly the Traccar attribute supplied; graph auto-scaling cannot modify it.

| Profile/key | Traccar raw input | Metric display | Imperial display | Additional check |
| --- | --- | --- | --- | --- |
| FMC003 `io389` | `120000` km | `120000 km` | about `74564.52 mi` | `canonicalValue=120000000` metres; **not** `obdOdometer` on FMC003 |
| FMC003 `io1152` | `24` °C | `24 °C` | `75.2 °F` | raw stays 24 |
| FMC003 `io755` | `320` km | `320 km` | about `198.84 mi` | canonical metres 320000 |
| FMC003 `io410` | `0` | `0` | `0` | a status code, no physical unit; 0 is not missing |
| GV300 `power` | `12` decoded V (wire `12000`) | `12 V` | `12 V` | do not apply wire multiplier again |
| GV300 `odometer` | `2000000` decoded m (wire `2000.0` km) | `2000 km` | about `1242.74 mi` | raw stays 2000000 |
| GV300 `hours` | `44442754000` decoded ms (wire `12345:12:34`) | same ms | same ms | engine-on source only if hour meter enabled |
| GV300 `rssi` | `99` | unavailable | unavailable | status `sentinel`; raw remains 99 |
| GV300 `ignition` | `false` | false | false | boolean is not coerced to 0 |
| GV300 `iccid` | `00123456789012345678` | string | string | `rawValue` retains zeros; current renderer may need an identifier fix |
| GV300 `fuel1` | `50` | `50` | `50` | no percent, litre, or gallon assigned |

Migration: both new definitions must pass `getAttributeMapValidationIssues` with no issues; `migrateProfileDefinition` must return the schema 13 definition unchanged. Applying either definition must not modify an existing FMM003, FMM00A, FMB003, GV500, GL300, Oyster3, or user-edited mapping. For a merge, keys already present in the saved map win. Missing inputs must remain missing; do not manufacture zero or false. No live packet/replay test was possible without the devices.

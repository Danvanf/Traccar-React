# Bundled device profiles

This folder contains the JSON profile definitions bundled into the React app. Add one JSON file per device protocol/profile; the build discovers every `*.json` file here, so adding a definition does not require editing application code.

Before every production build, npm prints a reminder to export the current FMM003 profile from the app and compare it with the bundled JSON. The reminder does not stop the build.

## Currently bundled options

The current FMM003 profile remains the existing default definition. Additional optional definitions are bundled for Teltonika FMB120, FMC003, FMC130, and Queclink GV300 and GV55. These profiles are marked experimental and are available for manual assignment in Vehicle Catalog; bundling them does not assign them to any vehicle. Their definitions pass the app schema and mapping validation, but their model-specific Traccar output and measurements have not been confirmed with live devices. Check the Traccar attributes and values for a device before relying on its profile. An FMM00A profile can be added when its Traccar output and a suitable definition are available.

## Add a profile

1. Copy an existing profile JSON and rename the copy to a descriptive filename, such as `teltonika-fmm003.json`.
2. Give it a unique, stable `id` (lowercase letters, digits, and hyphens), a user-facing `name`, the current `schemaVersion`, and an `attributeMap` object keyed by the Traccar attribute names (for example, `io50`).
3. Keep each mapping's label, source unit, conversion, canonical unit/scale, and quantity in the JSON. Only include a conversion when its source representation is understood. Unknown device values can be labeled by key and left without a guessed conversion.
4. Run the profile tests and production build, then assign the profile to the appropriate vehicle in Vehicle Catalog. A bundled profile is available to select; it does not automatically assign itself to a vehicle.
5. Include the JSON file in the release source before building. Existing browser and shared profile stores receive newly bundled definitions only when that ID is not already present, so a user's edited or synchronized profile is preserved.

Example shape:

```json
{
  "id": "vendor-model",
  "name": "Vendor Model",
  "schemaVersion": 14,
  "attributeMap": {
    "io123": {
      "label": "Example sensor",
      "avlId": 123,
      "units": "kPa",
      "sourceUnit": "kPa",
      "canonicalUnit": "kPa",
      "canonicalScale": 1,
      "quantity": "pressure"
    }
  }
}
```

The app still needs a supported conversion implementation when a mapping names a legacy `conversion`. Adding new conversion code is a developer change; prefer canonical unit metadata and existing supported conversions. Do not reuse a profile ID for a materially different device/configuration, because saved vehicle assignments and user edits are keyed by that ID.

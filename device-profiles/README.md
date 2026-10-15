# Bundled device profiles

This folder contains the JSON profile definitions bundled into the React app. Add one JSON file per device protocol/profile; the build discovers every `*.json` file here, so adding a definition does not require editing application code.

Before every production build, npm prints a reminder to export the current FMM003 profile from the app and compare it with the bundled JSON. The reminder does not stop the build.

## Currently bundled options

The current FMM003 profile remains the existing default definition. An initial Teltonika FMM00A profile is now bundled alongside the optional Teltonika FMB120, FMC003, FMC130, and Queclink GV300 and GV55 definitions. The FMM00A mapping was created from the Silverado's decoded Traccar attributes and checked against Teltonika's FMM00A AVL reference. It labels the observed fields, applies only the documented PCB-temperature scale, and leaves AVL 247's FMM00A support explicitly unverified. The other optional profiles remain experimental; their model-specific Traccar output and measurements have not been confirmed with live devices. Bundling any profile does not assign it to a vehicle. Check Traccar attributes and values before relying on model-specific mappings. See [the FMM00A data catalog](../docs/TELTONIKA_FMM00A_DATA_CATALOG.md).

The FMM00A file retains the stable ID `teltonika-fmm003` because that is the ID already assigned to the live Silverado profile. Do not rename the ID without migrating saved vehicle assignments.

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

# Bundled device profiles

This folder contains the JSON profile definitions bundled into the React app. Add one JSON file per device protocol/profile; the build discovers every `*.json` file here, so adding a definition does not require editing application code.

Before every production build, npm prints a reminder to export the current FMM003 profile from the app and compare it with the bundled JSON. The reminder does not stop the build.

## Currently bundled options

The FMM003 and FMM00A profiles are generated from a shared, scoped [Teltonika FMX003 dictionary](../device-field-catalog/teltonika/fmx003-mappings.json). Each contains 348 mappings: 296 raw AVL definitions and 52 decoded/derived keys, reviewed against the official model pages and Traccar v6.14.5. See the [complete 349-ID reference](../docs/TELTONIKA_FMM003_FMM00A_AVL_REFERENCE.md), [FMM003 catalog](../docs/TELTONIKA_FMM003_DATA_CATALOG.md), and [FMM00A catalog](../docs/TELTONIKA_FMM00A_DATA_CATALOG.md). A defined field is not a promise that every vehicle reports it. The optional FMB120, FMC003, FMC130 and Queclink GV300/GV55 profiles remain experimental; their mappings are not automatically promoted by this review.

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
  "schemaVersion": 16,
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

## Shared manufacturer dictionaries

Edit the reviewed FMX003 mapping dictionary and model overrides, then run **node scripts/build_teltonika_profiles.mjs**. Verify generated files with **node scripts/build_teltonika_profiles.mjs --check**. Keep the generated profile JSON files in source control so imports/exports stay portable. Runtime loading still uses complete profiles; a parent dictionary is not silently fetched or inherited.

Schema 16 upgrades unchanged older Teltonika defaults and fills missing fields, while preserving custom mappings and stable IDs. The schema-15 baseline is stored in device-profile-migrations/teltonika-v15.json for exact comparisons. Historical profile revisions keep their recorded definitions.

Brand/family dictionaries live under separate namespaces. Numeric AVL IDs are not universal across Teltonika families, and never across different manufacturers. Verify exact model/firmware/decoder behavior before extending a family’s scope.

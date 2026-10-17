# Device protocol profile files

Device protocol definitions are JSON files in [`device-profiles/`](../device-profiles/). Vite bundles every JSON file in that folder into the React application. A developer or administrator can add a supported mapping by adding a JSON file; the app code does not need to change.

The repository includes the original `teltonika-fmm003.json`, whose legacy ID `buick-enclave-2010` is intentionally retained so existing vehicle assignments continue working. The initial FMM00A definition is `teltonika-fmm00a.json`; it retains its live profile ID `teltonika-fmm003` so the Silverado assignment created during validation continues to resolve. IDs are internal keys: do not rename one without migrating saved assignments. The friendly names and mappings remain editable through Settings. Bundled files are defaults; edits already saved in a user's browser or shared profile database are not replaced by them.

See [`device-profiles/README.md`](../device-profiles/README.md) for the authoring format and workflow, and the [FMM00A data catalog](TELTONIKA_FMM00A_DATA_CATALOG.md) for evidence and limits. Profile data can describe labels, AVL IDs, source units, conversions, canonical units/scales, and quantities. Keep uncertain field meanings and conversions documented in the data catalog and validation notes; a profile badge alone is not evidence.

## Install and distribute

- For a fresh install, build and deploy the React app as usual. The bundled JSON profiles are included in the generated frontend; there is no separate profile-file copy step, API rebuild, or database migration.
- To distribute a new profile, include its JSON file in the source checkout before running the frontend production build, then deploy that build. Existing users acquire newly bundled IDs the next time the frontend loads and merges the package defaults; existing definitions with the same ID are preserved.
- If the app uses shared profile storage, administrators can save/synchronize a bundled profile through the existing profile editor. The profile must still be assigned to each relevant vehicle in Vehicle Catalog.
- To update an existing bundled profile for all users, coordinate through the profile editor/shared storage as appropriate. The package deliberately does not overwrite same-ID local or shared edits.

## Reviewed Teltonika family dictionary (2026-10-16)

FMM003/FMM00A now share a reviewed FMX003 base dictionary, with model overrides and portable generated profiles. Each supplies 348 mappings. The complete official reference retains all 349 AVL IDs across seven groups, including scope, numeric representation, firmware notes and unresolved source inconsistencies. Other tracker families/brands remain independently scoped. See [the full reference and reuse guidance](TELTONIKA_FMM003_FMM00A_AVL_REFERENCE.md).

Schema 16 upgrades only missing or unchanged old defaults; it preserves custom edits and stable assignments. Raw signed integer decoding, raw-versus-decoded status aliases, and expanded source-unit choices are supported. The field inspectors show a reference link and explain signed values where applicable. Historical profile snapshots keep their recorded interpretations.

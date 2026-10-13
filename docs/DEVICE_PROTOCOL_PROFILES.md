# Device protocol profile files

Device protocol definitions are JSON files in [`device-profiles/`](../device-profiles/). Vite bundles every JSON file in that folder into the React application. A developer or administrator can add a supported mapping by adding a JSON file; the app code does not need to change.

The repository currently includes `teltonika-fmm003.json`, extracted from the profile that was already bundled in the application. Its legacy ID, `buick-enclave-2010`, is intentionally retained so existing vehicle assignments continue working. The friendly name and mappings remain editable through Settings. This file represents the repository's bundled baseline; edits already saved in a user's browser or shared profile database are not replaced by it.

See [`device-profiles/README.md`](../device-profiles/README.md) for the authoring format and workflow. Profile data can describe labels, AVL IDs, source units, conversions, canonical units/scales, and quantities. Keep uncertain field meanings and conversions documented in the data catalog and validation notes; do not treat a profile badge as evidence.

## Install and distribute

- For a fresh install, build and deploy the React app as usual. The bundled JSON profiles are included in the generated frontend; there is no separate profile-file copy step, API rebuild, or database migration.
- To distribute a new profile, include its JSON file in the source checkout before running the frontend production build, then deploy that build. Existing users acquire newly bundled IDs the next time the frontend loads and merges the package defaults; existing definitions with the same ID are preserved.
- If the app uses shared profile storage, administrators can save/synchronize a bundled profile through the existing profile editor. The profile must still be assigned to each relevant vehicle in Vehicle Catalog.
- To update an existing bundled profile for all users, coordinate through the profile editor/shared storage as appropriate. The package deliberately does not overwrite same-ID local or shared edits.

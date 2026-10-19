# Traccar Scope renaming plan

Prepared 2026-10-18. **Status: implementation in progress.** This plan supersedes the earlier product-name brainstorming.

Implementation has started in the existing checkout. Source, tests, installer templates, and active-document references have been moved to the Traccar Scope naming contract. One-time browser-settings and PostgreSQL migrations are prepared; deployment-transfer export and restore now use format version 2 only. The frontend production build passes, all 153 Node tests pass, lint exits successfully with existing warnings, and both installer scripts pass Bash syntax checks. The .NET build could not restore packages because NuGet access is blocked in this environment, so API compilation remains unverified. No database, browser storage, running API, Wiki, GitHub repository, or checkout directory has been cut over. Windows would not rename the old API project directory because a file was in use, so the source has been copied to the new project path and the original remains available for recovery. Existing uncommitted documentation moves were preserved.

## Decision and scope

Use **Traccar Scope** for the application and **Traccar Scope API** for its backend. A suggested description is “An independent vehicle history and telemetry workspace for Traccar.” Keep the distinction between this application and the upstream Traccar server clear in the README, Wiki, and installation guides.

Only Dan's development and testing systems exist. Make one coordinated naming change across the frontend, backend, configuration, installers, and documentation. Convert the development data once, rebuild disposable test installations, and use only the new names afterward. Do not introduce dual environment-variable readers, old HTTP routes, old export readers, or an installer upgrade framework.

Preserve the existing Git history by renaming the repository. There is no technical benefit to deleting it and starting another repository for this change. GitHub documents redirects for repository links, Git operations, and Wikis after a rename; update our links and remotes explicitly rather than depending on those redirects. See [GitHub's repository rename instructions](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

## Name and domain check

Read-only checks against the authoritative .com registry on 2026-10-18 returned:

| Domain | Registry response | Interpretation |
| --- | --- | --- |
| [traccarscope.com](https://rdap.verisign.com/com/v1/domain/traccarscope.com) | HTTP 404, no registration record | Appears unregistered; confirm availability and price at a registrar before purchasing. |
| [motionledger.com](https://rdap.verisign.com/com/v1/domain/motionledger.com) | HTTP 200, registered | Not an unregistered alternative. |
| [tripgauge.com](https://rdap.verisign.com/com/v1/domain/tripgauge.com) | HTTP 200, registered | Not an unregistered alternative. |

The previously suggested RoadScope name is already used by [a GPS/fleet tracking product](https://www.roadscope.net/) and [a route-engineering product](https://roadscope.app/). Do not prefer it over Traccar Scope.

Recommendation: proceed with Traccar Scope. Domain availability can change; a registry lookup is not a reservation or a guarantee of registrar checkout availability. Registration is an owner action, separate from this plan. Using a domain containing Traccar also warrants checking upstream branding expectations before a commercial launch; this lookup establishes no permission or affiliation. Keep the project's existing license and attribution notices during the rename. DNS, HTTPS, monetization, and changing hosting providers are separate work.

## Canonical naming map

Use these spellings consistently. Human-readable labels use spaces, source identifiers use their language's conventions, and repository/document filenames follow their existing conventions.

| Surface | Current | Target |
| --- | --- | --- |
| Product name | Traccar React | Traccar Scope |
| Backend display name | Traccar React API | Traccar Scope API |
| GitHub repository | `Danvanf/Traccar-React` | `Danvanf/Traccar-Scope` |
| Repository/checkout slug and npm package | `traccar-react` | `traccar-scope` |
| .NET project directory/file | `backend/TraccarReact.Api/TraccarReact.Api.csproj` | `backend/TraccarScope.Api/TraccarScope.Api.csproj` |
| .NET root namespace | `TraccarReact.Api` | `TraccarScope.Api` |
| C# application-specific type prefix | `TraccarReactApi` | `TraccarScopeApi` |
| Published assembly | `traccar_react_api.dll` | `traccar_scope_api.dll` |
| Application database and dedicated login role | `traccar_react_api` | `traccar_scope_api` |
| App-only installer maintenance database/admin role | `traccar_react` | `traccar_scope` for fresh app-only installs |
| Configuration section and connection-string key | `TraccarReactApi` | `TraccarScopeApi` |
| Environment prefix | `TraccarReactApi__` | `TraccarScopeApi__` |
| Connection-string variable | `ConnectionStrings__TraccarReactApi` | `ConnectionStrings__TraccarScopeApi` |
| Installer app-variable prefix | `TRACCAR_REACT_` | `TRACCAR_SCOPE_` |
| Vite app API target | `VITE_TRACCAR_REACT_API_TARGET` | `VITE_TRACCAR_SCOPE_API_TARGET` |
| Browser proxy prefix | `/traccar-react-api` | `/traccar-scope-api` |
| Session cookie | `traccar_react_api_session` | `traccar_scope_api_session` |
| Frontend API module | `src/lib/traccarReactApi.js` | `src/lib/traccarScopeApi.js` |
| Saved API URL property | `traccarReactApiBaseUrl` | `traccarScopeApiBaseUrl` |
| Browser settings key | `traccarReactSettings` | `traccarScopeSettings` |
| Docker API service | `traccar-react-api-api` or `traccar-react-api` | `traccar-scope-api` (one `api` suffix) |
| Existing-Traccar installer | `scripts/install_traccar_react.sh` | `scripts/install_traccar_scope.sh` |
| Profile-submission email subject prefix | `Traccar React:` | `Traccar Scope:` |

Rename related `.http`, SQL initializer/audit, Dockerfile, Nginx, and Compose filenames using the same substitutions. Rename the active installation guides to `INSTALL_TRACCAR_SCOPE_ALONGSIDE_TRACCAR.md` and `INSTALL_TRACCAR_SCOPE_MANUAL_DEPLOYMENT.md`. Keep `INSTALL_FULL_STACK.md`, which is already product-neutral.

Upstream Traccar is still Traccar: keep its database, `tc_*` tables, device IDs, API paths, `Traccar__*` options, `VITE_TRACCAR_TARGET`, `src/lib/traccarApi.js`, and official links. React remains the UI framework: keep React imports, package dependencies, and accurate descriptions of the stack. Generic names such as `APP_ADMIN_USERNAME`, ports 5124/5173/8089, and vehicle/trip table names do not need a branding change.

## 1. Record the baseline and prepare recovery

- [ ] Review the current uncommitted changes, including the recent documentation moves, and establish a recoverable Git checkpoint without discarding work. Record the corresponding Wiki revision separately.
- [ ] Inventory product identifiers in source, tests, scripts, templates, active docs, and Wiki content. Search spelling variants (`Traccar React`, `Traccar-React`, `traccar-react`, `traccar_react`, `TraccarReact`, `traccarReact`) and filename variants. Exclude dependencies, generated builds, and archived notes from mechanical replacement.
- [ ] Record actual API launch configuration, PostgreSQL database/roles, Compose project names, volume names, and deployment directories for development and WSL testing. Keep populated environment files and secrets out of Git and this plan.
- [ ] Back up the development application database, the existing credential key ring, and any browser-only custom profiles/preferences worth retaining. Record baseline vehicle/trip/profile/user counts and verify the backup can be read/restored to an isolated target before changing the data-bearing system.
- [ ] Keep the current checkout location during implementation. Do not rename the open workspace directory midway through edits or tests.

Checkpoint: code, Wiki, data, key material, and deployment metadata are recoverable. No existing Traccar data or tracker configuration changes are required.

## 2. Rename the code and configuration together

- [ ] Rename the .NET project, assembly, namespace/type references, auth endpoint file, sample requests, and all test-project references.
- [ ] Rename the frontend API module, imports, settings property/key, API proxy prefix, Vite target, cookie, labels, page title, form identifiers, messages, filenames, export metadata, and email subject prefix. Update both `package.json` and the package identity in `package-lock.json` without an unrelated dependency upgrade.
- [ ] Update API configuration reads and checked-in environment samples to accept only the new section/variable names. Actual development environment values must be copied into those new names before restarting. Copy credential-key values and key IDs exactly; a product rename is not a key rotation.
- [ ] Update every client, proxy, and installer caller of the renamed API prefix in the same change. Keep generic endpoint paths such as `/auth/login`, `/api/vehicles`, and `/health` consistent under that prefix.
- [ ] Replace the old deployment-transfer application entry paths and branded manifest fields in the exporter, restore script, UI, and tests together. Advance the transfer format from version 1 to version 2 for the changed contract and accept only version 2. Recreate old test ZIPs with the new exporter rather than maintaining readers for old packages.
- [ ] Remove the old VehicleApp naming adapters (`ApiNamingMigration` and the equivalent browser settings fallback) after the one-time data conversion below has replaced their purpose. Replace their legacy-compatibility tests with coverage of the conversion and current defaults.

Checkpoint: the new frontend, API, tests, and configuration agree on one naming contract. No application aliases or old routes are introduced.

## 3. Convert the development data once

- [ ] Produce a small, explicit dry-run/apply migration for the current `traccar_react_api` database only. It should report changes, refuse ambiguous old/new database collisions or active clients, and never terminate sessions automatically. Do not build a chain of VehicleApp-era migrations.
- The current migration helper is `scripts/migrate_traccar_scope_database.sql`. It previews by default and refuses target collisions or active database clients. After a verified backup and after stopping the API, preview with `psql -h DB_HOST -U DB_ADMIN -d postgres -f scripts/migrate_traccar_scope_database.sql`; apply only after reviewing with the same command plus `-v apply=true`. It renames the database and a dedicated matching role if present, and converts only the `general` settings row while preserving custom hosts.
- [ ] Stop the known application API/worker clients, then rename the application database and its dedicated application role if that role actually exists. Preserve ownership, grants, passwords, rows, IDs, profiles, and history. Do not rename a shared PostgreSQL administrative login or the upstream Traccar database.
- [ ] Transform the saved General settings JSON property to `traccarScopeApiBaseUrl`. Replace the known old default proxy suffix with `/traccar-scope-api` while preserving a configured hostname and other settings. Inspect other stored app settings for branded defaults before applying exact field-level changes; do not run unrestricted replacements across all table values.
- [ ] Move retained browser settings to `traccarScopeSettings` and translate the API URL property once, using a local migration helper. Preserve the other preferences and inspect separately stored custom profile/label stores. Alternatively reset disposable test-browser settings. The shipping app reads only the new settings afterward.
- The browser helper is `scripts/migrate_browser_settings_to_traccar_scope.js`. Run it in the DevTools console on the existing app origin before switching the browser to the renamed build; it copies settings to the new key, preserves the saved values, and removes the old key only after the new entry is written. It prints no settings or credentials.
- [ ] Retire old environment names and sign in again under the new session cookie. Existing application users and their password hashes remain valid; initial-admin bootstrap is not a password-reset mechanism.

**Required persisted-format exception:** `CredentialProtectionService.cs` uses two `vehicle-app:...` associated-data strings inside authenticated encryption. These bytes are part of the stored encrypted format, not display branding. Leave them and the existing key ring unchanged so saved Traccar, Graph, SMS, and Bouncie credentials remain readable. This adds no legacy reader or fallback. Re-encrypting every credential solely to change these invisible bytes would add avoidable work. Preserve any other cryptographic context/token identity discovered during inventory unless a conversion is actually required.

Keep telemetry profile IDs, vehicle/device IDs, source field keys, source units, external import identities, and provider account IDs stable. They describe data identity, not the product name.

Checkpoint: the new API can read the original development data and decrypt the original credentials, with only current naming accepted at runtime.

## 4. Update installers and Docker deployment

- [ ] Rename the two installer flows' source URLs, checkout paths, file references, .NET entrypoints, Nginx upstreams/routes, service names, environment keys, SQL bootstrap paths, health checks, printed instructions, and Compose dependencies together.
- [ ] Keep the distinction between installing both apps and adding Traccar Scope alongside an existing Traccar installation. Neither flow should rename upstream Traccar resources.
- [ ] Use `traccar-scope-api` consistently instead of retaining the accidental double `api` service suffix. Make the chosen Compose project identity explicit in documentation so a directory rename does not silently select a new database volume.
- [ ] Rebuild disposable WSL test installs from scratch under the new name after confirming there is no unique data to retain. For a retained volume, inventory and reference its actual existing name explicitly before recreating containers; never assume a new project name attaches the original volume.
- [ ] Existing generated helper files may be rejected by the installers' current mismatch checks. Refresh the known test deployment helpers deliberately rather than adding an installer compatibility layer for them.
- [ ] Generate fresh secrets only for fresh disposable installs. Retained data continues using its existing credentials and encryption key. Record and stop only the temporary processes created for validation; do not kill unrelated Node or Docker workloads.

Checkpoint: all Compose files render and both install paths build from the new source. A changed name cannot cause a silent empty-database switch.

## 5. Update documentation and Wiki

- [ ] Update the README, active docs, AI handoff, current work index, AGENTS workspace path instructions, contribution/security/licensing descriptions, script examples, screenshots containing visible branding, and installation links.
- [ ] Update the Wiki page titles/slugs that contain the old app name and all inbound links, sidebar/Home entries, image URLs, repository blob/raw URLs, and clone instructions. Preserve accurate upstream Traccar references. Maintain the local Wiki checkout as its own Git repository and revision.
- [ ] Move the now-historical `API_NAMING_MIGRATION.md` into `docs/archive/project-plans` once this migration is documented and verified. Point active docs at the current installation/configuration instructions instead of extending that earlier rename history.
- [ ] Preserve archived planning notes and Git history as historical evidence. Do not rewrite every archived mention of the old name. Record the transition in the archive index; allow historical names only where context is clear.
- [ ] Keep `support@rvthinker.com` and existing provider endpoints unless Dan requests an address change. Renaming the subject prefix does not require moving support mail, Graph apps, or OAuth accounts. If an actual public origin changes later, update registered callback URLs then.

Checkpoint: a new reader sees Traccar Scope consistently and can follow current instructions without old-name redirects.

## 6. Validate before switching GitHub and the workspace

- [ ] Run the frontend lint, existing Node tests, and production build. Build the renamed .NET project and run the existing .NET test harnesses. Run the Python transfer/restore tests, Bash syntax checks, and Compose configuration checks for both installer modes.
- [ ] Run a focused browser/API check: login, saved General settings, Traccar devices/positions, map, vehicle history, telemetry graph, status fields, focused profile editor, user access, reports, and profile-support ZIP generation.
- [ ] Verify existing encrypted provider settings can be read. Test delivery only where explicitly authorized; checking the rename does not require sending unsolicited email or SMS.
- [ ] Export a new version-2 deployment package and run restore preflight to the no-write boundary on an isolated target, including checksums/counts and the new branded entry paths. A full restore test, if used, belongs on a disposable target.
- [ ] Exercise a fresh combined installation and a fresh existing-Traccar installation in WSL. Record Linux VM results separately when a VM is available; do not call VM support tested based only on Bash syntax or Compose rendering. The existing-Traccar installer had only static checks at the start of this plan.
- [ ] Compare the preserved development counts with the baseline and confirm a saved shared credential still decrypts. Inspect any failures before proceeding.
- [ ] Search again for old product spellings and classify the remaining matches: historical archive/migration evidence or immutable persisted-format strings. There should be no active old labels, URLs, environment keys, executable project paths, or README/Wiki links.

## 7. Publish the rename and finish

- [ ] Confirm `Danvanf/Traccar-Scope` is available, then rename the existing GitHub repository once the new implementation and documentation are ready. Update both application and Wiki Git remotes to the new canonical URLs and publish their prepared changes together.
- [ ] Verify README links, Wiki navigation/images, fresh clones, and both installer entry points against the published new repository. Check any badges, release assets, automation, or project-site configuration found during inventory.
- [ ] Close the editor/dev processes as needed, rename only the checkout leaf directories to `traccar-scope` and `traccar-scope-wiki`, and reopen the actual repository root. The parent `Traccar` workspace need not be renamed. Retain the existing `Developement` directory spelling and update workspace tasks/launch settings that embed the old checkout path.
- [ ] Refresh the application from the reopened workspace, verify the new remote URLs, and clean up obsolete generated build output and stopped old app containers after checking ownership and retained volumes. Do not remove backups or database volumes as routine cleanup.
- [ ] Mark this plan complete, remove it from the active work index, and archive the completed plan with the validation results and any explicitly deferred VM check. Stop here; unrelated feature work and deployment redesign are outside this rename.

## Recovery and completion criteria

If validation fails before publication, stop the new application clients and return to the recorded code/configuration checkpoint and original database identity or verified backup. Restore matching environment names and the unchanged key ring together. Never run old and new copies concurrently against the same development database during recovery. Disposable test stacks can be rebuilt instead.

The rename is complete when Traccar Scope builds and runs, the retained development data and encrypted credentials work, current code/configuration/installers use one naming scheme, the GitHub repository and Wiki links use the new name, and fresh installation results are recorded accurately. No additional feature development is required to finish this plan.

# Traccar Scope renaming plan

Prepared 2026-10-18. **Status: implementation in progress.** This plan supersedes the earlier product-name brainstorming.

Implementation has started in the existing checkout. Source, tests, installer templates, and active-document references now use the Traccar Scope naming contract. The PostgreSQL migration has been applied after a custom-format backup was successfully read with `pg_restore --list`. The development database is now `traccar_scope_api`; the `traccar` role remains unchanged, and baseline counts are preserved. The current Chrome app origin now has `traccarScopeSettings` and no `traccarReactSettings`; the helper displayed no saved values. Source commit `f15e98e` and Wiki commit `a7440e3` are synced to the existing `Danvanf/Traccar-React` repository and its Wiki. Validation so far: production frontend build passes, all 153 Node tests pass, lint exits successfully with existing warnings, both installer scripts pass Bash syntax checks, both Compose templates render with dummy values, the renamed API builds with zero warnings/errors, three .NET harnesses pass, the database-backed trip-import integration harness passes all 29 checks against a disposable schema, and six restore-package tests pass. After the user configured the new connection string and key-ring names, the running API returned HTTP 200 for `/health` and `/api/system-settings/general`; the response confirmed the saved Traccar password is available. Browser smoke checks passed for sign-in, map/device/history/status loading, telemetry graph rendering, users/groups loading, profile editor loading, and the default usage report. A private version-2 export from the Limestone validation clone was later validated and deleted without importing it; its GPS locations and device identifiers were not retained in the workspace. The temporary Vite server used for these checks was stopped afterward. The GitHub repository and checkout directories remain to be renamed.

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

- [x] Review the current uncommitted changes, including the recent documentation moves, and establish a recoverable Git checkpoint without discarding work. Baseline application HEAD: `7e21e5b67741e6f9a462891b4ba5ef828c0f411d`; Wiki HEAD: `44a4644a846b42b035a40ad55be9b73f8d23b15f`. Local recovery patches and copies of the untracked migration/wiki pages were saved under `/tmp`; the changes are now captured in local commits `46952e0` and `a7440e3`.
- [x] Inventory product identifiers in source, tests, scripts, templates, and active docs. Search spelling variants (`Traccar React`, `Traccar-React`, `traccar-react`, `traccar_react`, `TraccarReact`, `traccarReact`) and filename variants. Exclude dependencies, generated builds, and archived notes from mechanical replacement. Wiki inventory/publication remains in section 5.
- [x] Record Limestone's API launch configuration, PostgreSQL database names/owners, Compose project, and deployment directories. Keep populated environment files and secrets out of Git and this plan.
- [x] Map Limestone Traccar and PostgreSQL container mounts. PostgreSQL data is a host bind mount at `/home/dan/docker/traccar/postgres`; Traccar config and logs are bind-mounted from `/home/dan/docker/traccar`. No Docker named volume backs these two services.
- [ ] Record the corresponding development/WSL deployment configuration.
- [x] Back up the development application database and verify the custom-format archive can be read with `pg_restore --list` before changing the data-bearing system.
- [x] Securely back up the existing Limestone credential key ring. Three values from the stopped API container were saved with mode 600 under `~/docker/vehicle-app/private-renaming-backups`; do not display or publish that file. Baseline counts were recorded and checked after the development database migration: 2 vehicles, 7,275 trips, 2 telemetry profiles, and 3 app users.
- [ ] Back up any browser-only custom profiles/preferences worth retaining.
- Limestone inventory (2026-10-19): the stopped `vehicle-app-api` container belongs to Compose project `vehicle-app`, is built from `/home/dan/docker/vehicle-app/traccar-react`, has no mounts, publishes port 5124, and is attached to `traccar_default`. Its recorded environment names include `ConnectionStrings__VehicleApp`, `VEHICLE_APP_BOUNCIE_ENCRYPTION_KEY`, and the old `VehicleApp__CredentialEncryption__*` key-ring names; the recorded connection string points to `vehicle_app`, but that database is absent from the server. The server instead has `traccar_scope_api` and upstream `traccar`, both owned by `traccar`. Exact `traccar_scope_api` counts are 2 vehicles, 7,277 trips, 2 telemetry profiles, 3 app users, 2 provider secrets, and 1 Bouncie credential. This is Limestone's inventory, separate from the earlier development baseline. The old checkout contains untracked backend/SQL work and must remain untouched. The Traccar and PostgreSQL containers use host bind mounts, not named volumes; PostgreSQL data is at `/home/dan/docker/traccar/postgres`, with 83 GB available on its filesystem. A custom-format backup of `traccar_scope_api` was created at `~/docker/vehicle-app/private-renaming-backups/traccar_scope_api_20261019_001403.dump` and validated successfully with `pg_restore --list` (21 MB). Its matching key-ring values were saved separately under the same protected backup directory. The dump was restored successfully into `traccar_scope_api_rename_validation_20261019`, and exact counts for users, vehicles, trips, telemetry profiles, provider secrets, Bouncie credentials, and system settings match the source. The disposable clone's exact queued-message counts are zero for `email_alert_outbox`, `sms_alert_outbox`, and `email_alert_manual_retries`. The user reports the connected Bouncie account expired and its credentials are no longer needed for validation. Because API startup automatically attempts a Bouncie token refresh when a stored row exists, the credential row was removed from this disposable clone only; the live database is unchanged.
- [ ] Keep the current checkout location during implementation. Do not rename the open workspace directory midway through edits or tests.

Checkpoint: code, Wiki, data, key material, and deployment metadata are recoverable. No existing Traccar data or tracker configuration changes are required.

## 2. Rename the code and configuration together

- [x] Rename the .NET project, assembly, namespace/type references, auth endpoint file, sample requests, and all test-project references.
- [x] Rename the frontend API module, imports, settings property/key, API proxy prefix, Vite target, cookie, labels, page title, form identifiers, messages, filenames, export metadata, and email subject prefix. Update both `package.json` and the package identity in `package-lock.json` without an unrelated dependency upgrade.
- [x] Update API configuration reads and checked-in environment samples to accept only the new section/variable names. Actual development environment values must be copied into those new names before restarting. Copy credential-key values and key IDs exactly; a product rename is not a key rotation.
- [x] Update every client, proxy, and installer caller of the renamed API prefix in the same change. Keep generic endpoint paths such as `/auth/login`, `/api/vehicles`, and `/health` consistent under that prefix.
- [x] Replace the old deployment-transfer application entry paths and branded manifest fields in the exporter, restore script, UI, and tests together. Advance the transfer format from version 1 to version 2 for the changed contract and accept only version 2. Recreate old test ZIPs with the new exporter rather than maintaining readers for old packages.
- [x] Remove the old VehicleApp naming adapters (`ApiNamingMigration` and the equivalent browser settings fallback). Their one-time conversion is handled by the explicit database/browser migration scripts below; replace legacy-compatibility tests with current-default and migration coverage.

Checkpoint: the new frontend, API, tests, and configuration agree on one naming contract. No application aliases or old routes are introduced.

## 3. Convert the development data once

- [x] Produce a small, explicit dry-run/apply migration for the current `traccar_react_api` database only. It reports changes, refuses ambiguous old/new database collisions or active clients, and never terminates sessions automatically. Do not build a chain of VehicleApp-era migrations.
- The current migration helper is `scripts/migrate_traccar_scope_database.sql`. It previews by default and refuses target collisions or active database clients. After a verified backup and after stopping the API, preview with `psql -h DB_HOST -U DB_ADMIN -d postgres -f scripts/migrate_traccar_scope_database.sql`; apply only after reviewing with the same command plus `-v apply=true`. It renames the database and a dedicated matching role if present, and converts only the `general` settings row while preserving custom hosts.
- [x] Stop the known application API/worker clients, then rename the application database and its dedicated application role if that role actually exists. Preserve ownership, grants, passwords, rows, IDs, profiles, and history. Do not rename a shared PostgreSQL administrative login or the upstream Traccar database.
- [x] Transform the saved General settings JSON property to `traccarScopeApiBaseUrl`. Replace the known old default proxy suffix with `/traccar-scope-api` while preserving a configured hostname and other settings. Inspect other stored app settings for branded defaults before applying exact field-level changes; do not run unrestricted replacements across all table values.
- [x] Move retained browser settings to `traccarScopeSettings` and translate the API URL property once, using a local migration helper. Preserve the other preferences and inspect separately stored custom profile/label stores. Alternatively reset disposable test-browser settings. The shipping app reads only the new settings afterward. On the current Chrome app origin, the new key exists and the old key is absent; setting values were not displayed.
- The browser helper is `scripts/migrate_browser_settings_to_traccar_scope.js`. Run it in the DevTools console on the existing app origin before switching the browser to the renamed build; it copies settings to the new key, preserves the saved values, and removes the old key only after the new entry is written. It prints no settings or credentials.
- [x] Retire old environment names in the application configuration and sign in under the new session cookie. Existing application users and their password hashes remain valid; initial-admin bootstrap is not a password-reset mechanism. The user successfully signed in to the renamed app.

**Required persisted-format exception:** `CredentialProtectionService.cs` uses two `vehicle-app:...` associated-data strings inside authenticated encryption. These bytes are part of the stored encrypted format, not display branding. Leave them and the existing key ring unchanged so saved Traccar, Graph, SMS, and Bouncie credentials remain readable. This adds no legacy reader or fallback. Re-encrypting every credential solely to change these invisible bytes would add avoidable work. Preserve any other cryptographic context/token identity discovered during inventory unless a conversion is actually required.

Keep telemetry profile IDs, vehicle/device IDs, source field keys, source units, external import identities, and provider account IDs stable. They describe data identity, not the product name.

Checkpoint: the new API can read the original development data and decrypt the original credentials, with only current naming accepted at runtime.

## 4. Update installers and Docker deployment

- [x] Rename the two installer flows' source URLs, checkout paths, file references, .NET entrypoints, Nginx upstreams/routes, service names, environment keys, SQL bootstrap paths, health checks, printed instructions, and Compose dependencies together.
- [x] Keep the distinction between installing both apps and adding Traccar Scope alongside an existing Traccar installation. Neither flow should rename upstream Traccar resources.
- [x] Use `traccar-scope-api` consistently instead of retaining the accidental double `api` service suffix. Make the chosen Compose project identity explicit in documentation so a directory rename does not silently select a new database volume.
- [x] On Limestone, create a clean validation checkout at `~/docker/vehicle-app/traccar-scope-validation` from synced commit `f15e98e` without modifying the old checkout. Build `traccar-scope-api:rename-validation-20261019` successfully from `scripts/installer-templates/Dockerfile.first-test-api`.
- [x] Create a mode-600 validation environment file from the protected key-ring backup and the PostgreSQL container environment without displaying secret values. Start `traccar-scope-api-rename-validation` on `traccar_default`, publishing only `127.0.0.1:5125` and targeting the disposable `traccar_scope_api_rename_validation_20261019` database. The container reached `Up`; `/health` returned HTTP 200 with status `ok`; `/auth/status` returned HTTP 200 with authentication enabled and no active session. Post-start counts remained 3 users, 2 vehicles, 7,277 trips, 2 telemetry profiles, and 2 provider secrets; the Bouncie row and email/SMS queues remained zero.
- [x] After clone-only credential verification, confirm `provider_account_secrets=2`, `email_alert_outbox=0`, and `sms_alert_outbox=0`; remove the temporary HTTP session-cookie file. The disposable API container and clone remain in place for remaining checks.
- [ ] Rebuild disposable WSL test installs from scratch under the new name after confirming there is no unique data to retain. For a retained volume, inventory and reference its actual existing name explicitly before recreating containers; never assume a new project name attaches the original volume. Read-only Docker inventory is currently blocked because this session is denied access to `/var/run/docker.sock`; no containers or volumes were changed.
- [ ] Existing generated helper files may be rejected by the installers' current mismatch checks. Refresh the known test deployment helpers deliberately rather than adding an installer compatibility layer for them.
- [ ] Generate fresh secrets only for fresh disposable installs. Retained data continues using its existing credentials and encryption key. Record and stop only the temporary processes created for validation; do not kill unrelated Node or Docker workloads.

Checkpoint: all Compose files render and both install paths build from the new source. A changed name cannot cause a silent empty-database switch.

## 5. Update documentation and Wiki

- [x] Update the README, active docs, AI handoff, current work index, contribution/security/licensing descriptions, script examples, screenshots containing visible branding, and installation links. Keep the AGENTS workspace path accurate until the checkout leaf is renamed in section 7.
- [x] Update the local Wiki page titles/slugs that contain the old app name and all inbound links, sidebar/Home entries, image URLs, repository blob/raw URLs, and clone instructions. Preserve accurate upstream Traccar references. Keep publication for the coordinated GitHub rename in section 7.
- [x] Move the now-historical `API_NAMING_MIGRATION.md` into `docs/archive/project-plans` after verifying the migrated database, new configuration names, saved Traccar password, and browser sign-in. Point active docs at current installation/configuration instructions instead of extending the migration history.
- [x] Preserve archived planning notes and Git history as historical evidence. Do not rewrite every archived mention of the old name. Record the transition in the archive index; allow historical names only where context is clear.
- [x] Keep `support@rvthinker.com` and existing provider endpoints; no address or origin change was requested. Renaming the subject prefix does not require moving support mail, Graph apps, or OAuth accounts. If an actual public origin changes later, update registered callback URLs then.

Checkpoint: a new reader sees Traccar Scope consistently and can follow current instructions without old-name redirects.

## 6. Validate before switching GitHub and the workspace

- [x] Run the frontend lint, existing Node tests, and production build. Build the renamed .NET project and run the .NET test harnesses. Run the Python transfer/restore tests, Bash syntax checks, and Compose configuration checks for both installer modes.
- [x] Finish the focused browser/API check by verifying profile-support ZIP generation and any focused-field editing/save flow. The prior session reports that the renamed app passed browser checks; this session has no live browser handle to independently confirm which focused flows were included. Login, saved General settings, Traccar device access, map/history, telemetry graph, status panel, users/groups, bundled profile editor, and the default usage report loaded successfully after the development environment used the renamed connection-string and original key-ring values. The live deployment export was not downloaded because it contains exact GPS locations and device identifiers; no profile or user data was edited during these checks.
- [x] Verify existing encrypted provider settings can be read by invoking the credential-rotation endpoint on the disposable Limestone clone only, with a second key ID alias containing the same key bytes. The endpoint reported `rotated: 2` and `activeKeyId: validation`, confirming both retained encrypted provider secrets decrypted and re-encrypted successfully. This changed clone records only; no provider delivery was attempted.
- [x] Create a private version-2 export from Limestone's disposable validation API clone and run `restore_deployment_test.py --validate-only`. The archive validated as Traccar 6.14.5, with four devices, 157,162 positions, 734 events, and the expected Traccar Scope API entry paths/checksums; no target was contacted and no database writes occurred. The temporary ZIP was deleted after validation. The clone's saved `/api` base path had to be temporarily changed to `http://traccar:8082/api` because the exporter treated a root-relative path as an absolute file URI; the same path handling is now corrected in the local exporter, proxy, and telemetry inventory code.
- [x] Restore the Limestone validation API clone to `ASPNETCORE_ENVIRONMENT=Production` with `TraccarScopeApi__Auth__AllowUnauthenticatedDevelopment=false` after export validation. It was recreated as `traccar-scope-api-rename-validation`, still published only on `127.0.0.1:5125`; its existing database and key configuration were preserved.
- [ ] Run restore preflight to the no-write boundary on an isolated target, including device mapping and database checks. A full restore test, if used, belongs on a disposable target.
- [ ] Exercise a fresh combined installation and a fresh existing-Traccar installation in WSL. Record Linux VM results separately when a VM is available; do not call VM support tested based only on Bash syntax or Compose rendering. The first WSL run reused `deploy_database-data`, which contained only the `traccar` role/database; initdb had therefore skipped the Scope role/database bootstrap, and password alignment failed on the missing `traccar_scope_api` role. Only the database container was running. The installer had already aligned the `traccar` role password to the new private `.env`; no volume was removed. A local installer change now reconciles a missing Scope role/database and bootstraps the app schema for an existing Traccar-only volume. `bash -n` passes; runtime recovery and a rerun are pending.
- [x] Compare the preserved development counts with the baseline; all recorded counts match.
- [x] Confirm a saved shared Traccar password remains available after configuring the original key ring under the new configuration names. General settings returned HTTP 200 with `hasTraccarPassword: true`; no secret value was displayed.
- [x] Search again for old product spellings and classify the remaining matches. Matches are limited to this plan's source-to-target map, one-time database/browser migration inputs, tests proving prior settings are ignored, the still-current checkout path in `AGENTS.md`, and historical database identity in the handoff; no active UI labels, API routes, environment variables, executable project paths, or README/Wiki links remain.

## 7. Publish the rename and finish

- [ ] Confirm `Danvanf/Traccar-Scope` is available, then rename the existing GitHub repository once the new implementation and documentation are ready. The GitHub API recheck on 2026-10-19 finds `Danvanf/Traccar-React` (with admin permission for the connected account) and returns 404 for the target name; this is not a reservation. Source and Wiki changes are synced under the old repository name; update both Git remotes to the new canonical URLs after the rename.
- [ ] Verify README links, Wiki navigation/images, fresh clones, and both installer entry points against the published new repository. Check any badges, release assets, automation, or project-site configuration found during inventory.
- [ ] Close the editor/dev processes as needed, rename only the checkout leaf directories to `traccar-scope` and `traccar-scope-wiki`, and reopen the actual repository root. The parent `Traccar` workspace need not be renamed. Retain the existing `Developement` directory spelling and update workspace tasks/launch settings that embed the old checkout path.
- [ ] Refresh the application from the reopened workspace, verify the new remote URLs, and clean up obsolete generated build output and stopped old app containers after checking ownership and retained volumes. Do not remove backups or database volumes as routine cleanup.
- [ ] Mark this plan complete, remove it from the active work index, and archive the completed plan with the validation results and any explicitly deferred VM check. Stop here; unrelated feature work and deployment redesign are outside this rename.

## Recovery and completion criteria

If validation fails before publication, stop the new application clients and return to the recorded code/configuration checkpoint and original database identity or verified backup. Restore matching environment names and the unchanged key ring together. Never run old and new copies concurrently against the same development database during recovery. Disposable test stacks can be rebuilt instead.

The rename is complete when Traccar Scope builds and runs, the retained development data and encrypted credentials work, current code/configuration/installers use one naming scheme, the GitHub repository and Wiki links use the new name, and fresh installation results are recorded accurately. No additional feature development is required to finish this plan.

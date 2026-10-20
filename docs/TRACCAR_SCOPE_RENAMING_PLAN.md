# Traccar Scope renaming plan

Prepared 2026-10-18. **Status: final repository/workspace cleanup and validation remain.** This plan supersedes the earlier product-name brainstorming.

The implementation, Limestone production cutover, and fresh install validation are complete. Source, tests, installer templates, and active documentation use the Traccar Scope naming contract. The development database migration and browser settings migration were verified, and baseline data counts were preserved. Existing encrypted settings remained readable with the original key ring. Prior validation includes the production frontend build, Node/.NET/Python checks, installer syntax and Compose rendering, database-backed import checks, browser smoke checks, production login/history checks, and a private version-2 export validation against a disposable clone. The user reports successful runs of both the alongside-Traccar and full-stack installation guides, including on another machine; test-VM pathing issues on Limestone were resolved. On 2026-10-20, GitHub confirmed the repository is now `Danvanf/Traccar-Scope`. The current workspace remote and checkout folder still use the former name. The remaining work is restore-preflight validation and final published-link, remote, and workspace cleanup.

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
- [x] Record the WSL test deployment layout from `communications-plan/TalkingtoAI.md`: the app checkout is `~/docker/traccar-scope`, the install root is `~/docker/traccar-scope-install`, and its `deploy` Compose project runs web/API/database separately from the `traccar` Compose project. The captured inventory contains no `.env` values.
- [x] Back up the development application database and verify the custom-format archive can be read with `pg_restore --list` before changing the data-bearing system.
- [x] Securely back up the existing Limestone credential key ring. Three values from the stopped API container were saved with mode 600 under `~/docker/vehicle-app/private-renaming-backups`; do not display or publish that file. Baseline counts were recorded and checked after the development database migration: 2 vehicles, 7,275 trips, 2 telemetry profiles, and 3 app users.
- [ ] Back up any browser-only custom profiles/preferences worth retaining.
- Limestone inventory (2026-10-19): the stopped `vehicle-app-api` container belongs to Compose project `vehicle-app`, is built from `/home/dan/docker/vehicle-app/traccar-react`, has no mounts, publishes port 5124, and is attached to `traccar_default`. Its recorded environment names include `ConnectionStrings__VehicleApp`, `VEHICLE_APP_BOUNCIE_ENCRYPTION_KEY`, and the old `VehicleApp__CredentialEncryption__*` key-ring names; the recorded connection string points to `vehicle_app`, but that database is absent from the server. The server instead has `traccar_scope_api` and upstream `traccar`, both owned by `traccar`. Exact `traccar_scope_api` counts are 2 vehicles, 7,277 trips, 2 telemetry profiles, 3 app users, 2 provider secrets, and 1 Bouncie credential. This is Limestone's inventory, separate from the earlier development baseline. The old checkout contains untracked backend/SQL work and must remain untouched. The Traccar and PostgreSQL containers use host bind mounts, not named volumes; PostgreSQL data is at `/home/dan/docker/traccar/postgres`, with 83 GB available on its filesystem. A custom-format backup of `traccar_scope_api` was created at `~/docker/vehicle-app/private-renaming-backups/traccar_scope_api_20261019_001403.dump` and validated successfully with `pg_restore --list` (21 MB). Its matching key-ring values were saved separately under the same protected backup directory. The dump was restored successfully into `traccar_scope_api_rename_validation_20261019`, and exact counts for users, vehicles, trips, telemetry profiles, provider secrets, Bouncie credentials, and system settings match the source. The disposable clone's exact queued-message counts are zero for `email_alert_outbox`, `sms_alert_outbox`, and `email_alert_manual_retries`. The user reports the connected Bouncie account expired and its credentials are no longer needed for validation. Because API startup automatically attempts a Bouncie token refresh when a stored row exists, the credential row was removed from this disposable clone only; the live database is unchanged.
- [x] Keep the current checkout location during implementation. Defer renaming the open workspace directory to the final cleanup step.

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
- [x] Rebuild disposable installations from scratch under the new name. The user reports successful completion of both `INSTALL_TRACCAR_SCOPE_ALONGSIDE_TRACCAR.md` and `INSTALL_FULL_STACK.md`, including tests on another machine and a test VM. Test-VM pathing issues on Limestone were resolved. The installer history includes the full-stack run (`11cdcdf`), progress and fail-fast fixes (`81ebeb3`, `55c1295`), noninteractive Compose checks (`6e7ebe1`), and later alongside-flow and initial-password refinements (`8aecf5c`, `354b1d6`, `9fb1aaf`). The earlier failures involving reused Compose volumes, missing role/database bootstrap, readiness checks, and path handling have therefore been exercised through successful clean installs after fixes.
- [x] Refresh generated installer helper files for the clean test installs; both documented installer paths completed successfully with the current renamed templates.
- [x] Use fresh credentials for fresh disposable installs and preserve the existing credentials/encryption key for retained application data. The installer now generates its initial admin password as three distinct four-letter words separated by periods, with each word capitalized; the user confirmed successful installation under the new naming convention.

- [x] Limestone production cutover (2026-10-19): production now runs the `traccar-scope-limestone` API and web Compose services on the existing `traccar_default` network. The API connects to `traccar-db` / `traccar_scope_api` with the original credential key ring; it has no published host port. The web container is published only at `127.0.0.1:8090`. Apache's `*:80` vhost proxies `/api/` to Traccar at `127.0.0.1:8082` and all other paths to the Docker web service; the old `/vehicle-api/` route and SPA rewrite fallback were removed. `apachectl configtest` reported `Syntax OK`; after reload, the site and both health routes returned HTTP 200. Through the actual Apache origin, the user confirmed login, past trips, Named Places, general settings, and users. The existing `/var/www/html` static files and a copy of the old Apache vhost remain available for rollback. After that verification, the old `vehicle-app-api` and temporary `traccar-scope-api-rename-validation` containers were removed; the production API and web containers remained up. Traccar, `traccar-db`, their bind-mounted data/config/log directories, the disposable validation database, and all database contents remain intact.
- [x] Before production cutover, create a new mode-600 custom-format backup at `~/docker/vehicle-app/private-renaming-backups/traccar_scope_api_pre_production_cutover_20261019_175239.dump` (21,755,786 bytes) and verify it with the database container's `pg_restore --list` (exit status 0). The first host-side `pg_restore` attempt failed because Limestone lacks a PostgreSQL client package; the container-side verification succeeded. Keep this backup private and do not delete it during cleanup.
- [x] Add an app-only Limestone Compose template, dedicated API Dockerfile, and Nginx proxy for both Traccar `/api/` and Scope `/traccar-scope-api/` routes. The Compose file has no database service or volume, joins the existing `traccar_default` network, keeps the API internal to Docker, and publishes the web service on `127.0.0.1:8090` for staging.
- [x] Deploy the Limestone application-only Compose project against existing `traccar-db` / `traccar_scope_api` with the original credential-encryption key ring. The protected runtime env file is `~/docker/vehicle-app/private-renaming-backups/traccar-scope-production-20261019_182510.env` (mode 600). A fresh pre-stage database backup was created at `~/docker/vehicle-app/private-renaming-backups/traccar_scope_api_pre_limestone_stage_20261019_182752.dump` (21,755,786 bytes) and validated using the database container's `pg_restore --list` (exit status 0). API schema initialization completed; Traccar health, Scope API health, auth status, and browser checks passed. Apache now routes site traffic to the Docker web while retaining its direct Traccar `/api/` proxy.

Checkpoint: all Compose files render and both install paths build from the new source. A changed name cannot cause a silent empty-database switch.

## 5. Update documentation and Wiki

- [x] Update the README, active docs, AI handoff, current work index, contribution/security/licensing descriptions, script examples, screenshots containing visible branding, and installation links. Keep the AGENTS workspace path accurate until the checkout leaf is renamed in section 7.
- [x] Update the Wiki page titles/slugs that contain the old app name and all inbound links, sidebar/Home entries, image URLs, repository blob/raw URLs, and clone instructions. Preserve accurate upstream Traccar references. The Wiki changes were published before the repository rename; verify the canonical Wiki URL and its links in section 7.
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
- [ ] Run restore preflight to the no-write boundary on an isolated target, including device mapping and database checks. Synthetic preflight coverage exists and stops before import, but a live target preflight has not been run. A full restore test, if used, belongs on a disposable target.
- [x] Exercise a fresh existing-Traccar installation using `INSTALL_TRACCAR_SCOPE_ALONGSIDE_TRACCAR.md`. The user reports successful completion on another machine and successful login/device visibility on the WSL test system. The latest `TalkingtoAI.md` inventory shows the app stack alongside a separately running Traccar stack.
- [x] Exercise a fresh combined Traccar Scope + Traccar installation using `INSTALL_FULL_STACK.md` under the new naming convention. The user reports successful completion. Pathing issues found on the Limestone test VM were fixed and the installation then completed successfully.
- [x] Confirm the final installer changes were exercised, including the capitalized three-word initial-admin password and test-VM path fixes. Git history shows the installer refinements and the user confirms successful runs of both installation guides.
- [x] Compare the preserved development counts with the baseline; all recorded counts match.
- [x] Confirm a saved shared Traccar password remains available after configuring the original key ring under the new configuration names. General settings returned HTTP 200 with `hasTraccarPassword: true`; no secret value was displayed.
- [x] Search again for old product spellings and classify the remaining matches. Matches are limited to this plan's source-to-target map, one-time database/browser migration inputs, tests proving prior settings are ignored, the still-current checkout path in `AGENTS.md`, and historical database identity in the handoff; no active UI labels, API routes, environment variables, executable project paths, or README/Wiki links remain.

## 7. Publish the rename and finish

- [x] Rename the existing GitHub repository to `Danvanf/Traccar-Scope`, preserving its history. The connected GitHub account confirmed the renamed repository exists on 2026-10-20.
- [ ] Update the local `origin` remote to `https://github.com/Danvanf/Traccar-Scope.git` and update the local Wiki checkout remote if present. The current app checkout still reports `https://github.com/danvanf/Traccar-React.git`; GitHub redirects may allow fetches, but local remotes should use the canonical URL.
- [x] Verify the published README and its repository-copy installation links against `Danvanf/Traccar-Scope`; the README and both referenced install guides are available from the renamed repository's `master` branch. The user reports fresh clones and successful runs of both installer entry points.
- [ ] Commit and publish the current `INSTALL_FULL_STACK.md` correction: its old introduction still says that a clean WSL install is pending, although the user has completed clean installs. Recheck the published guide after syncing.
- [ ] Verify the published Wiki URL, navigation, and images. The README's Wiki URL is present, but the Wiki pages could not be read through the available GitHub connector/browser tools in this session. Check badges, release assets, automation, and project-site configuration for any remaining old repository URL at the same time.
- [ ] Close the editor/dev processes as needed, rename only the checkout leaf directories to `traccar-scope` and `traccar-scope-wiki`, and reopen the actual repository root. The parent `Traccar` workspace need not be renamed. Retain the existing `Developement` directory spelling and update workspace tasks/launch settings that embed the old checkout path.
- [ ] Refresh the application from the reopened workspace, verify the new remote URLs, and clean up obsolete generated build output and stopped old app containers after checking ownership and retained volumes. Do not remove backups or database volumes as routine cleanup.
- [ ] Mark this plan complete, remove it from the active work index, and archive the completed plan with the validation results and any explicitly deferred VM check. Stop here; unrelated feature work and deployment redesign are outside this rename.

## Recovery and completion criteria

If validation fails before publication, stop the new application clients and return to the recorded code/configuration checkpoint and original database identity or verified backup. Restore matching environment names and the unchanged key ring together. Never run old and new copies concurrently against the same development database during recovery. Disposable test stacks can be rebuilt instead.

The rename is complete when Traccar Scope builds and runs, the retained development data and encrypted credentials work, current code/configuration/installers use one naming scheme, the GitHub repository and Wiki links use the new name, and fresh installation results are recorded accurately. No additional feature development is required to finish this plan.

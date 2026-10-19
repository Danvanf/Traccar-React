# Traccar Scope migration record

The development database cutover from the Traccar React API names to Traccar Scope was applied on 2026-10-18 (local time). The renamed API builds as `backend/TraccarScope.Api/TraccarScope.Api.csproj`. On the current Chrome app origin, `traccarScopeSettings` is present and `traccarReactSettings` is absent after the one-time helper ran. The next API launch still needs the existing encryption key ring under its renamed configuration names.

## Cutover record

1. The source database was `traccar_react_api` (314 MB), owned by `traccar`. The target database did not exist and there were no connected clients at preflight. The existing `traccar` role remains unchanged; no dedicated `traccar_react_api` role existed.
2. A PostgreSQL custom-format backup was created on limestone and successfully read by `pg_restore --list`. Keep that backup and the credential-encryption key ring secured outside Git.
3. The migration preserved the existing vehicle, trip, telemetry-profile, and app-user counts (2, 7,275, 2, and 3 respectively). It updated the shared General API URL to `/traccar-scope-api` and renamed the database to `traccar_scope_api`.
4. Preserve the current key ID and Base64 key exactly. The renamed API uses `TraccarScopeApi__CredentialEncryption__ActiveKeyId` and `TraccarScopeApi__CredentialEncryption__Keys__<id>`. Renaming configuration keys is not key rotation. The `vehicle-app:...` authenticated-encryption context strings in the code are part of the stored credential format and must remain unchanged.
5. The API connection string key is now `ConnectionStrings__TraccarScopeApi`; the old `ConnectionStrings__TraccarReactApi` key is not read by the renamed API. Set its database to `traccar_scope_api`, retaining the existing host, port, username, and password.

## Database result

The one-time helper is `scripts/migrate_traccar_scope_database.sql`. Its source database no longer exists after the successful rename; **do not rerun it**. The read-only preflight confirmed no name collision and no connected clients. The migration updated the General settings API URL in place and renamed `traccar_react_api` to `traccar_scope_api`, preserving rows, IDs, grants, and custom host settings. It did not rename the upstream Traccar database or shared `traccar` role.

## Preserve browser settings

The migration helper is `scripts/migrate_browser_settings_to_traccar_scope.js`. It moves `traccarReactSettings` to `traccarScopeSettings`, updates the API URL suffix, preserves the other settings including credentials, and removes the old key only after writing the new one. Browser storage belongs to an origin. The current Chrome app origin now reports the new key present and old key absent; values were not displayed. Other browser profiles/origins have not been checked.

## Start and verify

The API was started briefly with `ConnectionStrings__TraccarScopeApi` and the renamed database. `/health` returned `ok`, and `/api/vehicles` returned 2 vehicles. `/api/system-settings/general` returned 503 because the existing credential-encryption key ring was not present in that test process. The test API was stopped cleanly. Before the next start, set the original key ID and Base64 key under the new `TraccarScopeApi__CredentialEncryption__...` configuration names. Then verify Traccar access, General settings, and a saved encrypted provider credential. If a credential cannot be decrypted, stop and restore the original key configuration before changing or saving credentials.

After browser settings and encrypted credentials are verified, move this completed migration record to `docs/archive/project-plans` as directed by the [rename plan](TRACCAR_SCOPE_RENAMING_PLAN.md).

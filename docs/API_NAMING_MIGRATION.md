# Traccar Scope API naming and existing installations

The backend is now named **Traccar Scope API**. Use these names for new deployments:

| Item | Name |
| --- | --- |
| .NET project | `backend/TraccarScope.Api/TraccarScope.Api.csproj` |
| Published assembly | `traccar_scope_api.dll` |
| PostgreSQL database and dedicated application role | `traccar_scope_api` |
| Docker service and container | `traccar-scope-api` |
| Browser proxy prefix | `/traccar-scope-api` |
| .NET configuration section | `TraccarScopeApi` |
| Connection-string key | `ConnectionStrings__TraccarScopeApi` |
| Vite target override | `VITE_TRACCAR_SCOPE_API_TARGET` |
| Deployment guide | [Install Traccar Scope Manual Deployment](INSTALL_TRACCAR_SCOPE_MANUAL_DEPLOYMENT.md) |

The API still listens on port 5124 by default. Traccar remains a separate application and database.

## Fresh deployments

The combined PostgreSQL/Traccar/API deployment mounts `scripts/docker_init_traccar_scope_api_db.sh` under `/docker-entrypoint-initdb.d/` and the repository's scripts under `/traccar-scope-api-bootstrap/`. PostgreSQL creates the application role and database, installs the core schema and user/access schema, and only then starts its normal TCP listener. The database health check must use `pg_isready -h 127.0.0.1` so Compose waits for this initialization to finish before starting dependent services.

This initialization runs only for a new PostgreSQL data volume. A new application container over an existing volume does not rerun it. The API-only deployment guide assumes an existing application database; it does not initialize or rename the database container.

## Existing databases

Changing source files, configuration keys, or container names does **not** rename an existing PostgreSQL database. Back up the current application database, stop the API and any other clients using it, and run the supplied migration against the PostgreSQL server that holds the existing data. Keep PostgreSQL running.

For an existing Docker installation with a `traccar-db` PostgreSQL container, run from the updated repository checkout on the Linux server:

```bash
sudo docker exec -i traccar-db psql -U traccar -d postgres -v ON_ERROR_STOP=1 \
  < scripts/rename_legacy_api_database.sql
```

The script renames `vehicle_app` to `traccar_scope_api` and, when present, renames the dedicated `vehicle_app` login role too. It preserves rows and ownership links. It refuses to proceed when both names exist or clients are still connected, and never terminates sessions. It is safe to rerun after a successful rename. A database connection using the existing `traccar` login continues to use that login; only the dedicated application role changes.

Update deployment configuration before restarting:

```text
ConnectionStrings__TraccarScopeApi=Host=traccar-db;Port=5432;Database=traccar_scope_api;Username=traccar_scope_api;Password=YOUR_EXISTING_APPLICATION_PASSWORD
TraccarScopeApi__Auth__Username=YOUR_BOOTSTRAP_ADMIN
TraccarScopeApi__Auth__Password=YOUR_BOOTSTRAP_PASSWORD
TraccarScopeApi__CredentialEncryption__ActiveKeyId=YOUR_EXISTING_ACTIVE_KEY_ID
TraccarScopeApi__CredentialEncryption__Keys__primary=YOUR_EXISTING_BASE64_KEY
```

`ActiveKeyId` is the key's name, such as `primary`; it is not the encryption key itself. `Keys__primary` must contain the existing Base64-encoded encryption key, which must decode to exactly 32 bytes (256 bits). Copy that value unchanged from the old `VehicleApp__CredentialEncryption__Keys__primary` setting. Do not put the word `primary` in the key-value setting or generate a replacement during this migration, because stored credentials can only be decrypted with the original key.

Use the actual database login and active key ID for the installation. Preserve the existing encryption key value. The API no longer reads `VehicleApp:*`, `ConnectionStrings:VehicleApp`, or `VITE_VEHICLE_API_TARGET`; rename those settings to their `TraccarScopeApi` / `VITE_TRACCAR_SCOPE_API_TARGET` forms before starting it. Update Compose service names, image entrypoints, reverse-proxy paths, environment-file paths, service-management commands, backup jobs, and monitoring references. Recreate the renamed API service, removing the old service container from the same Compose project after it has stopped. Keep the database volume intact.

For the development machine, restart the API with:

```powershell
dotnet run --project .\backend\TraccarScope.Api\TraccarScope.Api.csproj --launch-profile http
```

Vite's development proxy forwards browser requests beginning with `/traccar-scope-api` to the API at `http://localhost:5124` and removes that prefix before forwarding. The repository's `vite.config.js` already has this route; you only need to change `VITE_TRACCAR_SCOPE_API_TARGET` if the API is hosted somewhere else. Restart Vite after changing that target. A response such as HTTP 503 from `/traccar-scope-api/...` means the request reached the API; check the API response/log for the cause. Sign in again because the cookie is now named `traccar_scope_api_session`.

## Existing data handled during the transition

- Saved browser and shared server settings migrate `vehicleApiBaseUrl` to `traccarScopeApiBaseUrl`, preserving custom hosts. The former `/vehicle-api` suffix becomes `/traccar-scope-api`.
- The deployment restore utility accepts only the current format: `traccar-scope-api/` ZIP entries, `includedTraccarScopeApiTables`, and `--traccar-scope-api-service`. It validates checksums and paths before import.
- The two v1 credential-encryption associated-data prefixes intentionally retain their original bytes. They are persisted format identifiers and are required to decrypt existing credentials with the same key.
- Obsolete tracked validation-build outputs have been removed from source control. Generated `bin_*` and `obj_*` folders are ignored.

The application code rename does not itself migrate a live database, restart services, or publish the application repository. Perform the database and deployment steps before restarting an existing installation against the new defaults.


## Current configuration after the rename

Use only variables listed in the current [API configuration guide](API_ENVIRONMENT_CONFIGURATION.md). Provider credentials and webhook secrets now come exclusively from accounts saved through Settings; do not rename or recreate old provider environment variables. The standalone Bouncie key, legacy environment aliases, and provider import path have been retired. Preserve the shared encryption key ring used by saved credentials.

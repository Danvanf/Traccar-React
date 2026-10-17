# Traccar React API naming and existing installations

The backend is now named **Traccar React API**. Use these names for new deployments:

| Item | Name |
| --- | --- |
| .NET project | `backend/TraccarReact.Api/TraccarReact.Api.csproj` |
| Published assembly | `traccar_react_api.dll` |
| PostgreSQL database and dedicated application role | `traccar_react_api` |
| Docker service and container | `traccar-react-api` |
| Browser proxy prefix | `/traccar-react-api` |
| .NET configuration section | `TraccarReactApi` |
| Connection-string key | `ConnectionStrings__TraccarReactApi` |
| Vite target override | `VITE_TRACCAR_REACT_API_TARGET` |
| Deployment guide | [Traccar React API deployment with Docker](../TRACCAR_REACT_API_DOCKER_DEPLOYMENT.md) |

The API still listens on port 5124 by default. Traccar remains a separate application and database.

## Fresh deployments

The combined PostgreSQL/Traccar/API deployment mounts `scripts/docker_init_traccar_react_api_db.sh` under `/docker-entrypoint-initdb.d/` and the repository's scripts under `/traccar-react-api-bootstrap/`. PostgreSQL creates the application role and database, installs the core schema and user/access schema, and only then starts its normal TCP listener. The database health check must use `pg_isready -h 127.0.0.1` so Compose waits for this initialization to finish before starting dependent services.

This initialization runs only for a new PostgreSQL data volume. A new application container over an existing volume does not rerun it. The API-only deployment guide assumes an existing application database; it does not initialize or rename the database container.

## Existing databases

Changing source files, configuration keys, or container names does **not** rename an existing PostgreSQL database. Back up the current application database, stop the API and any other clients using it, and run the supplied migration against the PostgreSQL server that holds the existing data. Keep PostgreSQL running.

For an existing Docker installation with a `traccar-db` PostgreSQL container, run from the updated repository checkout on the Linux server:

```bash
sudo docker exec -i traccar-db psql -U traccar -d postgres -v ON_ERROR_STOP=1 \
  < scripts/rename_legacy_api_database.sql
```

The script renames `vehicle_app` to `traccar_react_api` and, when present, renames the dedicated `vehicle_app` login role too. It preserves rows and ownership links. It refuses to proceed when both names exist or clients are still connected, and never terminates sessions. It is safe to rerun after a successful rename. A database connection using the existing `traccar` login continues to use that login; only the dedicated application role changes.

Update deployment configuration before restarting:

```text
ConnectionStrings__TraccarReactApi=Host=traccar-db;Port=5432;Database=traccar_react_api;Username=traccar_react_api;Password=YOUR_EXISTING_APPLICATION_PASSWORD
TraccarReactApi__Auth__Username=YOUR_BOOTSTRAP_ADMIN
TraccarReactApi__Auth__Password=YOUR_BOOTSTRAP_PASSWORD
TraccarReactApi__CredentialEncryption__ActiveKeyId=YOUR_EXISTING_ACTIVE_KEY_ID
TraccarReactApi__CredentialEncryption__Keys__primary=YOUR_EXISTING_KEY
```

Use the actual database login and key ID for the installation. Preserve the existing encryption key values. Update Compose service names, image entrypoints, reverse-proxy paths, environment-file paths, service-management commands, backup jobs, and monitoring references. Recreate the renamed API service, removing the old service container from the same Compose project after it has stopped. Keep the database volume intact.

For the development machine, restart the API with:

```powershell
dotnet run --project .\backend\TraccarReact.Api\TraccarReact.Api.csproj --launch-profile http
```

Restart Vite after changing its proxy configuration. Sign in again because the cookie is now named `traccar_react_api_session`.

## Compatibility retained during the transition

- Legacy `VehicleApp:*` and `ConnectionStrings:VehicleApp` configuration keys remain accepted. Provider priority is respected, and a new key wins over its legacy alias within the same provider. New environment examples use the new keys.
- Saved browser and shared server settings migrate `vehicleApiBaseUrl` to `traccarReactApiBaseUrl`, preserving custom hosts. The former `/vehicle-api` suffix becomes `/traccar-react-api`.
- New deployment exports use `traccar-react-api/` ZIP entries and `includedTraccarReactApiTables`. The restore utility also accepts the former `vehicle-app/` entries, manifest table-list name, and `--vehicleapp-service` option. Existing checksum and path validation still apply.
- The two v1 credential-encryption associated-data prefixes intentionally retain their original bytes. They are persisted format identifiers and are required to decrypt existing credentials with the same key.
- Obsolete tracked validation-build outputs have been removed from source control. Generated `bin_*` and `obj_*` folders are ignored.

The application code rename does not itself migrate a live database, restart services, or publish the application repository. Perform the database and deployment steps before restarting an existing installation against the new defaults.

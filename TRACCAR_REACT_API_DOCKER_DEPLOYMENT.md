# Traccar React API deployment with Docker

For an existing installation using the former API name, follow [API naming migration](docs/API_NAMING_MIGRATION.md) before restarting with the renamed database and project paths.

This guide deploys the Traccar React API alongside an **existing** Traccar and PostgreSQL installation. It does not replace, recreate, or migrate the existing Traccar containers or databases. The clean, same-machine WSL test installation is documented separately in the private `communications-plan/First_test.md` file outside this repository.

The API project currently targets .NET 9. .NET 9 support ends on November 10, 2026, so use this guide to reproduce the current build, and plan a move to a supported .NET release before using it for a long-lived production deployment. See Microsoft's [official .NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core).

The recommended production layout is:

```text
reverse proxy
  /              -> built React files
  /traccar-react-api/  -> traccar-react-api-api container
  /traccar-api/  -> Traccar, if needed

Docker network: traccar_default
  traccar
  traccar-db
  traccar-react-api-api
```

## 1. Inspect the existing Docker setup

On the Linux host:

```bash
cd ~/docker/traccar
sudo docker ps
sudo docker network ls
sudo docker inspect traccar --format '{{json .NetworkSettings.Networks}}'
sudo docker inspect traccar-db --format '{{json .NetworkSettings.Networks}}'
```

Both existing containers must share a Docker network. The network is commonly named `traccar_default`; use the actual name returned by the commands above.

Do not use `localhost` from inside the API container. Inside Docker, PostgreSQL is reached by its container name:

```text
Host=traccar-db;Port=5432;Database=traccar_react_api;Username=traccar;Password=...
```

The published host port `55432` is for clients outside Docker. It is not the API container's PostgreSQL port.

## 2. Put the repository on the Linux host

Clone or copy the repository to a stable location, for example:

```bash
mkdir -p ~/traccar-react-api
cd ~/traccar-react-api
git clone <repository-url> traccar-react
cd traccar-react
```

Keep the deployment checkout separate from `~/docker/traccar`. The API source can be updated and rebuilt without touching the Traccar compose directory. In the rest of this guide, the compose and environment files are in `~/traccar-react-api`, and the repository checkout is in `~/traccar-react-api/traccar-react`.

Using a different stable base folder is also valid. For example, this guide's commands work the same if you use:

```text
~/docker/traccar-react-api/
  traccar-react/
  traccar-react-api.compose.yml
  traccar-react-api.env
```

## 3. Add the API Dockerfile

Create `backend/TraccarReact.Api/Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY backend/TraccarReact.Api/TraccarReact.Api.csproj backend/TraccarReact.Api/
RUN dotnet restore backend/TraccarReact.Api/TraccarReact.Api.csproj
COPY backend/TraccarReact.Api/ backend/TraccarReact.Api/
RUN dotnet publish backend/TraccarReact.Api/TraccarReact.Api.csproj \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:5124
EXPOSE 5124
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "traccar_react_api.dll"]
```

The API listens on port `5124` inside the container. It does not need to be published directly to the internet when a reverse proxy is used.

## 4. Create a protected environment file

Create a file outside the repository at `~/traccar-react-api/traccar-react-api.env`:

```text
ConnectionStrings__TraccarReactApi=Host=traccar-db;Port=5432;Database=traccar_react_api;Username=traccar;Password=REPLACE_ME
TraccarReactApi__Auth__Username=REPLACE_ME
TraccarReactApi__Auth__Password=REPLACE_ME
TraccarReactApi__CredentialEncryption__ActiveKeyId=primary
TraccarReactApi__CredentialEncryption__Keys__primary=REPLACE_WITH_BASE64_32_BYTE_KEY
```

Protect it:

```bash
chmod 600 ~/traccar-react-api/traccar-react-api.env
```

If your deployment root is `~/docker/traccar-react-api`, keeping `traccar-react-api.env` there is fine as long as it remains outside Git and locked down with `chmod 600`.

The credential-encryption key must be the base64 encoding of exactly 32 random bytes. Generate one once and keep it stable:

```bash
openssl rand -base64 32
```

Changing or losing a key makes credentials encrypted with it unreadable. Do not put this file in Git, a Docker image, or a browser setting. The API creates the initial admin account from `TraccarReactApi__Auth__Username` and `TraccarReactApi__Auth__Password` when it first starts against a new database. After sign-in, manage normal accounts in Settings > Users and Groups; remove the bootstrap values after the first administrator has been created.

Device protocol diagnostics are optional tooling for profile development and support in a test environment. Production installations do not need a Traccar diagnostic account or these environment variables to run the application. When using the tool, configure `Traccar__BaseUrl`, `Traccar__Username`, and `Traccar__Password` only on the test API host, using a read-only Traccar account. The diagnostic endpoint is loopback-only and does not require a Traccar React API browser session. Run its PowerShell helper on the API host. For development outside Docker, use the reachable Traccar host URL (for example `http://limestone:8082`) instead of `http://traccar:8082`. The endpoint returns the Traccar version, device model/category, and at most 2,000 decoded telemetry samples from a requested 24-hour window. It excludes coordinates and device identifiers. It cannot return raw tracker packets or the tracker's AVL configuration.

From PowerShell on the API host, capture a sample with the script (the API process must have all three `Traccar__*` settings):

```powershell
./scripts/capture_device_protocol_diagnostics.ps1 `
  -DeviceId 5 `
  -FromUtc '2026-10-08T20:45:00Z' `
  -ThroughUtc '2026-10-08T21:15:00Z' `
  -OutputPath "$env:TEMP/fmm003-device-5-diagnostics.json"
```

The script calls the local Traccar React API, which authenticates to Traccar using its server-side configuration. It prints only the sanitized capture or the output file path, never the credentials.

## 5. Create the API compose file

Create `~/traccar-react-api/traccar-react-api.compose.yml` and replace `traccar_default` if your inspected network has a different name. Paths below are relative to the compose file directory, avoiding shell-specific `~` expansion inside YAML:

```yaml
services:
  traccar-react-api-api:
    build:
      context: ./traccar-react
      dockerfile: backend/TraccarReact.Api/Dockerfile
    container_name: traccar-react-api-api
    restart: unless-stopped
    env_file:
      - ./traccar-react-api.env
    environment:
      ASPNETCORE_ENVIRONMENT: Production
    expose:
      - "5124"
    networks:
      - traccar_default

networks:
  traccar_default:
    external: true
```

The API is exposed only to containers on the Docker network. If your reverse proxy runs directly on the Linux host, publish it on loopback instead by adding `ports: ["127.0.0.1:5124:5124"]`; do not bind this port to every interface. Start the API:

```bash
sudo docker compose -f ~/traccar-react-api/traccar-react-api.compose.yml up -d --build
sudo docker compose -f ~/traccar-react-api/traccar-react-api.compose.yml logs -f traccar-react-api-api
```

Use the same compose-file path for later updates, restarts, and shutdown commands. If you choose a different deployment root, change the paths consistently.

The first successful startup should show the API listening and completing its schema bootstrap. Leave the log view with `Ctrl+C`; that does not stop the container.

## 6. Apply additive database scripts

Back up `traccar_react_api` before applying a new schema script. Keep the backup/restore procedure in your private internal runbook.

Run only the migration scripts required by the database's current schema. These commands are for an existing `traccar_react_api` database and run from the repository checkout:

```bash
cd ~/traccar-react-api/traccar-react

sudo docker exec -i traccar-db psql -U traccar -d traccar_react_api \
  < scripts/phase7_trip_events_schema.sql

sudo docker exec -i traccar-db psql -U traccar -d traccar_react_api \
  < scripts/phase8_bouncie_import_schema.sql

sudo docker exec -i traccar-db psql -U traccar -d traccar_react_api \
  < scripts/phase9_bouncie_credentials.sql
```

Run the read-only audit afterward:

```bash
sudo docker exec -i traccar-db psql -U traccar -d traccar_react_api \
  < scripts/traccar_react_api_migration_status.sql
```

The migration scripts are additive and repeatable. Do not run the initial Phase 3 bootstrap against an existing production database.

## 7. Verify the API from the Linux host

If you published `5124:5124`, test from the host first:

```bash
curl -fsS http://127.0.0.1:5124/health
```

You can also test from inside the Docker network:

```bash
sudo docker run --rm --network traccar_default curlimages/curl:latest \
  -fsS http://traccar-react-api-api:5124/health
```

A healthy response confirms that the API can start and reach PostgreSQL. To inspect the service:

```bash
sudo docker ps
sudo docker logs --tail 100 traccar-react-api-api
```

## 8. Put a reverse proxy in front

For a usable browser deployment, build the frontend from the repository checkout (`npm ci && npm run build`, which writes `dist/`), serve those static files from Caddy or Nginx, and proxy `/traccar-react-api/` to:

```text
http://traccar-react-api-api:5124/
```

If the proxy is a container, it and the API must share the Docker network and the target above works. If the proxy runs on the Linux host, publish API port 5124 on `127.0.0.1` and use `http://127.0.0.1:5124/` as its upstream. Use HTTPS before exposing the application outside the trusted LAN. The HttpOnly session cookie and Bouncie OAuth callback should use the final HTTPS hostname.

Lightweight host check (what is already installed):

```bash
sudo systemctl is-active apache2
sudo systemctl is-active nginx
command -v caddy
```

Minimal reverse-proxy target for all options:

```text
/traccar-react-api/  ->  http://127.0.0.1:5124/
```

Example Apache vhost snippet:

```apache
ProxyPreserveHost On
ProxyPass /traccar-react-api/ http://127.0.0.1:5124/
ProxyPassReverse /traccar-react-api/ http://127.0.0.1:5124/
```

Example Nginx location snippet:

```nginx
location /traccar-react-api/ {
  proxy_pass http://127.0.0.1:5124/;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

If Apache is already installed and serving your host, use Apache first to keep deployment simple.

### Bundle and update device profile definitions

Built-in device profile JSON files live in `device-profiles/` in the repository. The React build automatically includes every JSON definition in that folder; see [`docs/DEVICE_PROTOCOL_PROFILES.md`](docs/DEVICE_PROTOCOL_PROFILES.md) for the authoring format. Include new profile JSON files in the checkout before building the frontend. Deploying the resulting frontend makes a new profile available in Vehicle Catalog without a separate API build, profile-file copy, or database migration. Existing local/shared definitions with the same ID are preserved. A profile must still be assigned to the intended vehicle.

Before production Bouncie use, the callback URL must be made configurable and registered with Bouncie. The current development callback is:

```text
http://localhost:5124/signin-bouncie
```

The production equivalent will be the public proxy URL, for example:

```text
https://vehicle.example.com/signin-bouncie
```

## 9. Updating the API later

From the deployment checkout, update the source and rebuild the API image:

```bash
cd ~/traccar-react-api/traccar-react
git pull
sudo docker compose -f ~/traccar-react-api/traccar-react-api.compose.yml up -d --build
sudo docker compose -f ~/traccar-react-api/traccar-react-api.compose.yml logs --tail 100 traccar-react-api-api
```

The database remains in `traccar-db`; rebuilding the API image does not delete application data. Keep a current PostgreSQL backup before schema changes.

## 10. Stop, restart, and remove only the API

```bash
sudo docker compose -f ~/traccar-react-api/traccar-react-api.compose.yml restart traccar-react-api-api
sudo docker compose -f ~/traccar-react-api/traccar-react-api.compose.yml stop traccar-react-api-api
sudo docker compose -f ~/traccar-react-api/traccar-react-api.compose.yml up -d traccar-react-api-api
```

To remove only the API container while preserving the database and Traccar:

```bash
sudo docker compose -f ~/traccar-react-api/traccar-react-api.compose.yml down
```

Do not use `docker compose down -v` for this deployment. Removing volumes is destructive.

## 11. First production login: required settings

After the API container and reverse proxy are working, open the app and confirm Settings before normal operations.

At minimum, verify these values:

- `API Base URL`: `/api` when your reverse proxy forwards this path to Traccar.
- `Traccar React API Base URL`: `/traccar-react-api` when your reverse proxy forwards this path to Traccar React API (`127.0.0.1:5124`).
- `Device Source`: `Traccar /devices (default)` unless you intentionally run from backend catalog mode.

If your reverse proxy does not provide these path mappings, set explicit absolute URLs instead:

- `API Base URL`: `http://<host>:8082/api`
- `Traccar React API Base URL`: `http://<host>:5124`

For first-run operations, also review:

- Vehicle Catalog entries (name, VIN, protocol profile, Traccar device assignment)
- Device Bindings (active mapping for each device)
- Bouncie OAuth redirect URL (must match your deployed hostname before connect/import)

Continue with the full settings walkthrough in:

- `docs/SETTINGS_CONFIGURATION_GUIDE.md`

## Telemetry share backup coverage

Telemetry share definitions and cached graph snapshots live in the `telemetry_shares`, `telemetry_share_trips`, `telemetry_share_series`, `telemetry_share_points`, and `telemetry_share_audit` tables in `traccar_react_api`. Normal PostgreSQL dumps include them automatically. Restore the database before starting the API so public links can resolve their snapshots. Raw share URLs are never stored, so a restored database preserves share definitions but cannot reconstruct a link token that was not retained by its owner.

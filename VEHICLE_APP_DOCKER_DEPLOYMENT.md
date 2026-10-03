# VehicleApp API deployment with Docker

This guide runs the VehicleApp API on the Linux host that already runs Traccar and PostgreSQL. It does not replace or recreate the existing Traccar containers.

The recommended production layout is:

```text
reverse proxy
  /              -> built React files
  /vehicle-api/  -> vehicle-app-api container
  /traccar-api/  -> Traccar, if needed

Docker network: traccar_default
  traccar
  traccar-db
  vehicle-app-api
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
Host=traccar-db;Port=5432;Database=vehicle_app;Username=traccar;Password=...
```

The published host port `55432` is for clients outside Docker. It is not the API container's PostgreSQL port.

## 2. Put the repository on the Linux host

Clone or copy the repository to a stable location, for example:

```bash
mkdir -p ~/vehicle-app
cd ~/vehicle-app
git clone <repository-url> traccar-react
cd traccar-react
```

Keep the deployment checkout separate from `~/docker/traccar`. The API source can be updated and rebuilt without touching the Traccar compose directory.

Using a different stable base folder is also valid. For example, this guide's commands work the same if you use:

```text
~/docker/vehicle-app/
  traccar-react/
  vehicle-app.compose.yml
  vehicle-app.env
```

## 3. Add the API Dockerfile

Create `backend/VehicleApp.Api/Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY backend/VehicleApp.Api/VehicleApp.Api.csproj backend/VehicleApp.Api/
RUN dotnet restore backend/VehicleApp.Api/VehicleApp.Api.csproj
COPY backend/VehicleApp.Api/ backend/VehicleApp.Api/
RUN dotnet publish backend/VehicleApp.Api/VehicleApp.Api.csproj \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:5124
EXPOSE 5124
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "VehicleApp.Api.dll"]
```

The API listens on port `5124` inside the container. It does not need to be published directly to the internet when a reverse proxy is used.

## 4. Create a protected environment file

Create a file outside the repository, for example `~/vehicle-app/vehicle-app.env`:

```text
ConnectionStrings__VehicleApp=Host=traccar-db;Port=5432;Database=vehicle_app;Username=traccar;Password=REPLACE_ME
VEHICLE_APP_AUTH_USERNAME=REPLACE_ME
VEHICLE_APP_AUTH_PASSWORD=REPLACE_ME
VEHICLE_APP_BOUNCIE_ENCRYPTION_KEY=REPLACE_WITH_BASE64_32_BYTE_KEY
```

Protect it:

```bash
chmod 600 ~/vehicle-app/vehicle-app.env
```

If your deployment root is `~/docker/vehicle-app`, keeping `vehicle-app.env` there is fine as long as it remains outside Git and locked down with `chmod 600`.

The Bouncie encryption key must be the base64 encoding of exactly 32 random bytes. Generate one once and keep it stable:

```bash
openssl rand -base64 32
```

Changing that key makes previously encrypted Bouncie credentials unreadable. Do not put this file in Git, a Docker image, or a browser setting.

## 5. Create the API compose file

Create `~/vehicle-app/vehicle-app.compose.yml` and replace `traccar_default` if your inspected network has a different name:

```yaml
services:
  vehicle-app-api:
    build:
      context: ~/vehicle-app/traccar-react
      dockerfile: backend/VehicleApp.Api/Dockerfile
    container_name: vehicle-app-api
    restart: unless-stopped
    env_file:
      - ~/vehicle-app/vehicle-app.env
    environment:
      ASPNETCORE_ENVIRONMENT: Production
    ports:
      - 5124:5124
    expose:
      - "5124"
    networks:
      - traccar_default

networks:
  traccar_default:
    external: true
```

Start it:

```bash
sudo docker compose -f ~/vehicle-app/vehicle-app.compose.yml up -d --build
sudo docker compose -f ~/vehicle-app/vehicle-app.compose.yml logs -f vehicle-app-api
```

If you are using `~/docker/vehicle-app`, the equivalent command path is:

```bash
sudo docker compose -f ~/docker/vehicle-app/vehicle-app.compose.yml up -d --build
sudo docker compose -f ~/docker/vehicle-app/vehicle-app.compose.yml logs -f vehicle-app-api
```

Use that same compose-file path substitution in later sections (updates, restart, and shutdown commands).

The first successful startup should show the API listening and completing its schema bootstrap. Leave the log view with `Ctrl+C`; that does not stop the container.

## 6. Apply additive database scripts

Back up `vehicle_app` before applying a new schema script. Keep the backup/restore procedure in your private internal runbook.

Run scripts from the Linux host by streaming them into the existing database container:
Change to the traccar-react folder
```bash
cd traccar-react

sudo docker exec -i traccar-db psql -U traccar -d vehicle_app \
  < scripts/phase7_trip_events_schema.sql

sudo docker exec -i traccar-db psql -U traccar -d vehicle_app \
  < scripts/phase8_bouncie_import_schema.sql

sudo docker exec -i traccar-db psql -U traccar -d vehicle_app \
  < scripts/phase9_bouncie_credentials.sql
```

Run the read-only audit afterward:

```bash
sudo docker exec -i traccar-db psql -U traccar -d vehicle_app \
  < scripts/vehicle_app_migration_status.sql
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
  -fsS http://vehicle-app-api:5124/health
```

A healthy response confirms that the API can start and reach PostgreSQL. To inspect the service:

```bash
sudo docker ps
sudo docker logs --tail 100 vehicle-app-api
```

## 8. Put a reverse proxy in front

For a usable browser deployment, serve the built React files from Caddy or Nginx and proxy `/vehicle-api/` to:

```text
http://vehicle-app-api:5124/
```

The proxy and API must share the Docker network. Use HTTPS before exposing the application outside the trusted LAN. The HttpOnly session cookie and Bouncie OAuth callback should use the final HTTPS hostname.

Lightweight host check (what is already installed):

```bash
sudo systemctl is-active apache2
sudo systemctl is-active nginx
command -v caddy
```

Minimal reverse-proxy target for all options:

```text
/vehicle-api/  ->  http://127.0.0.1:5124/
```

Example Apache vhost snippet:

```apache
ProxyPreserveHost On
ProxyPass /vehicle-api/ http://127.0.0.1:5124/
ProxyPassReverse /vehicle-api/ http://127.0.0.1:5124/
```

Example Nginx location snippet:

```nginx
location /vehicle-api/ {
  proxy_pass http://127.0.0.1:5124/;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

If Apache is already installed and serving your host, use Apache first to keep deployment simple.

Before production Bouncie use, the callback URL must be made configurable and registered with Bouncie. The current development callback is:

```text
http://localhost:5124/signin-bouncie
```

The production equivalent will be the public proxy URL, for example:

```text
https://vehicle.example.com/signin-bouncie
```

## 9. Updating the API later

From the deployment checkout:

```bash
git pull
sudo docker compose -f ~/vehicle-app/vehicle-app.compose.yml up -d --build
sudo docker compose -f ~/vehicle-app/vehicle-app.compose.yml logs --tail 100 vehicle-app-api
```

The database remains in `traccar-db`; rebuilding the API image does not delete application data. Keep a current PostgreSQL backup before schema changes.

## 10. Stop, restart, and remove only the API

```bash
sudo docker compose -f ~/vehicle-app/vehicle-app.compose.yml restart vehicle-app-api
sudo docker compose -f ~/vehicle-app/vehicle-app.compose.yml stop vehicle-app-api
sudo docker compose -f ~/vehicle-app/vehicle-app.compose.yml up -d vehicle-app-api
```

To remove only the API container while preserving the database and Traccar:

```bash
sudo docker compose -f ~/vehicle-app/vehicle-app.compose.yml down
```

Do not use `docker compose down -v` for this deployment. Removing volumes is destructive.

## 11. First production login: required settings

After the API container and reverse proxy are working, open the app and confirm Settings before normal operations.

At minimum, verify these values:

- `API Base URL`: `/api` when your reverse proxy forwards this path to Traccar.
- `Vehicle API Base URL`: `/vehicle-api` when your reverse proxy forwards this path to VehicleApp API (`127.0.0.1:5124`).
- `Device Source`: `Traccar /devices (default)` unless you intentionally run from backend catalog mode.

If your reverse proxy does not provide these path mappings, set explicit absolute URLs instead:

- `API Base URL`: `http://<host>:8082/api`
- `Vehicle API Base URL`: `http://<host>:5124`

For first-run operations, also review:

- Vehicle Catalog entries (name, VIN, protocol profile, Traccar device assignment)
- Device Bindings (active mapping for each device)
- Bouncie OAuth redirect URL (must match your deployed hostname before connect/import)

Continue with the full settings walkthrough in:

- `docs/SETTINGS_CONFIGURATION_GUIDE.md`

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

The first successful startup should show the API listening and completing its schema bootstrap. Leave the log view with `Ctrl+C`; that does not stop the container.

## 6. Apply additive database scripts

Back up `vehicle_app` before applying a new schema script. Keep the backup/restore procedure in your private internal runbook.

Run scripts from the Linux host by streaming them into the existing database container:

```bash
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

Because the API port is only exposed inside the Docker network, test it from a temporary container on that network:

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

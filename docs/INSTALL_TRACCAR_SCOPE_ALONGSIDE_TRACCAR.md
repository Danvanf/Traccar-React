# Install Traccar Scope alongside an existing Traccar server

Use this installer when Traccar is already running and you want to add Traccar Scope without changing Traccar's container, database, or collected data. It installs a separate Traccar Scope API, web frontend, and isolated PostgreSQL/TimescaleDB container, then asks for the existing Traccar URL and account and saves the connection in encrypted application settings.

The script is intended for Ubuntu 24.04 under WSL 2 or a systemd-based Linux VM with Docker Engine and Compose v2. It binds the web service to `127.0.0.1` by default. On a remote VM, connect through an SSH tunnel; do not expose this HTTP-only setup directly to the public internet.

## Find the Traccar Docker network

`docker ps` shows container names and published ports, but it does not show the Docker networks those containers use. Inspect the running Traccar container instead. For example, the container in the sample output is named `traccar-traccar-1`:

```bash
sudo docker inspect traccar-traccar-1 \
  --format '{{range $network, $details := .NetworkSettings.Networks}}{{printf "%s (aliases: %v)\n" $network $details.Aliases}}{{end}}'
```

The output lists each attached network and the DNS aliases available on it. The installer checks running containers for the Traccar URL hostname and suggests the matching network. Compose commonly creates a name such as `traccar_default`. Press Enter to accept the suggested network or type a different existing network. If there are several candidates, the installer lists them. The hostname in the Traccar base URL must resolve on the selected network, commonly the `traccar` service alias (for example, `http://traccar:8082`).

If the container name differs, get the current name from the `NAMES` column of `sudo docker ps` and substitute it in the inspect command. To confirm the network exists, list Docker networks with `sudo docker network ls`.

## Before you start

- Traccar must already be reachable from Docker containers on the installation host.
- Have the Traccar base URL, username, and password ready. Use an account that can see the devices and positions the intended Traccar Scope users should access. The installer stores the password encrypted in the Traccar Scope database; it does not save it in `.env`.
- If Traccar runs in Docker on the same host, find its Docker network name before installing (see [Find the Traccar Docker network](#find-the-traccar-docker-network)). The installer connects the Traccar Scope API and web containers to that network. If Traccar is reached through a host-published port, use the `bridge` network and URL `http://host.docker.internal:8082` (adjust the port as needed).
- Install Docker Engine, the Compose v2 plugin, Git, curl, OpenSSL, and Python 3. On WSL, enable systemd and use Docker Engine inside the Ubuntu distribution. See the [Docker Ubuntu guide](https://docs.docker.com/engine/install/ubuntu/) and [Microsoft's WSL systemd guide](https://learn.microsoft.com/en-us/windows/wsl/systemd/).

## Install

From Ubuntu/WSL or Linux, clone this repository and run the installer:

```bash
mkdir -p ~/docker
git clone --branch master --single-branch \
  https://github.com/Danvanf/Traccar-Scope.git \
  ~/docker/traccar-scope
cd ~/docker/traccar-scope
bash scripts/install_traccar_scope.sh
```

The installer prompts for:

1. The Traccar base URL reachable from the Traccar Scope API container. Enter the server root, such as `http://traccar:8082` or `http://host.docker.internal:8082`; do not add `/api`.
2. A Traccar username and password.
3. The Traccar Docker network. The installer detects and suggests a network from the Traccar URL hostname and running containers; press Enter to accept it or enter a different network. If Traccar is reached through a host-published port, use `bridge` with `http://host.docker.internal:8082` (adjust the port as needed).

The installer generates the Traccar Scope administrator account, database password, and credential-encryption key; initializes the app schema automatically; builds and starts the services; then saves the Traccar connection through the administrator API and verifies the connection. No SQL command or manual settings step is needed.

The default application URL is [http://localhost:8089](http://localhost:8089). The installer prints the initial Traccar Scope administrator username and password once. It also prints the credential-encryption key: store it securely and back it up with the app database. Losing that key makes the saved Traccar password and other encrypted provider credentials unreadable. The private settings file is stored under `~/docker/traccar-scope-install/deploy/.env` with owner-only permissions.

The installer keeps its deployment files under `~/docker/traccar-scope-install/deploy` by default. Compose derives this installer's project name as `deploy` from that directory. Use that same project name and Compose file for later management commands. The current script does not choose a unique project name for a second copy, so run only one alongside installation per Docker engine unless the installer is first adjusted to give the other copy a distinct project name; named volumes and containers must remain isolated.

## Remote Linux VM access

The service binds to loopback by default. From your workstation, open an SSH tunnel:

```bash
ssh -L 8089:127.0.0.1:8089 linux-user@your-vm
```

Then open [http://localhost:8089](http://localhost:8089) locally. For a different loopback port, set `WEB_PORT` before running the installer, for example `WEB_PORT=8189 bash scripts/install_traccar_scope.sh`.

## Rebuild, inspect, and stop

The deployment files and private `.env` live at `~/docker/traccar-scope-install/deploy` by default. To rebuild after updating the Git checkout:

```bash
cd ~/docker/traccar-scope
git pull --ff-only
cd ~/docker/traccar-scope-install/deploy
sudo docker compose -p deploy --env-file .env up -d --build
sudo docker compose -p deploy --env-file .env ps
sudo docker compose -p deploy --env-file .env logs --tail 100 database traccar-scope-api web
```

To stop the app while preserving its database:

```bash
sudo docker compose -p deploy --env-file .env down
```

Do not add `-v` to `down` unless you intend to delete the Traccar Scope database. This deployment uses its own database container and volume, independent from Traccar's existing database.

## Limits

This installer does not configure Traccar devices, migrate Traccar history, set up TLS, open firewall ports, or configure public hosting. It verifies that Traccar Scope can authenticate to the supplied Traccar server and retrieve its server information. If the installer cannot reach Traccar, check the URL from the Docker network and the entered account's permissions, then correct the connection in **Settings > General**.

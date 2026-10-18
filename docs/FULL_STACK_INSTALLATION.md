# Automated first-test installation: Traccar + Traccar React

This guide installs Traccar, Traccar React, and both databases together with the repository's installer script. The script was tested on Ubuntu 24.04 under WSL 2. It is intended for a clean first-test system running Ubuntu with systemd and Docker Compose v2; other Linux distributions may need package or service-command adjustments.

This is an HTTP smoke-test installation. Both browser ports bind to the Linux host's loopback interface, no tracker ports are published, and the databases start empty. WSL makes the services available to a Windows browser through `localhost`. For a remote VM, use an SSH tunnel or another private forwarding method; do not expose this HTTP-only test stack directly to the public internet.

## 1. Prepare Linux and Docker

On WSL, use Ubuntu 24.04 in WSL 2. If systemd is not enabled, add this to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

Then run `wsl --shutdown` in Windows PowerShell and reopen Ubuntu. Check that `ps -p 1 -o comm=` prints `systemd`.

Install Docker Engine and its Compose plugin using Docker's [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). The installer expects a working `docker` CLI, Compose v2, `sudo`, and systemd. It also checks for Git, curl, jq, OpenSSL, and Python 3; install any missing tools with:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git jq openssl python3
```

Start Docker and verify the required tools:

```bash
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Choose one Docker Engine for the WSL distribution. If Docker Desktop integration and Docker Engine inside Ubuntu are both enabled, make sure the CLI is using the engine where you want this test stack to run.

## 2. Clone the repository and run the installer

Run these commands in the Ubuntu/Linux shell. The default install location is `~/docker/vehicle`:

```bash
mkdir -p ~/docker/vehicle
git clone --branch master --single-branch \
  https://github.com/Danvanf/Traccar-React.git \
  ~/docker/vehicle/traccar-react
cd ~/docker/vehicle/traccar-react
bash scripts/install_first_test_wsl.sh
```

The installer clones or fast-forwards the application checkout, prepares the Dockerfiles, Nginx configuration and Compose file from `scripts/installer-templates`, generates a private `.env` on a fresh install, builds the images, starts the complete stack, and waits for both web health endpoints. It initializes the Traccar React database automatically; no SQL file needs to be run by hand.

The script keeps the deployment under `~/docker/vehicle` so Docker builds use the Linux filesystem. To use another location, set `INSTALL_ROOT` when running it and clone the repository into that location's `traccar-react` subdirectory:

```bash
export INSTALL_ROOT="$HOME/docker/vehicle-test"
mkdir -p "$INSTALL_ROOT"
git clone --branch master --single-branch \
  https://github.com/Danvanf/Traccar-React.git "$INSTALL_ROOT/traccar-react"
cd "$INSTALL_ROOT/traccar-react"
bash scripts/install_first_test_wsl.sh
```

## 3. Open the applications

When the script reports that installation is ready, use:

- Traccar React: [http://localhost:8089](http://localhost:8089)
- Traccar: [http://localhost:8092](http://localhost:8092)

The installer prints the initial Traccar React administrator username and password, plus database credentials and the API credential-encryption key. It also stores them in `~/docker/vehicle/deploy/.env` with owner-only permissions. Save the required credentials securely. The Traccar React login is separate from Traccar's first-user registration, which is handled by Traccar itself.

The generated first administrator follows the `FirstUser` plus five-digit millisecond suffix format. The initial password is made from three distinct four-letter words selected from the Solar System article, with periods between them and the first word capitalized. Database passwords and the API encryption key are generated from random bytes.

## What rerunning the installer does

The installer preserves an existing `.env` and Docker volumes. It fast-forwards a clean source checkout, and stops if tracked source changes or mismatched installer helper files need review. It also synchronizes the PostgreSQL role passwords with the retained `.env` before starting the application containers; this does not delete or recreate database data. On an existing application database, the bootstrap credentials do not reset an existing administrator's password.

The `.env` file is the source of truth for generated secrets. Back it up securely before moving or rebuilding the host. Do not commit it or share it in support logs.

## Check status and logs

```bash
cd ~/docker/vehicle/deploy
sudo docker compose --env-file .env ps
sudo docker compose --env-file .env logs --tail 100 \
  database traccar traccar-react-api-api web
```

The service URLs are local to the Linux host. From a Windows browser with WSL localhost forwarding, open the same `http://localhost` URLs. For a remote Linux VM, create a private SSH tunnel from your client, for example:

```bash
ssh -L 8089:127.0.0.1:8089 -L 8092:127.0.0.1:8092 linux-user@your-vm
```

Then open the same URLs on the client computer. This guide does not set up TLS, public firewall access, production backups, or tracker connectivity.

## References

- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Microsoft WSL systemd configuration](https://learn.microsoft.com/en-us/windows/wsl/systemd/)
- [Traccar](https://www.traccar.org/)

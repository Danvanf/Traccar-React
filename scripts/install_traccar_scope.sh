#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
INSTALL_ROOT="${INSTALL_ROOT:-$(dirname -- "$REPO_ROOT")/traccar-scope-install}"
DEPLOY_DIR="$INSTALL_ROOT/deploy"
ENV_FILE="$DEPLOY_DIR/.env"
COMPOSE_FILE="$DEPLOY_DIR/compose.yaml"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
note() { printf '\n==> %s\n' "$*"; }

for tool in curl openssl python3; do
  command -v "$tool" >/dev/null 2>&1 || die "Missing prerequisite: $tool. Install it and rerun this installer."
done
command -v docker >/dev/null 2>&1 || die 'Docker CLI is missing. Install Docker Engine and Compose v2 first.'
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 plugin is missing.'
command -v sudo >/dev/null 2>&1 || die 'sudo is required to start and manage Docker on this host.'
command -v systemctl >/dev/null 2>&1 || die 'systemd is required by this installer (Ubuntu on WSL 2 and common Linux VMs support it).'

[[ -f "$REPO_ROOT/backend/TraccarScope.Api/TraccarScope.Api.csproj" ]] || die 'Run this script from a Traccar Scope Git checkout.'
[[ -f "$REPO_ROOT/scripts/docker_init_traccar_scope_api_db.sh" ]] || die 'The Traccar Scope database initializer is missing.'

note 'Checking Docker access'
sudo -v
sudo systemctl start docker
sudo docker info >/dev/null || die 'Docker Engine is not available.'

mkdir -p "$DEPLOY_DIR"
chmod 0700 "$DEPLOY_DIR"

install_template() {
  local source="$SCRIPT_DIR/installer-templates/$1" target="$2"
  [[ -f "$source" ]] || die "Missing installer template: $source"
  if [[ -e "$target" ]]; then
    cmp -s "$source" "$target" || die "Existing helper differs from the installer template: $target. Review it manually; nothing was overwritten."
  else
    install -m 0644 "$source" "$target"
  fi
}

install_template compose.traccar-scope.yaml "$COMPOSE_FILE"

if [[ ! -e "$ENV_FILE" ]]; then
  note 'Configure the existing Traccar server'
  printf 'Enter the Traccar base URL reachable from Docker containers (for example http://host.docker.internal:8082 or http://traccar:8082). Do not append /api.\n'
  read -r -p 'Traccar base URL: ' traccar_server_url
  [[ -n "$traccar_server_url" ]] || die 'A Traccar server URL is required.'
  python3 - "$traccar_server_url" <<'PY' || die 'The Traccar URL must be an http:// or https:// URL without embedded credentials, a query, or a fragment.'
import sys
from urllib.parse import urlsplit
try:
    value = urlsplit(sys.argv[1])
    valid = value.scheme in ("http", "https") and bool(value.hostname) and value.port != 0 and value.username is None and value.password is None and not value.query and not value.fragment
except ValueError:
    valid = False
raise SystemExit(0 if valid else 1)
PY
  traccar_url_host="$(python3 - "$traccar_server_url" <<'PY'
import sys
from urllib.parse import urlsplit
print(urlsplit(sys.argv[1]).hostname or "")
PY
)"
  python3 - "$traccar_url_host" <<'PY' || die 'The Traccar URL cannot use localhost or a loopback address from inside Docker. Use a Docker service name such as http://traccar:8082 or http://host.docker.internal:8082.'
import ipaddress, sys
host = sys.argv[1].lower()
try:
    is_loopback = host == "localhost" or ipaddress.ip_address(host).is_loopback
except ValueError:
    is_loopback = host.endswith(".localhost")
raise SystemExit(1 if is_loopback else 0)
PY

  read -r -p 'Traccar username (use an account with access to the intended devices): ' traccar_username
  [[ -n "$traccar_username" ]] || die 'A Traccar username is required.'
  read -r -s -p 'Traccar password: ' traccar_password
  printf '\n'
  [[ -n "$traccar_password" ]] || die 'A Traccar password is required.'

  printf 'Detecting the Docker network for the Traccar URL host and running Traccar container...\n'
  traccar_docker_network_candidates="$(sudo docker inspect $(sudo docker ps -q) 2>/dev/null | python3 -c '
import json, sys
host = sys.argv[1].lower().rstrip(".")
try:
    containers = json.load(sys.stdin)
except Exception:
    containers = []
matched = set()
fallback = set()
for container in containers:
    networks = container.get("NetworkSettings", {}).get("Networks", {})
    aliases_by_network = {
        network: {str(alias).lower().rstrip(".") for alias in details.get("Aliases", [])}
        for network, details in networks.items()
    }
    if host and any(host in aliases for aliases in aliases_by_network.values()):
        matched.update(network for network, aliases in aliases_by_network.items() if host in aliases)
    name = container.get("Name", "").lstrip("/").lower()
    image = container.get("Config", {}).get("Image", "").lower()
    if ("traccar" in name and "scope" not in name) or image.startswith("traccar/"):
        fallback.update(networks)
for network in sorted(matched or fallback):
    print(network)
' "$traccar_url_host" || true)"
  detected_network_count="$(printf '%s\n' "$traccar_docker_network_candidates" | awk 'NF { count++ } END { print count+0 }')"
  detected_network="$(printf '%s\n' "$traccar_docker_network_candidates" | awk 'NF { print; exit }')"
  if (( detected_network_count > 1 )); then
    printf 'Found several candidate networks for Traccar:\n%s\n' "$traccar_docker_network_candidates"
    printf 'Enter the network the Scope API should use, or press Enter to use the first listed network.\n'
  elif [[ -n "$detected_network" ]]; then
    printf 'Found Traccar network: %s\n' "$detected_network"
  else
    printf 'No Traccar network was detected. Use "bridge" for a host-published URL such as http://host.docker.internal:8082.\n'
  fi
  network_default="${detected_network:-bridge}"
  read -r -p "Traccar Docker network [$network_default]: " traccar_docker_network
  traccar_docker_network="${traccar_docker_network:-$network_default}"
  [[ "$traccar_docker_network" =~ ^[A-Za-z0-9_.-]+$ ]] || die 'Invalid Docker network name.'
  sudo docker network inspect "$traccar_docker_network" >/dev/null 2>&1 || die "Docker network '$traccar_docker_network' does not exist on this host."

  note 'Creating isolated Traccar Scope credentials'
  timestamp_ms="$(date +%s%3N)"
  username_suffix="${timestamp_ms: -5}"
  [[ "$username_suffix" =~ ^[0-9]{5}$ ]] || die 'Could not read a millisecond timestamp to form the initial administrator username.'
  app_admin_username="FirstUser${username_suffix}"
  app_admin_password="$(openssl rand -base64 36 | tr -d '\n')"
  api_db_password="$(openssl rand -hex 32)"
  credential_key="$(openssl rand -base64 32 | tr -d '\n')"
  bind_address="${WEB_BIND_ADDRESS:-127.0.0.1}"
  web_port="${WEB_PORT:-8089}"
  python3 - "$bind_address" <<'PY' || die 'WEB_BIND_ADDRESS must be an IPv4 address (default 127.0.0.1).'
import ipaddress, sys
try:
    valid = ipaddress.ip_address(sys.argv[1]).version == 4
except ValueError:
    valid = False
raise SystemExit(0 if valid else 1)
PY
  [[ "$web_port" =~ ^[0-9]{1,5}$ ]] && (( web_port >= 1 && web_port <= 65535 )) || die 'WEB_PORT must be between 1 and 65535.'

  tmp_env="$(mktemp "$DEPLOY_DIR/.env.XXXXXX")"
  trap '[[ -z "${tmp_env:-}" ]] || rm -f -- "$tmp_env"' EXIT
  cat > "$tmp_env" <<EOF
TRACCAR_SCOPE_SOURCE_DIR=$REPO_ROOT
TRACCAR_SERVER_URL=$traccar_server_url
TRACCAR_SCOPE_API_DB_PASSWORD=$api_db_password
APP_ADMIN_USERNAME=$app_admin_username
APP_ADMIN_PASSWORD=$app_admin_password
TRACCAR_SCOPE_API_CREDENTIAL_KEY=$credential_key
WEB_BIND_ADDRESS=$bind_address
WEB_PORT=$web_port
TRACCAR_DOCKER_NETWORK=$traccar_docker_network
EOF
  chmod 0600 "$tmp_env"
  [[ ! -e "$ENV_FILE" ]] || die "$ENV_FILE appeared while configuration was being saved; refusing to overwrite it."
  mv -- "$tmp_env" "$ENV_FILE"
  tmp_env=""

  sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
  note 'Building and starting Traccar Scope'
  sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

  probe_address="$bind_address"
  [[ "$probe_address" != '0.0.0.0' ]] || probe_address='127.0.0.1'
  web_base="http://${probe_address}:${web_port}"
  wait_for_url() {
    local url="$1" attempts
    for attempts in $(seq 1 90); do
      if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then return 0; fi
      sleep 2
    done
    return 1
  }
  wait_for_url "$web_base/traccar-scope-api/health" || die 'Traccar Scope API did not become ready. Check container logs before retrying.'

  secret_dir="$(mktemp -d)"
  chmod 0700 "$secret_dir"
  trap 'rm -rf -- "$secret_dir"' EXIT
  export INSTALL_TRACCAR_USERNAME="$traccar_username" INSTALL_TRACCAR_PASSWORD="$traccar_password"
  export APP_ADMIN_USERNAME="$app_admin_username" APP_ADMIN_PASSWORD="$app_admin_password"
  python3 - "$secret_dir/login.json" "$secret_dir/settings.json" <<'PY'
import json, os, sys
with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump({"username": os.environ["APP_ADMIN_USERNAME"], "password": os.environ["APP_ADMIN_PASSWORD"]}, output)
with open(sys.argv[2], "w", encoding="utf-8") as output:
    json.dump({"apiBaseUrl": "/api", "traccarScopeApiBaseUrl": "/traccar-scope-api", "useBackendVehicleCatalog": False, "username": os.environ["INSTALL_TRACCAR_USERNAME"], "password": os.environ["INSTALL_TRACCAR_PASSWORD"], "pollIntervalMs": 5000, "realtimeHours": 3, "movementThresholdM": 20, "displayUnits": "imperial", "theme": "auto"}, output)
PY
  unset INSTALL_TRACCAR_USERNAME INSTALL_TRACCAR_PASSWORD APP_ADMIN_USERNAME APP_ADMIN_PASSWORD traccar_password

  note 'Saving the Traccar connection in encrypted application settings'
  curl -fsS --max-time 15 -c "$secret_dir/cookies.txt" \
    -H 'Content-Type: application/json' --data-binary "@$secret_dir/login.json" \
    "$web_base/traccar-scope-api/auth/login" >/dev/null \
    || die 'Could not authenticate to the new Traccar Scope administrator account.'
  settings_code="$(curl -sS --max-time 20 -o "$secret_dir/settings-result.txt" -w '%{http_code}' \
    -b "$secret_dir/cookies.txt" -X PUT -H 'Content-Type: application/json' \
    --data-binary "@$secret_dir/settings.json" "$web_base/traccar-scope-api/api/admin/system-settings/general")"
  [[ "$settings_code" == '204' ]] || die "Could not save the Traccar connection settings (HTTP $settings_code). Check encryption-key configuration and API logs."

  printf '\nTraccar Scope is installed; checking its saved Traccar connection now.\n'
  if [[ "$bind_address" == '0.0.0.0' ]]; then
    printf 'Application:      http://<server-address>:%s\n' "$web_port"
  else
    printf 'Application:      http://%s:%s\n' "$bind_address" "$web_port"
  fi
  printf 'Traccar URL:       %s\n' "$traccar_server_url"
  printf 'Admin username:   %s\n' "$app_admin_username"
  printf 'Admin password:   %s\n' "$app_admin_password"
  printf 'API key ID:        install\n'
  printf 'API encryption key: %s\n' "$credential_key"
  printf 'Private settings: %s (permissions 600)\n' "$ENV_FILE"
  printf 'Keep the password and encryption key in a secure password manager. Back up the key with the database.\n'
  printf 'Traccar credentials were saved encrypted in the Traccar Scope database and were not written to .env.\n'
  curl -fsS --max-time 20 -b "$secret_dir/cookies.txt" \
    "$web_base/traccar-scope-api/api/traccar/server" > "$secret_dir/traccar-server.json" \
    || die 'Traccar Scope is running, but the supplied Traccar URL/account did not pass the connection check. Use the printed admin login to correct Settings > General.'
  printf 'Traccar connection verified.\n'
  if [[ "$bind_address" == '127.0.0.1' ]]; then
    printf 'Remote VM access: use an SSH tunnel: ssh -L %s:127.0.0.1:%s linux-user@your-vm\n' "$web_port" "$web_port"
  fi
else
  note 'Keeping existing install settings and database'
  sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
  sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build
  printf '\nExisting Traccar Scope installation restarted from the current checkout.\n'
  printf 'Application: http://%s:%s\n' "$(sed -n 's/^WEB_BIND_ADDRESS=//p' "$ENV_FILE" | head -n 1)" "$(sed -n 's/^WEB_PORT=//p' "$ENV_FILE" | head -n 1)"
  printf 'The existing Traccar connection and application settings were preserved.\n'
fi

sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

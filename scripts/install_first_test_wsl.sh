#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

REPO_URL="https://github.com/Danvanf/Traccar-Scope.git"
REPO_BRANCH="master"
DEFAULT_TRACCAR_VERSION="6.16.0"
WIKI_URL="https://en.wikipedia.org/api/rest_v1/page/summary/Solar_System"
INSTALL_ROOT="${INSTALL_ROOT:-$HOME/docker/traccar-scope-install}"
INSTALL_ROOT_NAME="$(basename -- "$INSTALL_ROOT" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+|-+$//g')"
INSTALL_ROOT_NAME="${INSTALL_ROOT_NAME:-install}"
if [[ "$INSTALL_ROOT_NAME" == traccar-scope-* ]]; then
  COMPOSE_PROJECT_NAME="$INSTALL_ROOT_NAME"
else
  COMPOSE_PROJECT_NAME="traccar-scope-$INSTALL_ROOT_NAME"
fi
SOURCE_DIR="$INSTALL_ROOT/traccar-scope"
DEPLOY_DIR="$INSTALL_ROOT/deploy"
ENV_FILE="$DEPLOY_DIR/.env"
TEMPLATE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/installer-templates"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
note() { printf '\n==> %s\n' "$*"; }

for tool in git curl jq openssl python3; do
  command -v "$tool" >/dev/null 2>&1 || die "Missing prerequisite: $tool. Install it in Ubuntu/WSL and run this installer again."
done
command -v docker >/dev/null 2>&1 || die 'Docker CLI is missing. Install/start Docker Engine inside this WSL distribution first.'
docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin is missing.'

note 'Starting Docker and checking sudo access'
sudo -v
sudo systemctl start docker
sudo docker info >/dev/null

mkdir -p "$INSTALL_ROOT" "$DEPLOY_DIR"

if [[ -d "$SOURCE_DIR/.git" ]]; then
  note 'Updating the existing source checkout without discarding tracked changes'
  [[ -z "$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no)" ]] \
    || die "Tracked source changes exist in $SOURCE_DIR. Commit, stash, or review them before updating."
  branch="$(git -C "$SOURCE_DIR" branch --show-current)"
  [[ -n "$branch" ]] || die 'The source checkout is detached at a commit; check it out to a branch before updating.'
  git -C "$SOURCE_DIR" fetch origin "$branch"
  git -C "$SOURCE_DIR" pull --ff-only origin "$branch"
elif [[ -e "$SOURCE_DIR" ]]; then
  die "$SOURCE_DIR exists but is not a Git checkout. Move or inspect it manually; the installer will not overwrite it."
else
  note 'Cloning the application source'
  git clone --branch "$REPO_BRANCH" --single-branch "$REPO_URL" "$SOURCE_DIR"
fi

[[ -f "$SOURCE_DIR/backend/TraccarScope.Api/TraccarScope.Api.csproj" ]] \
  || die 'The checkout does not contain backend/TraccarScope.Api/TraccarScope.Api.csproj. Update the published source before installing.'
[[ -f "$SOURCE_DIR/scripts/docker_init_traccar_scope_api_db.sh" ]] \
  || die 'The database initializer is missing from the source checkout.'
[[ -f "$TEMPLATE_DIR/compose.yaml" ]] || die "Installer templates are missing: $TEMPLATE_DIR"

install_template() {
  local name="$1" source="$TEMPLATE_DIR/$1" target="$2"
  [[ -f "$source" ]] || die "Missing installer template: $source"
  if [[ -e "$target" ]]; then
    cmp -s "$source" "$target" || die "Existing helper differs from the installer template: $target. Review it manually; nothing was overwritten."
    printf 'Keeping verified helper: %s\n' "$target"
  else
    install -m 0644 "$source" "$target"
    printf 'Created helper: %s\n' "$target"
  fi
}

note 'Installing local Docker helper files'
install_template Dockerfile.first-test-api "$SOURCE_DIR/Dockerfile.first-test-api"
install_template Dockerfile.first-test-web "$SOURCE_DIR/Dockerfile.first-test-web"
install_template nginx.first-test.conf "$SOURCE_DIR/nginx.first-test.conf"
install_template .dockerignore "$SOURCE_DIR/.dockerignore"
install_template compose.yaml "$DEPLOY_DIR/compose.yaml"

if [[ ! -e "$ENV_FILE" ]]; then
  note 'Generating first-install credentials from secure random bytes and a space-themed Wikipedia article'
  version="${TRACCAR_VERSION:-$DEFAULT_TRACCAR_VERSION}"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] \
    || die 'TRACCAR_VERSION must be a version such as 6.16.0.'

  timestamp_ms="$(date +%s%3N)"
  username_suffix="${timestamp_ms: -5}"
  [[ "$username_suffix" =~ ^[0-9]{5}$ ]] || die 'Could not read a millisecond timestamp to form the initial username.'
  admin_username="FirstUser${username_suffix}"

  admin_password="$(curl -fsSL --retry 2 --connect-timeout 10 \
    -A 'TraccarScopeFirstTestInstaller/1.0 (local WSL deployment)' "$WIKI_URL" |
    python3 -c 'import json,re,secrets,sys
data=json.load(sys.stdin)
words=[]
for word in re.findall(r"(?<![A-Za-z])[A-Za-z]{4}(?![A-Za-z])", data.get("extract", "")):
    normalized=word.lower()
    if normalized not in words:
        words.append(normalized)
if len(words) < 3:
    raise SystemExit("The Solar System article did not provide three distinct four-letter words.")
picked=secrets.SystemRandom().sample(words, 3)
print(picked[0].capitalize()+"."+picked[1]+"."+picked[2])')" \
    || die 'Could not generate the initial password from the Wikipedia Solar System article.'

  traccar_db_password="$(openssl rand -hex 24)"
  api_db_password="$(openssl rand -hex 24)"
  api_credential_key="$(openssl rand -base64 32 | tr -d '\n')"
  tmp_env="$(mktemp "$DEPLOY_DIR/.env.XXXXXX")"
  trap '[[ -z "${tmp_env:-}" ]] || rm -f -- "$tmp_env"' EXIT
  cat > "$tmp_env" <<EOF
TRACCAR_VERSION=$version
TRACCAR_DB_PASSWORD=$traccar_db_password
TRACCAR_SCOPE_API_DB_PASSWORD=$api_db_password
APP_ADMIN_USERNAME=$admin_username
APP_ADMIN_PASSWORD=$admin_password
TRACCAR_SCOPE_API_CREDENTIAL_KEY=$api_credential_key
EOF
  chmod 0600 "$tmp_env"
  [[ ! -e "$ENV_FILE" ]] || die "$ENV_FILE appeared while credentials were being generated; refusing to overwrite it."
  mv -- "$tmp_env" "$ENV_FILE"
  tmp_env=""
else
  note 'Keeping the existing .env and all existing credentials'
fi

env_value() {
  local name="$1"
  awk -F= -v key="$name" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

for name in TRACCAR_VERSION TRACCAR_DB_PASSWORD TRACCAR_SCOPE_API_DB_PASSWORD \
            APP_ADMIN_USERNAME APP_ADMIN_PASSWORD TRACCAR_SCOPE_API_CREDENTIAL_KEY; do
  [[ -n "$(env_value "$name")" ]] || die "$ENV_FILE is missing $name. Existing files are preserved; fill the missing value and rerun."
done
chmod 0600 "$ENV_FILE"

note 'Validating Compose and building/starting the services'
cd "$DEPLOY_DIR"
sudo docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env config --quiet

note 'Starting the database and aligning database-role passwords with the private .env'
sudo docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env up -d database
database_id="$(sudo -n docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env ps -q database)"
[[ -n "$database_id" ]] || die 'The database container was not created.'
database_health=''
for attempt in $(seq 1 60); do
  database_health="$(sudo -n docker inspect --format '{{.State.Health.Status}}' "$database_id" 2>/dev/null || true)"
  [[ "$database_health" == 'healthy' ]] && break
  sleep 2
done
[[ "$database_health" == 'healthy' ]] || die 'The database did not become healthy; inspect database logs before continuing.'

# The private .env is the source of truth. PostgreSQL's image only runs init
# scripts for a brand-new data volume. Reconcile the app role/database here as
# well so a volume initialized by an earlier Traccar-only test can be reused.
sudo docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env exec -T database \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<'SQL'
\getenv traccar_password POSTGRES_PASSWORD
\getenv api_password TRACCAR_SCOPE_API_DB_PASSWORD
ALTER ROLE traccar PASSWORD :'traccar_password';
SELECT format('CREATE ROLE traccar_scope_api LOGIN PASSWORD %L', :'api_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'traccar_scope_api')
\gexec
ALTER ROLE traccar_scope_api PASSWORD :'api_password';
SELECT 'CREATE DATABASE traccar_scope_api OWNER traccar_scope_api'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'traccar_scope_api')
\gexec
SQL

# An existing Traccar-only volume has no app schema. Bootstrap it once while
# leaving an already initialized application database and its rows untouched.
note 'Ensuring the PostgreSQL extension is installed'
sudo docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env exec -T --interactive=false database \
  psql -U traccar -d traccar_scope_api -v ON_ERROR_STOP=1 \
  --command='CREATE EXTENSION IF NOT EXISTS pgcrypto;'
note 'Checking whether the Traccar Scope database schema needs bootstrapping'
api_schema_ready="$(sudo -n docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env exec -T --interactive=false database \
  psql -U traccar_scope_api -d traccar_scope_api -At \
  --command="SELECT to_regclass('public.vehicles') IS NOT NULL AND to_regclass('public.app_users') IS NOT NULL;")"
printf 'Traccar Scope schema check result: %s\n' "$api_schema_ready"
if [[ "$api_schema_ready" != 't' ]]; then
  sudo docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env exec -T --interactive=false database \
    psql -U traccar_scope_api -d traccar_scope_api -v ON_ERROR_STOP=1 \
    --file=/traccar-scope-api-bootstrap/phase3_traccar_scope_api_tables.sql
  sudo docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env exec -T --interactive=false database \
    psql -U traccar_scope_api -d traccar_scope_api -v ON_ERROR_STOP=1 \
    --file=/traccar-scope-api-bootstrap/phase11_user_access_schema.sql
fi

note 'Building the API and web images with visible progress, then starting all services'
sudo docker compose --progress plain -p "$COMPOSE_PROJECT_NAME" --env-file .env up -d --build

wait_for_url() {
  local url="$1" attempt
  for attempt in $(seq 1 90); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      printf 'Ready: %s\n' "$url"
      return 0
    fi
    sleep 2
  done
  return 1
}

note 'Waiting for both browser-facing HTTP services'
wait_for_url 'http://127.0.0.1:8089/traccar-scope-api/health' \
  || die 'Traccar Scope API did not become ready. Inspect with: sudo docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env logs --tail 100 database traccar traccar-scope-api web'
wait_for_url 'http://127.0.0.1:8092/api/health' \
  || die 'Traccar did not become ready. Inspect with: sudo docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env logs --tail 100 database traccar traccar-scope-api web'

admin_username="$(env_value APP_ADMIN_USERNAME)"
admin_password="$(env_value APP_ADMIN_PASSWORD)"
traccar_db_password="$(env_value TRACCAR_DB_PASSWORD)"
api_db_password="$(env_value TRACCAR_SCOPE_API_DB_PASSWORD)"
api_credential_key="$(env_value TRACCAR_SCOPE_API_CREDENTIAL_KEY)"

printf '\nInstallation is ready.\n'
printf 'Traccar Scope: http://localhost:8089\n'
printf 'Traccar:       http://localhost:8092\n'
printf 'Traccar Scope initial admin username: %s\n' "$admin_username"
printf 'Traccar Scope initial admin password: %s\n' "$admin_password"
printf 'Traccar database password: %s\n' "$traccar_db_password"
printf 'Traccar Scope API database password: %s\n' "$api_db_password"
printf 'Traccar Scope API credential key ID: first-test\n'
printf 'Traccar Scope API credential key: %s\n' "$api_credential_key"
printf 'Credentials are also stored in %s (permissions 600). Back up that file securely.\n' "$ENV_FILE"
printf 'Traccar has a separate first-run registration; the Traccar Scope admin login does not sign in to Traccar.\n'
printf 'On reruns, existing credentials and database volumes are preserved; bootstrap admin values do not reset an existing account password.\n\n'
sudo docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env ps

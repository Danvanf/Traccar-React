#!/usr/bin/env bash
# Runs from the PostgreSQL image's docker-entrypoint-initdb.d on a fresh data volume.
set -Eeuo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=traccar_scope_api_password="$TRACCAR_SCOPE_API_DB_PASSWORD" \
  --set=ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE traccar_scope_api LOGIN PASSWORD :'traccar_scope_api_password';
CREATE DATABASE traccar_scope_api OWNER traccar_scope_api;
SQL

# pgcrypto is trusted on supported PostgreSQL versions, but install it as the
# database superuser so the runtime role never needs superuser privileges.
psql --username "$POSTGRES_USER" --dbname traccar_scope_api --set=ON_ERROR_STOP=1 \
  --command='CREATE EXTENSION IF NOT EXISTS pgcrypto;'

# Keep app-owned tables owned by the least-privilege application role.
psql --username traccar_scope_api --dbname traccar_scope_api --set=ON_ERROR_STOP=1 \
  --file=/traccar-scope-api-bootstrap/phase3_traccar_scope_api_tables.sql
psql --username traccar_scope_api --dbname traccar_scope_api --set=ON_ERROR_STOP=1 \
  --file=/traccar-scope-api-bootstrap/phase11_user_access_schema.sql
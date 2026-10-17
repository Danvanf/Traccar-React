#!/usr/bin/env bash
# Runs from the PostgreSQL image's docker-entrypoint-initdb.d on a fresh data volume.
set -Eeuo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=vehicle_app_password="$VEHICLE_APP_DB_PASSWORD" \
  --set=ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE vehicle_app LOGIN PASSWORD :'vehicle_app_password';
CREATE DATABASE vehicle_app OWNER vehicle_app;
SQL

# pgcrypto is trusted on supported PostgreSQL versions, but install it as the
# database superuser so the runtime role never needs superuser privileges.
psql --username "$POSTGRES_USER" --dbname vehicle_app --set=ON_ERROR_STOP=1 \
  --command='CREATE EXTENSION IF NOT EXISTS pgcrypto;'

# Keep app-owned tables owned by the least-privilege application role.
psql --username vehicle_app --dbname vehicle_app --set=ON_ERROR_STOP=1 \
  --file=/vehicle-app-bootstrap/phase3_vehicle_app_tables.sql
psql --username vehicle_app --dbname vehicle_app --set=ON_ERROR_STOP=1 \
  --file=/vehicle-app-bootstrap/phase11_user_access_schema.sql
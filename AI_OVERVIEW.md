# Traccar React Architecture and Status

This document is the public-facing architecture and status summary.

The internal implementation handoff/history has been moved to:
- private internal notes (excluded from the public repository)

## Scope

Traccar React is a React + Vite frontend with a .NET API and PostgreSQL-backed enrichment storage for trips, tags, notes, events, and imports.

## Current System Shape

- Frontend: React + Vite + Leaflet map UI.
- Backend: ASP.NET Core minimal API in `backend/VehicleApp.Api`.
- Databases:
  - Traccar database (raw telemetry source of truth).
  - `vehicle_app` database (application-owned derived/enrichment data).

## Key Implemented Capabilities

- Saved trip identity and replay-safe import behavior.
- Device-binding-aware trip assignment with effective-date support.
- Trip recalculation endpoint that preserves metadata identity.
- Named places, trip tags, and trip notes CRUD API support.
- DTC enrichment pipeline and monitoring scripts.
- Day summaries, event detection, and route/event overlays.
- Optional single-user authenticated API session (`/auth/login`).

## Operational Artifacts

- Health and diagnostics scripts in `scripts/`.
- Retention and growth runbooks:
  - private internal retention runbook
  - `scripts/phase6_daily_health.sql`
  - `scripts/phase6_growth_health.sql`
  - `scripts/phase6_maintenance_health.sql`
- Backup/restore runbook:
  - private internal backup/restore runbook
- Docker deployment guidance:
  - `VEHICLE_APP_DOCKER_DEPLOYMENT.md`

## Public vs Private Documentation

- Public-oriented docs:
  - `README.md`
  - `Traccar_PostgreSQL_Backend_Architecture_Update.md`
  - `docs/TELTONIKA_FMB003_DATA_CATALOG.md`
- Internal/handoff docs:
  - local internal handoff notes (excluded from this public tree)

## Public Readiness Review

See the markdown-only review and recommended split policy in:
- `docs/PUBLIC_REPO_READINESS_REVIEW_2026-10-01.md`

## Maintenance Note

Keep environment-specific hosts, ports, and credentials in local environment variables and deployment files, not in committed public-facing docs.

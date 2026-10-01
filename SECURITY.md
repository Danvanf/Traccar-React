# Security Policy

## Supported Scope

This repository contains:

- React frontend code (`src/`)
- .NET API code (`backend/VehicleApp.Api/`)
- SQL and operational scripts (`scripts/`)
- deployment documentation

Security reports are welcome for all of the above.

## Reporting a Vulnerability

Please do not open a public issue for a potential vulnerability.

Instead:

1. Open a private security advisory on GitHub for this repository, or
2. Contact the maintainers through a private channel and include:
   - affected component/file
   - impact summary
   - reproduction steps
   - proof-of-concept (if safe)
   - suggested mitigation (if known)

You should receive an acknowledgment within 5 business days.

## Response Process

- We will triage and validate the report.
- We may ask for additional reproduction detail.
- We will prepare a fix and coordinate disclosure timing.
- We will publish a changelog/security note when a fix is released.

## Secret Handling Requirements

Never commit secrets to this repository.

Examples:

- API credentials
- database passwords
- OAuth client secrets/tokens
- encryption keys

Use environment variables and deployment-only secret stores. Keep hostnames, ports, and credentials in local/deployment config rather than hardcoded public docs.

## Hardening Expectations

Contributors should preserve or improve existing safeguards:

- authenticated API access for non-local deployments
- input validation and error handling in API endpoints
- idempotent import/replay behavior for telemetry ingestion
- backup/restore and retention safety in operational scripts

## Disclosure Etiquette

Please avoid testing against systems you do not own or have explicit permission to assess.

Thank you for helping improve the security of this project.

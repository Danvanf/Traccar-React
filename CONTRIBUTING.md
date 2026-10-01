# Contributing

Thanks for contributing.

## License Notice

By submitting contributions, you agree your changes are provided under this
repository's AGPLv3 license terms. If you deploy modified AGPL-covered
components for users over a network, AGPLv3 requires making corresponding
source available to those users.

See `LICENSE` and `LICENSING.md` for details.

## Before You Start

1. Read `README.md` for project structure and workflows.
2. Keep secrets out of source control (see `SECURITY.md`).
3. Prefer small, focused pull requests.

## Development Setup

1. Install dependencies:
   - `npm install`
2. Run frontend in dev mode:
   - `npm run dev`
3. Build frontend:
   - `npm run build`
4. Run frontend tests:
   - `npm test`

For API development, use the .NET project in `backend/VehicleApp.Api` and keep connection strings and credentials in local environment variables.

## Code and Documentation Rules

- Keep changes minimal and task-focused.
- Do not mix unrelated refactors with feature/fix work.
- Update docs when behavior or operations change.
- Prefer markdown runbooks for operational steps over one-off chat notes.
- Avoid hardcoding private host/IP details in public docs.

## Pull Request Checklist

Before opening a PR, confirm:

1. Frontend build passes (`npm run build`).
2. Frontend tests pass (`npm test`).
3. Any affected API behavior is validated locally.
4. Docs are updated for user-visible or operational changes.
5. No secrets, tokens, passwords, or private keys are present.

## Commit Guidance

- Use clear commit messages that explain intent.
- Keep commits logically grouped.
- Include rationale in PR description when changing data flow, schema scripts, or retention/import logic.

## Issue Reporting

When filing issues, include:

- expected behavior
- actual behavior
- reproduction steps
- relevant logs/errors
- environment details (OS, browser, Node/.NET versions when relevant)

## Security Issues

Do not file public issues for vulnerabilities. Follow `SECURITY.md`.

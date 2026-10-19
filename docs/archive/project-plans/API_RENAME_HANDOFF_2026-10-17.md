> **Archived snapshot (2026-10-18).** Historical handoff snapshot. For the completed database cutover, see [the archived Traccar Scope API naming migration](API_NAMING_MIGRATION_2026-10-18.md). Use current installation guides for deployment.
>
> This file records the original project discussion and its status at that time. Verify claims and commands against the current code and documentation before reusing them.

# Traccar React API rename handoff — 2026-10-17

The source and documentation rename is complete in the development workspace. Main application changes are still local and uncommitted. The GitHub wiki was published separately at commit `ea488ffce6985d48d974a461155e25f8e7333e7f`.

Use `backend/TraccarReact.Api/TraccarReact.Api.csproj`, published assembly `traccar_react_api.dll`, database/application role `traccar_react_api`, configuration root `TraccarReactApi`, and service/proxy name `traccar-react-api`. The browser API prefix is `/traccar-react-api`. The frontend client is `src/lib/traccarReactApi.js`.

## Operational steps still required

- Review, commit, and publish the main repository changes before using a new GitHub clone for the WSL deployment test. A clone cannot contain these local changes until they are published.
- At the time this handoff was archived, the database rename was still pending. It has since been applied; the one-time procedure and result are recorded in [the archived migration note](API_NAMING_MIGRATION_2026-10-18.md). Do not rerun it.
- Fresh WSL installs use First_test.md (the private runbook remains outside the repository) under `~/docker/vehicle`. Its Compose setup automatically creates the renamed database and schema on a fresh PostgreSQL volume. Existing data volumes do not rerun first-install scripts.
- The user stopped the development API during the rename. The user-owned Vite server was used to verify the new field label and proxy URL. No API or Vite background server was started by this work.

## Validation completed

- API build and integration-test project build: zero warnings/errors. Database integration tests were not executed because the live database has not been migrated.
- JavaScript: 153 tests pass; production Vite build passes.
- Credentials/configuration/settings compatibility checks: 17 pass.
- Trip identity: 13 checks pass; Twilio mock API: 10 checks pass, with no SMS sent.
- Deployment restore: 7 tests pass, including old archive-path compatibility and full restore preflight stopping before any import.
- Initializer Bash syntax and Git whitespace checks pass. Lint completes with warnings and no errors.
- Chrome confirms the new API field label and URL. The replacement wiki screenshot is `images/16-general-redacted.jpg` and contains no account fields.

Old naming remains intentionally in explicit configuration/archive/settings compatibility readers, migration SQL, encryption v1 format identifiers, and their tests. Generated validation binaries and a tracked Python bytecode cache were removed from source paths, with copies retained under the ignored repository `.artifacts` folder. Reversible source/document backups and an exact rename manifest are there too.

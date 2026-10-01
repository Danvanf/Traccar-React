# Public Repo Readiness Review (2026-10-01)

## Scope

This review focuses on GitHub/public-release readiness with an emphasis on documentation safety, clarity, and maintainability.

## Findings (Ranked)

### High

1. Internal handoff content is mixed into repository-facing docs.
   - `AI_OVERVIEW.md` is written as session/handoff state and includes operator-session details and runtime specifics that are not suitable as public onboarding docs.
   - Risk: external readers cannot distinguish stable product docs from transient implementation notes.

2. Raw external UI markup snapshots were stored in planning notes.
   - `NEXT_TODO.md` previously contained large pasted HTML/CSS snippets and route examples from external UI pages.
   - Risk: copyright ambiguity, excessive noise, and difficult maintenance.

### Medium

3. Environment-specific infrastructure details were embedded in primary docs.
   - Prior docs contained private-LAN host/IP and port examples directly in `README.md`.
   - Risk: information exposure and fragile copy/paste commands for other environments.

4. Documentation authority is unclear.
   - Files cross-reference each other as the "current" or "primary" source, while simultaneously noting staleness.
   - Risk: contributors follow outdated instructions and waste time on conflicting guidance.

5. Public-repo governance docs were previously missing.
   - `SECURITY.md` and `CONTRIBUTING.md` have now been added.
   - `LICENSE` is now present and AGPLv3-aligned.
   - `LICENSING.md` was added for plain-language AGPL behavior guidance.

## Markdown Remediation Applied In This Pass

1. `README.md`
   - Replaced hardcoded network host examples with placeholders (for example `http://<traccar-host>:8082`).
   - Reworded deployment paragraphs to keep host/port details environment-local.
   - Removed a duplicated broken sentence fragment.

2. `NEXT_TODO.md`
   - Replaced pasted external markup block with a concise, maintainable requirement summary.

3. Public/private documentation split
   - `AI_OVERVIEW.md` is now a public-safe architecture/status summary.
   - Historical handoff content is preserved in local internal docs excluded from public publication.

4. Governance docs
   - Added `SECURITY.md` with private vulnerability reporting guidance.
   - Added `CONTRIBUTING.md` with setup/testing/PR expectations.
   - Added `LICENSING.md` to clarify AGPLv3 expectations for backend/network use.

5. Internal notes relocation
   - Root `NEXT_TODO.md` now points to internal planning content.
   - Full working checklist moved to local internal docs excluded from public publication.

## Recommended Public/Private Split

### Keep Public

- `README.md` (general setup and high-level workflows)
- `AI_OVERVIEW.md` (public architecture/status summary)
- `docs/TELTONIKA_FMB003_DATA_CATALOG.md`
- private internal runbooks (not published)
- `VEHICLE_APP_DOCKER_DEPLOYMENT.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `LICENSE`
- `LICENSING.md`

### Keep Private (or move to an internal docs channel)

- local internal handoff and roadmap docs (excluded from public publication)

## Next Recommended Actions

1. Keep public docs free of private host/IP/runtime-session details during future updates.

# Archived project plans and research

This folder preserves planning documents and work snapshots that informed the current implementation. These are historical records, not current task instructions. Older environment names, endpoint shapes, code snippets, or status claims can be stale; use the current source and documents linked below.

## Current work

- [Device protocol profile TODO](../../DEVICE_PROTOCOL_PROFILE_TODO.md) — remaining device mapping and verification work.
- [Telemetry discovery and focused field editing plan](../../TELEMETRY_DISCOVERY_AND_FIELD_EDITING_PLAN.md) — current implementation status, unresolved review items, and follow-up.
- [NEXT_TODO.md](../../../NEXT_TODO.md) — short index to active work.

## Archived plans and snapshots

| Archive file | Original location | Current disposition |
| --- | --- | --- |
| [Deployment test data transfer](DEPLOYMENT_TEST_DATA_TRANSFER.md) | docs/DEPLOYMENT_TEST_DATA_TRANSFER.md | Completed and verified end to end on 2026-10-20; source archive restored to the disposable Flyer5 installation and row counts/application behavior checked. |
| [Traccar Scope renaming plan](TRACCAR_SCOPE_RENAMING_PLAN.md) | docs/TRACCAR_SCOPE_RENAMING_PLAN.md | Completed 2026-10-20; includes the production cutover, install and restore validation, GitHub/Wiki rename, renamed local checkouts, and preserved legacy build snapshots. |
| [API rename handoff](API_RENAME_HANDOFF_2026-10-17.md) | communications-plan/API_RENAME_HANDOFF.md | Rename implementation completed; deployment and database migration notes preserved. |
| [Traccar Scope API naming migration](API_NAMING_MIGRATION_2026-10-18.md) | docs/API_NAMING_MIGRATION.md | One-time development database and browser settings migration; completed and verified after new key configuration and browser sign-in. Do not rerun the migration. |
| [Email and SMS plan](EMAIL_AND_SMS_PLAN_2026-10-09.md) | communications-plan/EMAIL_AND_SMS_PLAN.md | Checklist marked complete; its environment fallback guidance was later retired. |
| [Encrypted provider settings TODO](ENCRYPTED_PROVIDER_SETTINGS_TODO_2026-10-12.md) | communications-plan/ENCRYPTED_PROVIDER_SETTINGS_TODO.md | Closed as superseded by the final saved-account implementation; standalone Bouncie key compatibility was later removed. Its unchecked items are historical and are not outstanding tasks. |
| [PostgreSQL backend architecture update](Traccar_PostgreSQL_Backend_Architecture_Update_2026-09.md) | communications-plan/Traccar_PostgreSQL_Backend_Architecture_Update.md | Historical design and deployment closeout; the conditional TimescaleDB review remains open if growth or performance thresholds are reached. |
| [Earlier device profile TODO](DEVICE_PROTOCOL_PROFILE_TODO_pre-current.md) | AddingOtherDevices/DEVICE_PROTOCOL_PROFILE_TODO.md | Closed as superseded by the current profile and telemetry plans. Its unchecked items are historical and are not outstanding tasks. |
| [Early Teltonika catalog](TELTONIKA_FMM003_DATA_CATALOG_early-research.md) | AddingOtherDevices/TELTONIKA_FMB003_DATA_CATALOG.md | Early research snapshot; filename corrected and content superseded by current FMM003/FMM00A catalogs. |
| [Bouncie investigation](BOUNCIE_INVESTIGATION_2026-10-07.md) | Parent folder BOUNCIE_INVESTIGATION_2026-10-07.md | Closed without further support follow-up; the historical query-contract question was left unresolved and is not an active task. |
| [Device profile expansion progress](DEVICE_PROFILE_EXPANSION_PROGRESS_2026-10.md) | Parent folder DEVICE_PROFILE_EXPANSION_PROGRESS.md | Closed as a historical checkpoint; current profiles and research catalogs take precedence. Its unresolved research notes are historical, not active tasks from this snapshot. |
| [Output README session copy 1](AddingOtherDevices_Output_README1.md), [copy 2](AddingOtherDevices_Output_README2.md), [copy 3](AddingOtherDevices_Output_README3.md), [copy 4](AddingOtherDevices_Output_README4.md) | AddingOtherDevices/Output | Notes accompanying experimental profile and ledger outputs. |
| [Output test vectors](AddingOtherDevices_Output_TEST_VECTORS3.md) | AddingOtherDevices/Output/TEST_VECTORS3.md | Historical test-vector notes. |

| [Field ledger 1](AddingOtherDevices_Output_field-ledger1.csv), [ledger 2](AddingOtherDevices_Output_field-ledger2.csv), [ledger 3](AddingOtherDevices_Output_field-ledger3.csv), [ledger 4](AddingOtherDevices_Output_field-ledger4.csv) | AddingOtherDevices/Output/field-ledger*.csv | Research evidence and caveats for candidate device fields; illustrative values are not live device samples. |\n\n## Kept outside the archive

communications-plan/First_test.md remains in the private parent folder as the WSL installation runbook, per the earlier instruction to keep that deployment document out of GitHub. Its installer script and templates are operational files rather than planning notes. Non-Markdown files in AddingOtherDevices (older source snapshots, profile JSON, and ZIP outputs) were left in place; they were not part of this document move. Compare any desired profile change with the current bundled files before adopting it.

The output folder contained duplicate README content: copies 1 and 4 matched, as did copies 2 and 3, when inventoried. All four originals are retained here because their filenames identify the session outputs that referenced them.

Personal workstation names, private hostnames/IPs, vehicle nicknames, and the partial device identifier were removed from the archived investigation snapshots. The technical findings and uncertainty notes remain.

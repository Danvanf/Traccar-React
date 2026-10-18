> **Archived snapshot (2026-10-18).** Historical checklist superseded by the saved provider-account/key-ring implementation. It describes the old standalone Bouncie encryption key, which has since been removed.
>
> This file records the original project discussion and its status at that time. Verify claims and commands against the current code and documentation before reusing them.

# Encrypted provider settings — developer TODO

Status: Core implementation is present. See the progress snapshot below for completed checks and remaining acceptance work (updated 2026-10-12).

Repository: `../traccar-react`, relative to this document.

## Progress snapshot — 2026-10-12

Implemented in the repository:

- Shared AES-GCM credential protection, purpose/account binding, key IDs, and active-key writes.
- Database provider accounts, encrypted secret storage, administrator APIs, revision checks, audit records, defaults, and vehicle assignments.
- Graph and Twilio account Settings, live account resolution, provider readiness/connection checks, and queued account identity handling.
- Explicit legacy provider import and Bouncie legacy-format migration support.
- Administrator-only, batched provider-secret key rotation at `POST /api/admin/provider-accounts/rotate-credentials`, with rotation instructions in the repository README.

Verification completed:

- API build: passed with 0 warnings and 0 errors after adding the rotation endpoint.
- Frontend production build: passed; Vite reported only its existing large-bundle advisory.
- Credential protection harness: 11/11 passed, including key-ring read/write behavior and authenticated-data checks.
- Twilio mock harness: 10/10 passed; mocked HTTP only, no network request.
- Frontend suite: 69/69 passed after updating three stale Teltonika expectations (identifier strings, floating-point tolerance, and migrated identifier metadata).
- Current Graph account readiness reports `ready: true` after the client secret was saved with the active key. No email or SMS was sent during these checks.
- Graph credential check: Microsoft Entra authenticated the saved credentials after key replacement. This did not verify Graph `Mail.Send` permission or the sender mailbox.

Still required before declaring the plan complete:

- Exercise provider-account CRUD, admin authorization, write-only secret behavior, conflicts, and transaction rollback against a disposable test database.
- Exercise key rotation against a disposable database containing old-key and active-key secrets, including interruption/retry, unreadable credentials, and more than one batch.
- Restore a database backup with its matching key ring in an isolated environment.
- Verify the Settings secret-preservation/replacement/clear flows and provider/vehicle account resolution in the browser.
- If desired, separately verify Graph `Mail.Send` permission and sender mailbox with an explicitly requested test email; the credential check does not send mail.
- Complete Bouncie migration checks on a disposable legacy fixture. The current installation's saved Bouncie credential cannot be authenticated with its configured key and is intentionally left disconnected; it does not block Graph or API startup.
- Review the deployment samples and README against final restart, fallback, rotation, and recovery behavior.

## Goal

Allow administrators to manage provider accounts and credentials in Settings, with changes taking effect without an API restart. Store credentials encrypted in PostgreSQL. Keep the installation's encryption keys outside PostgreSQL.

Start with Microsoft Graph, then Twilio. Preserve existing integrations and introduce vehicle-specific account selection after a default account works. Finish one milestone and its acceptance checks before starting the next.

## Decisions to follow

- HTTPS protects browser-to-API requests. Encrypt secrets on the API before persistence; do not send the installation encryption key to the browser.
- Use one shared server-side credential protection service. Use established .NET cryptography, not a new encryption algorithm.
- Provider accounts are named records with stable IDs. Separate their public configuration from their encrypted secrets.
- Provider account settings come from the database once an administrator selects that account. Existing environment configuration remains a compatibility fallback when no database account is selected.
- Never silently merge database credentials with environment credentials. An incomplete database account must report its missing settings.
- Ordinary settings, such as sender addresses, provider selection and limits, can be stored as ordinary database fields. Treat webhook passwords and tokens as secrets.
- Database credentials, installation encryption keys, API hosting settings and initial administrator bootstrap configuration remain deployment settings. Avoid making database access depend on reading a secret from that same database.
- App users' login passwords remain password hashes. Provider credentials must be recoverable for outbound API calls, so they require encryption instead.

## Current code to read first

These paths exist in the repository. Proposed new component and service names later in this document are suggestions.

| Area | Starting files |
| --- | --- |
| Hosting, authentication, database and registrations | `backend/TraccarReact.Api/Program.cs`, `TraccarReactApiAuthEndpoints.cs` |
| Existing credential encryption | `backend/TraccarReact.Api/BouncieRestService.cs`: constructor, `Protect`, `Unprotect`, credential persistence |
| Email provider configuration and delivery | `backend/TraccarReact.Api/EmailDeliveryService.cs`, `EmailDeliveryEndpoints.cs`, `EmailProviderWebhookEndpoints.cs` |
| Email alerts and sender settings | `backend/TraccarReact.Api/EmailAlertWorker.cs`, `EmailAlertEndpoints.cs`, `EmailAlertSchema.cs` |
| SMS provider configuration and delivery | `backend/TraccarReact.Api/SmsDeliveryService.cs`, `SmsDeliveryEndpoints.cs` |
| SMS alerts and webhook authentication | `backend/TraccarReact.Api/SmsAlertWorker.cs`, `SmsAlertWebhookEndpoints.cs`, `SmsAlertEndpoints.cs` |
| Settings UI and API client | `src/components/SettingsModal.jsx`, `EmailAlertsSettings.jsx`, `SmsAlertsSettings.jsx`, `SmsTestSettings.jsx`, `src/lib/traccarReactApi.js` |
| Deployment variables | `scripts/api-environment.sample.ps1`, `scripts/api-environment.sample.sh`, `README.md` |
| Existing SMS mock harness | `tests/TwilioSmsMagic.Tests` |

Important: Graph default and vehicle-specific sender mailbox settings already have API support. Preserve those records and their behavior. Bouncie already encrypts its stored credentials; preserve its existing ciphertext and key until migration is verified.

## Milestone 1 — inventory and design

- [ ] Read the files above and record which services read configuration at startup and which read it during requests or worker iterations.
- [ ] Inventory each supported provider's ordinary configuration and secret fields:
  - Graph: tenant ID and client ID; encrypted client secret. Sender mailbox remains a separate setting.
  - Resend: sender; encrypted API key and webhook secret.
  - Brevo: sender email/name; encrypted API key and webhook token.
  - Textbelt: encrypted API key.
  - Twilio: account SID and sending number; encrypted API key secret, webhook password and test auth token. Store API key SID, webhook username/base URL and test account SID as configuration. Keep test credentials separate from live credentials.
  - Bouncie: inspect the existing schema and persistence before deciding how to migrate client secret and OAuth tokens.
- [ ] Propose schema and API contracts in a short design note before implementing them.
- [ ] Define who can edit accounts. Start with administrators only and installation-wide accounts; leave room for future organization ownership without implementing multi-tenancy now.
- [ ] Define account precedence: selected vehicle account, otherwise installation default, otherwise legacy environment fallback only when no database account is selected.
- [ ] Define sender precedence independently from credential account selection, preserving existing vehicle sender overrides.
- [ ] Separate provider-wide limits from account and user limits. Adding accounts must not accidentally multiply the existing installation sending allowance.

Acceptance: another developer can explain where every setting lives and which account a vehicle uses without reading implementation code.

## Milestone 2 — shared credential protection

- [ ] Add a server-only service, for example `CredentialProtectionService`, with purpose-aware protect/unprotect methods.
- [ ] Define deployment configuration for a general credential key ring and active key ID. Document exact variable names when introduced; they do not exist yet.
- [ ] Use AES-256-GCM through .NET, with a fresh random nonce for each encryption and a 16-byte authentication tag.
- [ ] Store an envelope containing format version, key ID, nonce, ciphertext and authentication tag. Store no plaintext secret in the envelope.
- [ ] Bind the ciphertext to its provider account ID and secret field name using authenticated additional data. Swapping encrypted fields between accounts must fail authentication.
- [ ] Validate encryption keys as Base64-encoded 32-byte values. Never generate a replacement key automatically at startup.
- [ ] Missing or invalid keys must block secret writes and affected provider operations with a useful configuration error. Keep unrelated API functions available where practical.
- [ ] Keep previous keys readable during rotation; use only the active key for new writes.
- [ ] Keep the existing Bouncie encryption key and reader compatible. Do not reinterpret old Bouncie ciphertext as the new envelope format.
- [ ] Document separate backup of keys and database, and a restore procedure that pairs the correct keys with the database backup.

Acceptance checks:

- [ ] Round-trip succeeds; encrypting the same value twice produces different ciphertext.
- [ ] Modified ciphertext/tag, wrong key, wrong account ID and wrong field purpose fail safely.
- [ ] Old and new key IDs can both decrypt during rotation; unknown key IDs produce no secret-bearing error output.

## Milestone 3 — database records and account administration API

- [ ] Add an additive schema migration following the repository's existing schema conventions.
- [ ] Create provider account records: ID, name, provider, enabled state, public configuration, revision and timestamps.
- [ ] Create encrypted secret records associated with account ID and secret field name. Constrain field names and validate configuration against the selected provider.
- [ ] Add explicit installation-default and vehicle-account assignments. Keep sender overrides separate.
- [ ] Add administrator-only create, update, list and disable endpoints.
- [ ] Return secret presence metadata such as `clientSecretConfigured: true`; never return stored secrets or ciphertext to the UI.
- [ ] Define patch semantics explicitly: omitted secret means preserve; a submitted replacement means replace; an explicit clear action means remove. Mask text must never overwrite the secret.
- [ ] Encrypt before persistence and save account/secret changes in one transaction.
- [ ] Use a revision check for edits so one administrator cannot silently overwrite another's changes.
- [ ] Validate account references. Disable accounts initially; do not delete records referenced by assignments, queues or delivery history.
- [ ] Audit actor, account ID, changed field names and result. Do not record secret values or request bodies.
- [ ] Return safe errors; inspect logging and exception paths for accidental credential disclosure.

Acceptance: secrets are ciphertext in database rows, secrets never appear in response bodies or logs, and an unauthorized user cannot read or edit account configuration.

## Milestone 4 — Microsoft Graph Settings UI

- [ ] Add administrator account management in the existing Settings area.
- [ ] Offer account name, tenant ID and client ID, plus a password-style client secret replacement input.
- [ ] Display whether a secret is configured without returning its value.
- [ ] Add explicit save, replace-secret and clear-secret behavior. Keep secret input only in component memory and clear it after save or closing the form.
- [ ] Do not save credentials to localStorage, sessionStorage, URL parameters or browser console output.
- [ ] Show which account is the installation default and whether legacy environment configuration is currently being used.
- [ ] Preserve the existing Graph sender mailbox and vehicle sender controls.
- [ ] Add a connection/permissions check distinct from a send action. Document any provider call made by the check.
- [ ] Keep sending a test email a separate deliberate action with a chosen recipient.

Acceptance: an administrator can create and select a Graph account, replace its secret, and observe the saved configuration without restarting the API or reading the secret back.

## Milestone 5 — live account resolution and delivery

- [ ] Add a shared account resolver for requests and background workers. Refactor delivery services to accept resolved account configuration instead of reading provider credentials directly from environment configuration.
- [ ] Start with an installation default Graph account; retain the legacy environment fallback rules from Milestone 1.
- [ ] Ensure requests and workers see account edits without an API restart. Begin with fresh database reads; add caching only if needed and specify invalidation across API instances.
- [ ] Review the existing status/ready endpoints so they report the selected account and missing fields accurately.
- [ ] Review Graph token caching if introduced: cache per account and credential revision, and invalidate on replacement.
- [ ] Define queue behavior: bind a queued delivery to an account ID when queued, use that account's current credentials when sending, and preserve its resolved sender. Never silently reroute an existing queued message to a different default account.
- [ ] If its account is disabled or unavailable, retain a visible actionable failure/blocked state without bypassing authentication or falling back to another account.
- [ ] Preserve existing sending limits, retry rules and idempotency protections.
- [ ] Record the account ID with delivery history without exposing credentials.
- [ ] Add vehicle account selection after default account delivery is working.

Acceptance: two vehicles can select different Graph accounts; changing a default affects future queued work according to the documented rule; updating credentials affects subsequent sends without restart.

## Milestone 6 — Twilio and other providers

- [ ] Add Twilio account configuration and encrypted secrets using the same API and UI conventions.
- [ ] Preserve separation of live API-key credentials and Development-only test-account credentials.
- [ ] Resolve status callbacks and inbound webhook authentication against the appropriate account. Incoming webhook routes need an account identity; do not assume one global Twilio account.
- [ ] Preserve existing SMS verification, opt-out handling, delivery receipts and sending limits.
- [ ] Define webhook secret replacement behavior, including a controlled overlap period if needed for callbacks already in flight.
- [ ] Add Resend, Brevo and Textbelt through the same account model; use mocked provider responses for routine checks.
- [ ] Preserve provider-specific connection errors and readiness information in Settings.

Acceptance: provider selection, credentials and callbacks refer to the same account; editing one account cannot alter another account's delivery or webhook authentication.

## Milestone 7 — migration and Bouncie compatibility

- [ ] Provide an explicit administrator action to import supported legacy environment configuration into a database account. Do not import automatically on every startup.
- [ ] Never copy the installation encryption key, database password or bootstrap administrator password into provider-account records.
- [ ] Encrypt imported secrets immediately, avoid displaying them, and do not activate the imported account until validation and administrator selection are complete.
- [ ] Make import repeatable without duplicate accounts or overwriting newer credentials.
- [ ] Migrate existing Bouncie records separately: read using the old key/format, encrypt using the shared service, and update transactionally.
- [ ] Make Bouncie migration resumable and retain the old key until every old ciphertext record and restore path has been accounted for.
- [ ] Verify Bouncie reconnect, OAuth refresh and import resume after migration.
- [ ] Do not overwrite or remove environment configuration as part of database import. Document when operators can remove provider variables after successful validation.
- [ ] Update both environment sample scripts and README to identify installation essentials, optional legacy provider fallback settings and the new account-management workflow.

Acceptance: an existing installation can adopt database accounts without losing Bouncie access or provider configuration; a second migration run changes nothing unexpectedly.

## Milestone 8 — rotation, recovery and rollout

- [ ] Add a documented key rotation procedure: install new key alongside old keys, select it for new writes, re-encrypt existing records, verify coverage, and retire old keys only after considering retained backups.
- [ ] Make bulk re-encryption resumable, revision-aware and safe while administrators or token refresh jobs update credentials.
- [ ] Restore a database backup with its matching keys in an isolated environment and verify decryption without sending real messages.
- [ ] Document that lost encryption keys make encrypted credentials unrecoverable; recreating provider credentials may be necessary.
- [ ] Document which settings require an API restart (deployment keys/hosting) and which apply live (database accounts and assignments).
- [ ] Roll out Graph first, then Twilio, then remaining integrations. Capture observable account readiness and failures at each step.

## Required verification before completion

Use existing test conventions. Do not send real emails or texts as part of automated tests.

- [ ] Unit checks for encryption integrity, purpose binding and key rotation.
- [ ] API/database checks for authorization, write-only secret responses, transaction rollback and edit conflicts.
- [ ] Account-resolution checks for default/vehicle precedence, disabled accounts and incomplete database accounts without credential mixing.
- [ ] Worker checks for queued account identity, live credential replacement, limits and retry/idempotency behavior.
- [ ] UI checks for secret preservation/replacement/clear behavior and accurate selected account display.
- [ ] Migration checks covering repeated import, old Bouncie ciphertext, interrupted migration and backup restore.
- [x] A manual Graph connection check with administrator-provided credentials. A real send is a separate explicitly requested check; the saved credentials authenticated successfully on 2026-10-12.
- [ ] Documentation reviewed against the implemented schema, endpoints, variable names and actual restart behavior.

## Definition of done

An installer supplies database access and installation keys through deployment configuration. An administrator manages provider accounts through Settings. Secrets are encrypted before persistence and never returned to the UI. Vehicles and notification rules can choose accounts, account changes apply live, existing installations can migrate safely, and key rotation/restore instructions have been exercised.

## Progress handoff template

After each milestone, leave a short note here or in a linked progress document:

```text
Milestone:
Completed checklist items:
Files/schema/endpoints changed:
Checks run and results:
Compatibility or migration notes:
Remaining decisions/blockers:
Exact next checklist item:
```

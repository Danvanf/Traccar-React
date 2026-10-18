> **Archived snapshot (2026-10-18).** Implementation plan whose checklist was complete at capture time. Its environment-provider and account-less webhook instructions are retired; see the current Settings and API environment guides.
>
> This file records the original project discussion and its status at that time. Verify claims and commands against the current code and documentation before reusing them.

# Email and SMS delivery plan

Updated 2026-10-09. This folder is outside the `traccar-react` Git repository.

## Purpose

Let a self-hosted Traccar React API installation send useful trip and vehicle alerts to a small set of opted-in recipients. Keep delivery provider choice separate from alert generation, and keep provider secrets on the API host. Existing in-app notifications remain the source of event data.

## Provider choices for small installations

| Provider | Fit | Published free or baseline allowance | Notes |
| --- | --- | --- | --- |
| Microsoft Graph | An operator with a Microsoft 365 mailbox | Uses the operator's Microsoft 365 account; sending is subject to Exchange limits | Application `Mail.Send` can reach every mailbox if left unscoped. Use Exchange Online Application RBAC to scope the sending mailbox. |
| Resend | Simple transactional email API | 3,000 emails/month and 100/day on the free tier | Verified sending domain required for production. A good default for a DIY install with a domain. |
| Brevo | More daily email headroom | 300 emails/day on the free tier | Transactional email API and SMTP available; excess transactional mail may queue, subject to Brevo's limits. |
| Amazon SES | Very low pay-as-you-go cost | New-account credits and a limited introductory allowance; no permanent blanket free tier | More AWS setup. Add only if users request it. |
| Textbelt SMS | A personal experiment | `key=textbelt` allows one free text/day | Free allowance is for trying the API, not a reliable alert channel. Paid credits have no recurring billing according to Textbelt. Verify recipient consent and delivery expectations before production use. |
| Twilio SMS | Conventional US texting | $1.15/month for a US long code, plus SMS and carrier fees; A2P campaign monthly fees start at $1.50 or $2 depending on registration category | Registration and campaign vetting also have one-time fees. Actual base monthly cost exceeds $2 once number rental is included. |

Twilio Advanced Opt-Out can pass `OptOutType` values to an inbound webhook, and Twilio supports HTTPS Basic Authentication for webhook URLs. This API uses Basic Authentication rather than implementing Twilio signature validation because Twilio recommends its SDK validator and this project does not currently include the SDK. The Message resource supports delivery status callbacks. Sources: [Twilio Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out), [Twilio secure webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security), [Twilio Message status callbacks](https://www.twilio.com/docs/messaging/api/message-resource).

Prices and allowances can change. Confirm at signup. Provider sources: [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0), [Exchange application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac), [Resend pricing](https://resend.com/pricing), [Brevo free limit](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [Amazon SES](https://aws.amazon.com/ses/), [Textbelt](https://textbelt.com/), [Twilio SMS pricing](https://www.twilio.com/en-us/sms/pricing/us), [Twilio A2P fees](https://help.twilio.com/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service).

## Delivery sequence

1. **Provider plumbing (implemented).** Add an API-side email sender for Graph, Resend, and Brevo. Choose exactly one provider in configuration. Keep secrets in environment variables or a secret store. Add an admin-only status endpoint and an explicit admin test-send endpoint. Keep the default Graph sender and per-vehicle overrides editable in Settings.
2. **Alert preferences and outbox (implemented).** Add per-user email address verification, opt-in, event/vehicle selection, quiet hours, and an email outbox keyed by event plus recipient. Insert outbox entries transactionally when alert-worthy events are persisted, using a unique key to avoid duplicate messages from recalculation or import. A worker enforces daily caps, retries transient failures with backoff, and records provider responses without storing credentials or full bodies.
3. **Product controls (implemented).** Settings include sender setup guidance, recipients, alert types, test sends, daily caps, and delivery history. Provider acceptance is kept distinct from delivery confirmation.
4. **SMS alerts (implemented for Twilio).** A separate SMS preference flow requires explicit consent, phone verification, event/vehicle choices, daily caps, STOP/START handling, and delivery history. Textbelt remains restricted to administrator-requested test sends. SMS recipients are configured separately from email recipients.

## First slice configuration

Use `TraccarReactApi:Email:Provider` = `Disabled`, `Graph`, `Resend`, or `Brevo` (default `Disabled`). `TraccarReactApi:Email:DailyLimit` defaults to 75 accepted messages per UTC day across the installation. Each user can choose a lower daily limit from 1 to 50.

- Graph app credentials: `TraccarReactApi__Email__Graph__TenantId`, `TraccarReactApi__Email__Graph__ClientId`, and `TraccarReactApi__Email__Graph__ClientSecret`.
- Resend: `TraccarReactApi__Email__Resend__ApiKey`, `From`.
- Brevo: `TraccarReactApi__Email__Brevo__ApiKey`, `FromEmail`, optionally `FromName`.
- Resend delivery receipts: configure the webhook endpoint `https://<api-host>/api/email/webhooks/resend`, subscribe to `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`, then set `TraccarReactApi__Email__Resend__WebhookSecret` to the signing secret shown by Resend.
- Brevo delivery receipts: create a transactional webhook at `https://<api-host>/api/email/webhooks/brevo` with bearer authentication, then set `TraccarReactApi__Email__Brevo__WebhookToken` to the same secret bearer token. Subscribe to Delivered, Deferred, Soft Bounced, Hard Bounced, Spam, Invalid Email, Blocked, Error, and Unsubscribed events.

The API uses environment configuration for provider credentials. Never commit actual values. The default Graph sender mailbox is configured in Settings > Email Alerts; a vehicle can override it in Settings > Vehicle Catalog. Graph accepts a user ID or user principal name in `/users/{id | userPrincipalName}/sendMail`, so enter the mailbox address/UPN. The app must have permission to send from every configured mailbox. Prefer an Exchange Online Application RBAC assignment for `Application Mail.Send` scoped to allowed mailboxes, with no unscoped Microsoft Entra `Mail.Send` grant. Microsoft documents that Entra grants and Exchange RBAC grants are additive. If using an Entra application `Mail.Send` grant instead, configure an application access policy that restricts it to intended mailboxes. Confirm the mailbox and permission setup in the tenant.

After restarting the API, an administrator can call `GET /api/admin/email/status` to see the selected provider and missing setting names. `POST /api/admin/email/test-send` accepts JSON such as `{"to":"person@example.com","confirmSend":true}`; this sends a real message when the provider is configured. The endpoint allows three requests per ten minutes per caller and accepts optional `subject` and `body` strings.

For a test text, set the environment variable `TraccarReactApi__Sms__Provider` to `Textbelt` or `Twilio` (for example, in PowerShell: `$env:TraccarReactApi__Sms__Provider = "Twilio"`). Its .NET configuration key is `TraccarReactApi:Sms:Provider`; the default is `Disabled`. Set the environment variable `TraccarReactApi__Sms__DailyLimit` to the maximum accepted administrator test texts per UTC day; it defaults to 1. Textbelt needs `TraccarReactApi__Sms__Textbelt__ApiKey` (`textbelt` is the provider's one-free-text-per-day trial key). Twilio needs `TraccarReactApi__Sms__Twilio__AccountSid`, `TraccarReactApi__Sms__Twilio__ApiKeySid`, `TraccarReactApi__Sms__Twilio__ApiKeySecret`, and `TraccarReactApi__Sms__Twilio__FromNumber`. Automatic alerting is Twilio-only; Textbelt remains for admin-requested test texts. Set `TraccarReactApi__Sms__AlertDailyLimit` for the installation alert budget (default 25 per UTC day).

Set `TraccarReactApi__Sms__Twilio__WebhookBaseUrl` to the public HTTPS API origin, and `TraccarReactApi__Sms__Twilio__WebhookUsername` and `WebhookPassword` on the API host. In Twilio, configure the inbound-message URL as `https://<username>:<password>@<api-host>/api/sms/webhooks/twilio/inbound` with POST. Enable Advanced Opt-Out on the Messaging Service so STOP and START messages include `OptOutType`. The API adds an authenticated `/api/sms/webhooks/twilio/status` callback to automatic alert messages.

Users enable SMS alerts in Settings with explicit recurring-alert consent, an E.164 phone number, event and vehicle choices, and an eight-digit phone verification. Settings support up to 25 texts per user per UTC day (default five). The admin can use Settings > SMS Test or `GET /api/admin/sms/status` and `POST /api/admin/sms/test-send` with JSON `{"to":"+15551234567","confirmSend":true,"recipientConsentConfirmed":true}`. US application texting requires the appropriate Twilio sender registration. Provider acceptance is not proof of handset delivery.

## Operational rules

- Start disabled. An administrator must choose a provider and configure it before any send can occur.
- For Graph, keep tenant/client credentials on the API host. Store the default sender and optional per-vehicle sender mailbox in the database through the admin Settings UI; sender changes apply to subsequent queued sends without restarting the API.
- A user must save an alert email address, verify it with an eight-digit code, select event types, and enable alerts. The UI currently offers maximum speed, hard braking, hard acceleration, and long idle. An empty vehicle selection means all vehicles that user can access.
- Quiet hours are optional and use the recipient's selected time zone. Users can either skip events during quiet hours or hold them for a digest after quiet hours end. Digest events remain visible in delivery history; a digest consumes one daily email allowance.
- Only new event inserts occurring within the previous hour enqueue mail. Existing historical events are not backfilled. The worker discards immediate alerts after six hours and digest items after 48 hours. Items held by a daily cap are cancelled rather than sent later. API acceptance is shown as `accepted`, not as proof of inbox delivery.
- The current app writes many trip events when a trip is processed in the browser; this work sends those persisted events. A future server-side event detector is needed for alerts that fire independently of an open browser.
- The current daily cap is designed for a single API instance. Multiple API instances can race between counting accepted mail and sending; add a database reservation before deploying multiple workers.
- Outbox delivery records older than 90 days are removed automatically.
- Resend and Brevo webhook events are authenticated, deduplicated, and stored without raw request bodies or recipient content. Delivery history updates when a provider reports delivered, delayed, bounced, complained, failed, or suppressed. Provider event records are removed after 90 days. Graph sendMail is still displayed as provider accepted because this integration does not configure Graph delivery notifications.
- An administrator can queue a retry for an uncertain Graph alert or digest from Email Alerts after confirming the sender's Sent Items were checked. The action is limited to recent sends, records who requested it, and retries all rows in a digest together under a shared batch ID.
- The email outbox retains a stable event identity even if a calculated trip event is deleted and inserted again. Resend and Brevo receive a stable provider idempotency key on retries. A Graph attempt that was in flight when a worker stopped, or whose sendMail response may be uncertain, is marked failed for manual review instead of being sent again automatically. An operator should check the mailbox's Sent Items before considering another send.
- Use plain-text message bodies initially. Validate recipients and cap input lengths.
- Keep bearer tokens, API keys, and message bodies out of logs. Store generic failure reasons and provider HTTP status in the outbox for the recipient's delivery history.
- Apply per-user and installation-wide send budgets before dispatch, independent of the provider's advertised free allowance.
- Keep SMS optional. US A2P 10DLC costs include one-time brand/campaign vetting, monthly campaign registration, number rental, per-message provider charges, and carrier fees. A one-free-text trial is not a production notification design.
- Automatic SMS alerts require Twilio, a verified number, explicit opt-in, a selected event, and an active carrier opt-in. STOP disables the app preference; START clears the carrier opt-out but leaves the preference disabled until the user enables it again. Alert texts include STOP instructions, are limited to 320 characters, and are capped per user and installation. Inbound bodies are never retained. A Twilio send with an uncertain response is not retried automatically.

## Status

- [x] Research provider choices and record source links.
- [x] Provider-neutral API sender and admin-only configuration/test endpoints.
- [x] Outbox, alert preferences, verification, and worker.
- [x] Settings UI and basic delivery history.
- [x] Quiet-hour suppression.
- [x] Optional quiet-hours digest mode.
- [x] Stop automatic Graph retries after an uncertain send result or worker interruption.
- [x] Resend and Brevo authenticated delivery webhooks and delivery history updates.
- [x] Operator-reviewed retry flow for uncertain Graph alerts and digest batches.
- [x] Admin-only Textbelt/Twilio SMS test send with explicit consent confirmation and a daily cap.
- [x] Automatic Twilio SMS alerts with recipient opt-in, phone verification, STOP/START handling, delivery status, and daily limits.

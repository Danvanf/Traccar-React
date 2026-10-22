# Current work index

Active project plans and their unresolved items are maintained in the repository so future contributors can review them alongside the code. Historical planning snapshots are in [docs/archive/project-plans](docs/archive/project-plans/README.md).

## Active plans

- [Telemetry discovery and focused field editing](docs/TELEMETRY_DISCOVERY_AND_FIELD_EDITING_PLAN.md) — open implementation review items and multi-user verification.
- [Device protocol profiles](docs/DEVICE_PROTOCOL_PROFILE_TODO.md) — remaining mapping evidence and device profile follow-up.

Check the status near the top of each plan before starting work. Do not treat archived checklists as current.

## Overall checks and follow-up

Mobile layout implementation was closed by owner agreement on October 22, 2026. The checks below remain unverified or partially verified; they are follow-up work, not blockers for that completed task. Evidence and procedures remain in the [mobile acceptance walkthrough](docs/MOBILE_LAYOUT_ACCEPTANCE.md).

- [ ] Check real Android Chrome: safe areas, address-bar changes, keyboard, sheet scrolling, map gestures, and rotation. iPhone Safari and Chrome hands-on checks passed; retain those results and recheck if the layout changes.
- [ ] Complete spoken screen-reader acceptance, including focus order, visible focus, icon names, status alternatives, and announcements. Source/browser focus checks already exist.
- [ ] Observe live session expiration and sign-in recovery over normal multi-day use or in a controlled environment without the development authentication bypass. Isolated expiration/renewal and API-client recovery tests passed.
- [ ] Finish full-application adverse response-order checks across device/date selections and API-source changes. Controlled history-helper, trip-gate, and day-cache tests passed; full browser coverage remains open.
- [ ] Finish the combined long-name/many-trip/loading/empty/denied/API-failure/session-expiry matrix. Existing phone, browser, and automated results are recorded separately; do not repeat passing checks without a reason.
- [ ] Complete desktop regression for movable panels, map gestures, exports, public shares, graph editing, notes, and Settings.
- [ ] Profile network requests across layout transitions to confirm no duplicate fetches. Source and browser checks already observe one map and mutually exclusive feature mounts.
- [ ] Review user-facing product instructions/screenshots for any updates needed after mobile layout; installation behavior was not changed by this task.

## Post-mobile implementation work

- [x] Combined October 22, 2026: History and trip content in one panel named **Trips**, with months containing expandable days and each day containing its trips and a day graph icon, likely using the History frame; remove the obsolete Trips window and unused wiring. See the [recorded scope](docs/archive/project-plans/MOBILE_LAYOUT_IMPLEMENTATION_PLAN.md#deferred-final-follow-up--combine-history-and-trips).
- [x] Regular-user Settings now show display units, theme, personal Email Alerts, and SMS Alerts. Hide global connection controls, vehicle/profile configuration, named places, trip tags, Bouncie setup, and admin-only alert controls from the regular-user view. Authenticated administrator configuration is available at 1024px and wider; narrower screens show personal settings and a width notice. Backend authorization remains authoritative. Tested with the signed-in regular account in Chrome.

- [x] Reports are scoped to authorized vehicles; regular users retain the standard Usage Summary, Trip Log, Monthly Summary, Named Places, Data Completeness, Driving Events, Utilization Calendar, Business Mileage, Speed Bands, Racer, Vehicle Health, and Tracker Health reports. Hide Admin / Operations Reports from regular users; server route already requires admin. Checked the regular-user Chrome session.

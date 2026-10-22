# Mobile layout acceptance walkthrough

This is the hands-on companion to the [implementation tracker](archive/project-plans/MOBILE_LAYOUT_IMPLEMENTATION_PLAN.md). Record observed results, browser/device, and build; leave unperformed steps pending. The owner agreed on October 22, 2026 to close the mobile layout task and defer remaining checks to [the overall checklist](../NEXT_TODO.md#overall-checks-and-follow-up). Unperformed checks below remain unverified; completion does not turn them into passes.

## Current local evidence

- Latest validation: all 165 repository tests pass; production build passes; lint completes with existing warnings; diff whitespace check passes.
- Application/fixture viewport checks cover 320x568, 390x844, 768x1024, 844x390, and 1280x900.
- Layout source review: one map host; desktop and compact device/history/trip presentations are mutually exclusive. Profile, transfer, and graph each use the persistent task dialog. Layout components do not introduce API fetch owners.
- Chrome checks observe one Leaflet container and one DeviceList in each corresponding layout, and a connection live region outside the device button. Actual spoken announcements remain unverified.
- Existing request-gate/cache tests cover superseded trip completions and selected-day cache ordering. Full application adverse network ordering remains pending.

## 1. Reach the development build on iPhone

Use Safari while the phone and development computer are on the same local network. Open the temporary address supplied in chat. Do not use localhost on the phone: it refers to the phone itself. No App Store or Windows extension is required.

The temporary Vite server was authorized for 192.168.16.100:5511. It runs alongside the existing localhost:5510 server; it is not a production deployment. Firewall/router settings have not been changed. A connection timeout is a reachability result, not a layout failure; resolve it before checking layout.

Status: iPhone Safari reaches the temporary server; confirmed by the user.

## 2. iPhone Safari layout and touch

Use the existing non-admin test account to sign in directly in Safari. Do not send its password in chat. First establish the expected permitted device list from an existing account owner/admin view.

1. In portrait, open Devices, choose a permitted device, and confirm the header and status refer to it. Toggle visibility and restore it afterward.
2. Open Trips, choose a day and trip, and confirm details match. Try Expand, Reduce, and Map. Full sheet should stop map interaction; Map should restore it.
3. Pan and zoom the map, then use Resume map follow. The map should remain visible, controls should be tappable, and attribution should remain readable.
4. Open a graph and its field editor. Focus a description input to show the iPhone keyboard; scroll to its lower actions. Close should remain reachable. Close without changes, or discard only a temporary acceptance draft; do not save it.
5. Rotate between portrait and landscape with a sheet and graph open. Confirm graph choices remain, navigation is not clipped, and vertical scrolling stays within the active content.
6. Scroll so Safari's address/tool bars expand and collapse. Check the bottom navigation and home-indicator area remain usable.

Initial results: user confirmed permitted device list and device selection/header/status. An initial portrait navigation pass was superseded by subsequent missing-navigation reports in Safari and Chrome on iPhone; bottom navigation acceptance is reopened. Trip details, Expand, and Map were reported working. Report a specific failed step, or “iPhone layout/touch/keyboard pass” with the phone model and iOS version. iPad/Android remain separate unless explicitly deferred.

## 3. Non-admin permissions and errors

Use only existing test data and expected permissions. Do not grant privileges or create accounts for this check.

1. Compare Devices against the known permitted device list. Select each permitted device and a trip; verify unrelated devices do not appear.
2. Inspect More and Settings. Shared profile/admin writes must be unavailable to the ordinary user and remain enforced by the server. An absent button alone does not establish server enforcement.
3. With an account owner, use an existing known out-of-scope resource to check denial through an authorized test workflow. Expect a denied/permission response, no protected data, and no misleading empty-success result.
4. API failure and expiration require a controlled test session. Agree on the session and failure mechanism first; do not interrupt the primary admin session, edit authentication cookies, or change server-wide settings. Observe an explicit error/sign-in result and recovery, rather than silently replacing data with an empty result.

Status: user confirms the iPhone non-admin device list matches expected permissions, selecting a permitted device updates its header/status, and portrait bottom navigation is visible and tappable. Direct out-of-scope denial, server enforcement, and controlled expiration remain pending. Record outcomes without credentials, GPS coordinates, or private resource identifiers.

## 4. Native zoom and assistive technology

1. On desktop Chrome, use its native Zoom menu to set 200%; check Devices, Trips, More, and a task. Controls must remain reachable and text must reflow. Restore the original zoom afterward. Fixture doubled text does not replace this check.
2. On iPhone, use Safari Page Zoom or text controls, noting the actual setting. Check labels, navigation, task Close, and editor fields again.
3. With VoiceOver, navigate the header/device shortcut, bottom navigation, sheet actions, and task Close. Check names and selected/expanded states. Connection failure/recovery should produce a polite announcement; routine point timestamps should not repeatedly announce.

Status: native zoom and spoken assistive-technology acceptance pending.

## 5. Desktop regression and source review

Remaining desktop actions include moving/resizing panels, map gestures, a disposable notes/tag save-and-restore, export contents, and an existing public-share view. Use test data and an existing authorized share; do not publish a new share for this check. Restore moved panels and test edits to their prior values.

Profile/transfer/graph open/close and responsive state retention have already been checked. Final source review found no layout-owned API fetches or simultaneous duplicate feature render paths. Runtime request profiling under controlled slow/failure conditions remains pending.

## Results to record

For each group: pending / pass / fail; environment; observed behavior; issue/fix link; retest outcome. A failure remains open until corrected and rechecked. Physical iOS/Android, native zoom, permissions, and session expiry must not be inferred from desktop viewport results.
## Open iPhone navigation defect — October 21, 2026

User reports Safari bottom navigation is missing, Trips cannot reliably return to navigation, Chrome iPhone initially worked but navigation also disappeared after reload, and More is not visible. Trip details, Expand, and Map work. This is an open physical-device failure, not a passing viewport result.

Development diagnostics: append `?layoutDebug=1` to the temporary LAN URL and tap Layout info. Copy the read-only measurements to report viewport and navigation geometry; no account or GPS data is included. This is gated to development builds and the explicit query flag. Awaiting iPhone measurements and iOS/model details before choosing a viewport correction.

Compact map Fit/Resume now uses a 44px SVG icon with its existing accessible name and tooltip. Desktop Chrome fixture confirms all three map controls are 44x44; actual iPhone appearance remains pending. Latest 159 tests/build pass, lint exits 0 with warnings, and whitespace checks pass.
Phone snapshot: iPhone 16 Pro/iOS 26.6 reports a 402x714 viewport; navigation rectangle is 658–714, display:grid, visibility:visible, with picking=false and no task. The menu issue is therefore still open as a possible paint/occlusion problem rather than an established viewport-height defect. Diagnostics now include button hit tests and a reversible Try normal page positioning experiment. Awaiting actual-phone comparison; no production positioning change has been made.

Follow-up observation: the user now sees working bottom navigation in both iPhone Safari and Chrome and cannot reproduce its disappearance. Cause remains unconfirmed; awaiting whether recovery occurred before or after enabling the development positioning experiment. Keep the defect intermittent/open until reload, Trips transitions, browser-toolbar changes, and rotation pass under normal positioning without the diagnostics query.

Clarification: navigation returned before the user enabled Try normal page positioning. Recovery is not evidence for the normal-flow experiment; do not promote it to production. Next check the plain LAN URL without layoutDebug through fresh load/reload, Trips Expand/Map transitions, rotation, and Safari browser-toolbar changes.

Normal-URL follow-up: in response to the Safari plain-URL reload, Trips Expand/Map, and portrait/landscape checklist, the user reports that navigation remains visible on the base website. Record this as a user-reported pass of that sequence without the diagnostics query or positioning experiment. The earlier disappearance was not reproduced; its original cause remains unconfirmed. Continue keyboard/browser-chrome acceptance and reopen the defect if it recurs.

Keyboard follow-up: user confirms the graph field-editor inputs and Close controls remain reachable while opening/dismissing the iPhone keyboard and scrolling. Closing the editor and graph leaves bottom navigation available and the correct trip highlighted. No draft edit/save was requested. This passes the guided iPhone keyboard/close-return sequence; Android and spoken assistive-technology behavior remain unverified.

Long-list/zoom follow-up: user reports the guided checks pass in both iPhone Safari and Chrome. Long Trips lists scroll successfully; text/page zoom controls and pinch zoom permit access to all content; restoring zoom works. Returning to the top while pinch-zoomed needs a stronger flick, described by the user as expected and usable. No clipping/unreachable controls were reported in the guided toolbar/safe-area and zoom sequence. Exact 200% setting is awaiting clarification; do not infer it from pinch zoom. Desktop 200% and spoken VoiceOver acceptance remain separate.

Zoom clarification: user could not find a numeric zoom setting in either iPhone browser and used pinch zoom. Record pinch-zoom access/restoration as passed; the specific 200% text/page zoom criterion remains pending. A separate desktop percentage-based check is still required.

## Native desktop 200% result — October 21, 2026

User explicitly set Windows Chrome to 200% in its native Zoom control. Browser inspection confirms devicePixelRatio changed from 1 to 2 with visualViewport.scale=1 and a 705px CSS viewport width (450px height after reload). No viewport emulation was active.

Passed: navigation remains within the viewport; full Devices sheet sets map inert and has matching 703px client/scroll widths; transfer/profile/graph task bodies have matching 698px client/scroll widths with Close bottom at 52px; field editor has matching 611px client/scroll widths and its Return to graph action scrolls into view at bottom 418px. One graph and one map were observed while graph was open. Closed clean editor/graph and returned to Map/peek: no open tasks/editor, one map. No form saves, exports, or shares were invoked. User should restore original Chrome zoom manually; browser control has no native zoom capability.

The specific native 200% page zoom criterion is now passed in Windows Chrome. iPhone evidence remains pinch zoom, and spoken assistive-technology acceptance remains pending.

## Non-admin server denial — October 21, 2026

With the existing Windows Chrome session, the rendered `/traccar-scope-api/auth/status` response confirms enabled=true, authenticated=true, role=regular. A new read-only tab opened `/traccar-scope-api/api/admin/users`; Chrome displays Access denied and HTTP ERROR 403. No administrator data was rendered and no write was invoked. Temporary tabs were closed; original session remains signed in.

Source review: UserAccessEndpoints applies RequireRole(admin) to admin users routes, including writes. Authentication redirects are mapped to 401 and access-denied redirects to 403. Device/trip access is separately checked through VehicleAccess. This representative 403 and the user's expected-device-list check are passed; a known out-of-scope device/trip denial and broader endpoint coverage remain pending.

Session-expiry limitation: appsettings.Development.json enables AllowUnauthenticatedDevelopment. Program grants a development admin identity to unauthenticated loopback API requests while excluding auth/status. Requests through the local Vite proxy can therefore mask the actual expired-session boundary. Do not infer production expiry behavior from this setup. No bypass setting, cookie, user role, or backend process was changed. Run expiry acceptance in a controlled backend with that bypass disabled, using only a disposable test session; UI logout/relogin is a separate check and does not establish natural expiration.

## Isolated expiration/renewal acceptance — October 21, 2026

User reports no session stability problems and plans further observation over days, while authorizing a controlled automated expiration check. Added [isolated session checks](../tests/SessionExpiration.Tests/README.md) using actual ASP.NET cookie middleware and a simulated clock. The production cookie configuration was moved unchanged into TraccarScopeCookieAuthentication.Configure so both the backend and test share it. No live expiration duration, bypass setting, account, browser cookie, or running API process was changed.

Passed on a temporary loopback server with invented identity/data, ephemeral keys, no database, and no development bypass: anonymous 401 without redirect; valid protected access; regular-user admin 403; no premature ticket renewal; sliding renewal; original-ticket expiration; renewed-ticket validity beyond original expiration; renewed-ticket expiration after inactivity; fresh test-session recovery. Simulated time advances beyond the existing configured lifetime without sleeping or shortening production settings. Server is stopped after the test.

Frontend tests invoke the actual Traccar API client: 401 throws an explicit error and reports failed session state; a subsequent successful response recovers to ok; 403 remains a permission error rather than expired authentication or empty-success data. This verifies the API-client boundary, not every app API client or database-backed login UI.

Validation: isolated .NET checks pass; backend build passes with zero warnings/errors; 161 JavaScript tests pass; frontend production build passes; lint exits 0 with warnings; whitespace checks pass. Local expiration/renewal and API-client handling are now passed. Live end-to-end expiration/sign-in behavior remains a separate observation for the user's multi-day use or a future controlled deployed session.

## Out-of-scope device/trip acceptance — October 21, 2026

Added [disposable authorization checks](../tests/VehicleAccess.IntegrationTests/README.md). All 17 checks pass using production VehicleAccess methods and the actual trip route-points endpoint, real PostgreSQL in a temporary loopback-only container, a generated isolated schema, invented identities/data, and ephemeral cookie keys. Direct/group device grants and direct/group vehicle grants allow their device/trip but not unrelated resources. Device lists exclude out-of-scope IDs. Invalid device IDs and inactive users are denied. The real trip route endpoint returns 200 for permitted fixture geometry and 403 with no body/redirect for an existing out-of-scope trip.

The schema and database container were removed after the run. Build passes with zero warnings/errors. The initial configured-credential attempt failed before schema creation; the final executable requires an explicit disposable connection and cannot fall back to app configuration. A temporary build directory avoids the running API's apphost lock. No running API, real account, grant, trip, or application record was changed. Direct out-of-scope denial is now passed in the controlled integration environment; deployed endpoint breadth and live session observation remain separate.

## History response-order checks — October 22, 2026

The history index, day-summary, and metadata-refresh reads now share readCurrentRequest. It captures the active history generation, ignores both successful and failed completions from an older refresh, and preserves current errors for the existing Retry/error presentation. Month-state and loading-finally generation guards remain in place.

Four controlled promise tests pass: an older summary finishing after a newer refresh; a partially completed index invalidated before its remaining response arrives; a stale API failure arriving after current success; and a current failure followed by successful retry. These exercise the production helper used by those reads. They do not establish every browser interaction or API-base-switch path; the broader stale-response acceptance item remains open.

Validation: 165 JavaScript tests pass, production build passes, lint exits 0 with existing warnings, and whitespace checks pass. No live data or session settings changed.

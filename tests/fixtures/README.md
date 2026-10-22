# Mobile shell acceptance fixture

With the normal Vite dev server running, open:

`http://localhost:5510/tests/fixtures/mobile-layout.html`

This fixture renders the production shell, top bar, sheet, device list, More menu, navigation, and task dialog with invented data. It does not load the application API, use browser storage, save a form, or modify account/device settings. Its map is a labeled placeholder; it does not validate Leaflet.

Use browser viewport controls to check 320x568, 390x844, and 844x390. The device and account labels intentionally stress wrapping. Open the target view first, then select **Double text for test** (on the placeholder map or inside the sample task). It doubles the computed font sizes of the currently rendered shell elements exactly once. Reload before each scenario so newly mounted content is measured at its original size before doubling.

This is a controlled text-reflow stress test. It does **not** establish native browser 200% zoom, text-only zoom, screen-reader behavior, real-phone keyboard behavior, or safe-area acceptance. Those remain separate manual checks.

For task checks, choose More → Open sample task before doubling text. Focus Finish test task without activating it to scroll to the bottom; verify that the task header and Close button remain reachable. Escape and the fixture's finish button close only the sample task.

The fixture is a dev/test entry under `tests`, not an application route or production build entry. History/Trips consolidation is intentionally excluded.
For location-picking checks, choose More, expand the sheet to full, then choose **Start sample location pick**. Verify that the map and Cancel location remain reachable after doubling text; cancellation must restore the full More sheet.

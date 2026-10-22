# Traccar Scope mobile layout blueprint

Design proposal, 2026-10-21. Audience: a junior React developer implementing with GPT-6 Luna. This document specifies a staged layout change; it does not claim that the mobile interface has been implemented or tested.


Deferred follow-up agreed with the user on 2026-10-21: after the current mobile implementation, combine History navigation and trip content into one panel named **Trips**, likely using the current History panel as its frame. Remove the obsolete separate Trips window and unused wiring afterward. Do not implement that consolidation now or invest in panel-specific changes that it would replace. The active tracker records the follow-up at its end.

## 1. Scope and existing application

The mobile experience centers on selecting a device, viewing its map and status, browsing days and trips, and inspecting telemetry. Settings, vehicle administration, provider configuration, and profile authoring remain primarily desktop experiences, as requested by the user. Keep them accessible through More without making a complete mobile Settings redesign a prerequisite.

The repository already uses React, plain CSS, and Leaflet directly. It has no React-Leaflet, Tailwind, router, or global state library. Keep that stack. Use ordinary props, `useState`, `useRef`, and short effects. A new state library is unnecessary for this layout.

Current integration points:

- `src/App.jsx` owns selection, fetching, permissions, Leaflet initialization/layers, many forms, and window visibility.
- `src/components/TripPanel.jsx` mixes trip content with dragging, resizing, and floating placement.
- History and notifications use `MovablePanel`; several panels are portaled to `document.body`.
- `TelemetryGraphViewer.jsx`, `SettingsModal.jsx`, and the field/profile editors have their own presentation wrappers.
- `App.css` contains desktop positioning rules and several existing mobile overrides. `index.css` also contains graph/editor rules.

The layout refactor must preserve device access checks, historical bindings, source identity, unit conversions, and profile revision selection. The open acceptance work in `TELEMETRY_DISCOVERY_AND_FIELD_EDITING_PLAN.md` is a separate correctness concern; this blueprint does not close it.

## 2. Phone layout

```text
┌────────────────────────────────────┐
│ Device name                  User  │  Top bar: safe area + 56px minimum
├────────────────────────────────────┤
│                                    │
│                MAP          Fit    │
│                             + / −  │  Controls belong to the visible map
│                                    │
│ Attribution                        │
├────────────────────────────────────┤
│ Trips                 Expand  Map  │  Sheet header: 64px minimum
│ Date range / selected day          │
│ Trip list or selected trip details │  One scrolling content area
│                                    │
├────────────────────────────────────┤
│ Map     Devices     Trips     More │  Navigation: 56px + bottom safe area
└────────────────────────────────────┘
```

The map and sheet are siblings in a bounded workspace. The sheet expands upward by taking space from the map. It does not obscure a full-size map underneath. This makes route fitting, attribution, and map controls predictable without calculating a panel overlap for every map operation.

Use one compact layout below `64rem` viewport width. At `64rem` and above, preserve the existing desktop windows for the first release. Use this same breakpoint in CSS and the single layout media-query subscription. Base the choice on available space, not user-agent detection. Keep touch controls usable on large tablets too.

### Sheet states

| State | Space within workspace | Visible content | Map behavior |
| --- | --- | --- | --- |
| Peek | Header only, at least 64px | Selected device/trip summary and Open button | Uses remaining space |
| Half | 46% | Header and scrollable panel | Interactive in its own remaining area |
| Full | 100% | Header and scrollable panel | Still mounted, visually hidden and inert |

Use explicit Open, Expand, Reduce, and Map buttons. Do not make dragging the only way to change size. For the initial implementation, use button-controlled expansion without drag physics or animation of the map's height. The visible sliding-sheet pattern does not require a gesture library. Do not draw a decorative drag handle that suggests an unsupported gesture.

The sheet is a named nonmodal `<section>` with a heading. It does not trap focus. At full size, only the zero-height map area becomes inert; the top bar and bottom navigation remain usable. Set the map area's native `inert` attribute from React while the sheet is full, and move focus out of the map before hiding it. CSS visibility alone is not the interaction contract. At peek size, hide the content with the `hidden` attribute so its controls cannot receive focus.

### Exact navigation behavior

| Action | Result |
| --- | --- |
| Initial login | Map with peek sheet; preserve the existing authorized selection/default rules |
| Map button | Collapse sheet to peek; preserve device, dates, selected trip, and map view |
| Devices button or device name in top bar | Open device list at half size |
| Select device | Call the existing selection handler, clear incompatible trip selection as it already does, show its status in peek |
| Trips button | Open history/date controls and trips at half size |
| Select trip | Keep half size, show trip summary/details, fit the route into the resized map once |
| Show on map | Collapse to peek and fit the selected route once |
| Map marker | Select its device through the same selection handler and open status at half size |
| Telemetry button in trip details | Open telemetry as a full-screen task; closing returns to the same trip and sheet state |
| More button | Show Status, Notifications, Reports, Export, Named Places, Settings, My profile, and Sign out; apply existing permission rules |
| Settings/admin destination | Open the existing desktop-oriented content in a full-screen task with an always-reachable Close button |
| Select a location for a named place | Temporarily suspend the task dialog, show map with Confirm/Cancel controls, then restore the preserved form draft |

The four bottom navigation controls are ordinary buttons with text and icons. Use `aria-pressed` for the active mode; do not claim an ARIA tab pattern without implementing its keyboard behavior. Map is active at peek; Devices and Trips reflect their panels; More covers status and other tools. The top bar includes the selected device name and connection freshness. It wraps long labels without displacing the account control.

## 3. Component hierarchy and file checklist

```text
App.jsx                                  Existing data and domain state
└── AppLayout.jsx                         Layout-only state and composition
    ├── MobileTopBar.jsx                  Compact layout only
    ├── workspace
    │   ├── map-area
    │   │   ├── MapContainer.jsx          Persistent Leaflet DOM element
    │   │   └── MapOverlay.jsx            React map action buttons
    │   └── BottomSheet.jsx               Compact layout only
    │       └── selected panel body
    │           ├── DeviceList.jsx
    │           ├── HistoryContent.jsx + TripContent.jsx
    │           ├── StatusCard.jsx / VehicleStatusCard.jsx
    │           └── MoreMenu.jsx
    ├── DesktopPanels.jsx                Wide layout only
    ├── MobileNavigation.jsx              Compact layout only
    └── TaskDialog.jsx                    One active task
        └── Graph / Reports / Export / Notifications / Settings content
```

This is an ownership tree, not JSX to paste. The map-area node stays in the same place in the React tree at every breakpoint. Desktop panels use the current floating wrappers and extracted content. Do not render two copies of a feature and hide one with CSS: that duplicates requests, identifiers, focus targets, and editable drafts.

Create the following files under `src/components/layout/` unless another location is specified:

| File | Explicit responsibility and inputs | Completion check |
| --- | --- | --- |
| `AppLayout.jsx` | Compose the persistent map, overlay, sheet, and desktop wrappers; receive domain selections and existing callbacks from App | Resizing does not recreate the map or change selection |
| `MapContainer.jsx` | Render only the map canvas; accept the existing `mapElementRef` as an `elementRef` prop | Leaflet renders into exactly one DOM node |
| `MapOverlay.jsx` | Fit route/device, zoom buttons, follow/resume state, and location-picking actions; receive named callbacks | Every control has a visible or accessible name and works by tap or keyboard |
| `BottomSheet.jsx` | Receive `size`, `title`, `summary`, `onSizeChange`, and `children`; render heading, size buttons, and one scroll body | Long lists scroll without moving map or document |
| `MobileTopBar.jsx` | Receive selected name, freshness/status, and device/account button callbacks | Long names, loading, and no selection render correctly |
| `MobileNavigation.jsx` | Receive active mode and four explicit navigation callbacks | All buttons remain reachable above the phone safe area |
| `MoreMenu.jsx` | Render available destinations from existing permissions and feature flags | Ordinary users see only permitted actions |
| `DesktopPanels.jsx` | Move the current desktop window composition here; keep position/size state in App during extraction | Existing saved desktop positions still work |
| `TaskDialog.jsx` | Own a native modal dialog's open/close lifecycle, heading, Back/Close controls, and scroll region | Focus enters, stays within, and returns correctly |
| `src/components/TripContent.jsx` | Extract trip list/details/notes/tags from TripPanel; accept the same domain props without floating-placement props | Both layouts invoke the same save and selection callbacks |
| `src/components/HistoryContent.jsx` | Extract the existing history render helper and reuse HistoryNavigator, DayPanel, and RangeControls | Existing day/range selection behavior is unchanged |
| `layout.css` | Own shell, sheet, overlay, compact navigation, task framing, and safe-area rules | No layout styles leak into login or public share pages |

Refactor `TripPanel.jsx` into its existing desktop frame around `TripContent`. Split other task components into frame and content only when integrating them; keep their fetching and business rules together. For example, Settings gets an embedded rendering mode that removes its outer backdrop/window positioning while retaining its desktop form contents. Each task has exactly one modal owner.

Map extraction deliberately starts with a DOM-only `MapContainer`. Keep the existing Leaflet effect, map/layer refs, and data update effects in App for this first layout change. Moving every map lifecycle operation into a new controller at the same time would substantially increase the risk and the junior developer's scope.

## 4. State and component contracts

Keep existing domain data in App: devices, vehicles, selected device/day/trip, trip note drafts, permissions, profile revisions, and fetched history. Pass the existing handler functions down. Do not create a second selected device or trip inside the mobile layout.

Use two local `useState` values in AppLayout: `activePanel`, initially `status`, with allowed values `devices`, `trips`, `status`, `more`; and `sheetSize`, initially `peek`, with allowed values `peek`, `half`, `full`. Write ordinary event handlers that set these values according to the navigation table. No reducer or state-machine framework is needed.

Use a single task identifier at the existing task owner in App, initially null. Allowed destinations are `telemetry`, `reports`, `export`, `notifications`, `settings`, and `profile`. Catalog and Named Places actions open the corresponding existing Settings section. Replace the old overlapping visibility booleans as each destination migrates; do not keep independent old and new flags controlling the same task. Existing graph data remains separate from whether the graph task is visible.

Within the telemetry task, field editing is a local subview with an explicit Back button. Preserve the graph component/data while this subview is visible, and restore its selected series and viewport. Save errors retain the field draft. Avoid putting a second portal dialog underneath a native dialog's top layer.

Keep drafts in their existing owner so changing viewport size or panel does not discard them. For an unsaved form, Close offers Keep editing or Discard within the task. On a failed save, keep the draft and show the API's actionable error. Layout changes must not invoke writes.

Use one small `matchMedia('(min-width: 64rem)')` subscription in AppLayout to decide whether desktop portal frames or the mobile sheet are mounted. Clean up its listener. CSS controls actual sizes. No JavaScript viewport arithmetic or chains of custom hooks are needed.

Persist no new sheet or dialog state initially. Keep desktop panel position preferences separate. Do not copy data into browser storage or invent a new state context for this refactor.

## 5. CSS layout contract

The following is a complete compact-layout geometry block. Its classes correspond to the hierarchy above. Apply `data-sheet-size` to `.scope-layout`. Put header, workspace, and navigation directly inside it. Put `.scope-map-area` and `.scope-sheet` directly inside the workspace. The sheet contains its header and `.scope-sheet-body`. Theme colors and typography continue to come from existing application styles.

```css
@media (max-width: 63.999rem) {
  .scope-layout {
    position: fixed;
    inset: 0;
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    isolation: isolate;
    box-sizing: border-box;
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
  }

  .scope-layout *, .scope-layout *::before, .scope-layout *::after {
    box-sizing: border-box;
  }

  .scope-topbar {
    flex: 0 0 auto;
    min-height: calc(56px + env(safe-area-inset-top, 0px));
    padding: calc(8px + env(safe-area-inset-top, 0px)) 12px 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .scope-topbar-title {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .scope-workspace {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .scope-map-area {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    isolation: isolate;
  }

  .scope-map-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    z-index: 0;
  }

  .scope-map-overlay {
    position: absolute;
    inset: 12px 12px auto auto;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }

  .scope-map-overlay > button { pointer-events: auto; }

  .scope-sheet {
    flex: 0 0 46%;
    min-height: 0;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 16px 16px 0 0;
  }

  .scope-sheet-header {
    flex: 0 0 auto;
    min-height: 64px;
    padding: 8px 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .scope-sheet-body {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior-y: contain;
    touch-action: pan-y pinch-zoom;
    padding: 0 12px 16px;
    scroll-padding-block: 16px;
  }

  .scope-sheet-body[hidden] { display: none; }
  .scope-layout[data-sheet-size='peek'] .scope-sheet { flex: 0 0 auto; }
  .scope-layout[data-sheet-size='full'] .scope-sheet { flex-basis: 100%; }
  .scope-layout[data-sheet-size='full'] .scope-map-area { visibility: hidden; }

  .scope-navigation {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    min-height: calc(56px + env(safe-area-inset-bottom, 0px));
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .scope-layout button { min-width: 44px; min-height: 44px; }
  .scope-layout input, .scope-layout select, .scope-layout textarea {
    font-size: 1rem;
    max-width: 100%;
  }
}
```

Use opaque themed backgrounds on the sheet, top bar, and navigation. Keep the map's Leaflet panes within the canvas stacking context; the overlay sits above that context. Leave attribution unobstructed at the lower map edge. Remove the existing compact map minimum heights and floating panel placement overrides where they conflict with these classes.

Set the viewport meta content in `index.html` to `width=device-width, initial-scale=1.0, viewport-fit=cover`. Keep browser zoom enabled. Dynamic viewport units respond to browser chrome changes; they are not a universal guarantee of virtual-keyboard resizing. See [MDN viewport length units](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length).

## 6. Scrolling, map gestures, and resizing

The document itself does not scroll in compact map mode. The sheet body owns list scrolling. The map canvas is its sibling, so scrolling the list is never a drag originating inside Leaflet. `overscroll-behavior-y: contain` prevents scroll chaining at list boundaries; it is not a substitute for separating the map and the list in the DOM. See [MDN overscroll behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior).

Remove inner fixed-height scroll containers from embedded trip/history content. Use one vertical scroll owner per sheet. Large report tables may retain their own explicitly labeled horizontal scroll region.

Leave Leaflet's gesture handling on the map canvas. Do not put `touch-action: none`, a document-wide `touchmove` handler, or `preventDefault()` on the shell or sheet. Do not disable map dragging on every touch event and try to re-enable it later. Allow pinch zoom in ordinary UI scroll regions. See [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action).

Add one short ResizeObserver effect next to the existing Leaflet initialization in App. Observe only the map canvas. When its width and height are nonzero, schedule one animation frame and call `map.invalidateSize({ pan: false, debounceMoveend: true })`. Cancel the pending frame and disconnect on cleanup. Never recreate Leaflet just because sheet size, selection, or orientation changed. This is map-library maintenance, not a layout calculation hook. [Leaflet documents invalidateSize for container size changes](https://leafletjs.com/reference.html#map-invalidatesize).

Do not automatically refit on every resize notification or live position update. For an explicit Show on map or trip-selection action, wait for the new layout frame, invalidate size, then call the existing route-fit logic with ordinary edge padding. Compact mode bypasses desktop floating-panel offset calculations because the sheet already reserves space. Preserve the user's current follow/auto-fit behavior and visible Resume action when panning pauses it.

Replace compact-mode custom Leaflet action controls with MapOverlay callbacks, disabling their old duplicate controls. Keep Leaflet attribution. Preserve map click/popup behavior, but move long detail displays into status/trip content. No mobile action may depend solely on hover, double-click, or dragging a tiny handle.

## 7. Full-screen tasks and desktop-oriented Settings

Use native `<dialog>` with `showModal()` for full-screen tasks. A dialog opened this way makes background content inert. TaskDialog must synchronize open/close with React state, handle the `cancel` event, focus its heading or first appropriate control, and restore focus to the invoking button. Do not rely on the `open` attribute alone for modality. See [MDN dialog](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog).

TaskDialog owns a flex column: heading/Close row, a `min-height: 0; overflow: auto` body, and an optional action footer. On compact screens it occupies the viewport with safe-area padding. Preserve the map beneath it. Fullscreen here means a viewport-sized dialog, not the browser Fullscreen API.

Settings keeps its desktop organization and existing forms. It may need horizontal scrolling for wide administrative tables. Its title/Close controls must remain outside that horizontal region. Label its More entry “Settings — best on a larger screen.” Never block phone access or force an orientation change. Sign out and basic account access remain in the top bar/More menu.

For text entry, use the task body's normal scrolling and ensure the focused input and Save controls can be reached while the keyboard is open. Do not calculate keyboard height throughout the app. Test actual iOS and Android behavior; if a keyboard covers the focused control despite scrolling, limit any VisualViewport adjustment to TaskDialog rather than changing map geometry globally.

Graphs use the available task width. Stack Data Elements controls beneath the plot on narrow screens; preserve source-specific rows and personal/shared edit permissions. Expose time/value selection through labeled controls as well as gestures. A scrollable table/list of selected values supplies an accessible alternative to precise graph dragging. Preserve existing graph selection when entering and leaving its field editor.

For this first layout release, application Close/Back controls handle task navigation. Do not install a global browser Back interceptor. Browser Back continues its normal document behavior; form-close protection applies to application controls. URL-addressable task navigation can be a separate routing decision.

## 8. Loading, errors, accessibility, and performance

- Show scoped loading and retry messages inside the active panel. Keep the last successful map visible with its last-updated timestamp when refreshing fails.
- Distinguish no devices, no trips for the selected range, permission denied, and connection failure. Never label a failed request as an empty result.
- Announce selection/load failures through a small polite live region; do not announce every live telemetry update.
- Provide visible keyboard focus, 44px minimum action targets, labeled icon buttons, and text alongside status colors. Keep lists usable at 200% text zoom.
- Preserve the current light/dark theme. Readability matters over translucency on a detailed map.
- Render one map and one active panel. Keep the existing lazy loading for graphs, reports, and Settings with a visible loading fallback.
- Do not fetch a full historical route for every list row. Reuse current bounded queries and selected-trip fetching. Guard stale responses when the user changes devices/dates quickly.
- Preserve session-expiry behavior: close sensitive tasks and clear protected selection through existing authentication logic when access ends.
- Keep login and `PublicTelemetryShare.jsx` outside the fixed map shell. Give public shares their existing readable document flow.

## 9. Implementation roadmap for Luna

Each step should be a reviewable change. Report changed files, behavior checked, and outstanding defects before starting the next step. Do not combine unrelated telemetry correction work with layout extraction.

| Step | Work | Required evidence before proceeding |
| --- | --- | --- |
| 1. Record baseline | Inventory current visible tools and their permission rules; capture desktop layout, selected device/trip, window persistence, and map controls | List every action's compact destination; document baseline test/build failures separately |
| 2. Extract map and panel bodies | Add DOM-only MapContainer, TripContent, and HistoryContent; reuse them in existing desktop frames | Desktop selection, map layers, trip notes/tags, and history still operate; no duplicate map initialization |
| 3. Build compact shell | Add AppLayout, top bar, navigation, BottomSheet, and layout.css; wire existing data/callbacks | At 390×844, Devices and Trips work in peek/half/full; list scrolling does not move map |
| 4. Wire map controls and resize | Add MapOverlay, the single resize observer, compact fit behavior, and location-pick actions | Route stays visible after selection; rotation does not blank tiles; manual pan remains stable |
| 5. Adapt task framing | Add TaskDialog; embed graph, reports, export, notifications, profile, and desktop Settings contents | One modal owner; Close restores focus and selection; forms retain drafts after failed saves |
| 6. Resolve interaction details | Finish loading/error states, long names, keyboard/focus, safe areas, field-editor return, and source-aware graph controls | Device denial, expired login, empty trips, slow request switching, and note entry behave distinctly |
| 7. Acceptance and documentation | Run existing tests/build, focused interaction checks, real phone checks, and desktop regression; update user docs | The checklist below passes or each unresolved failure is recorded explicitly; only then mark the layout complete |

Suggested first instruction to Luna: “Implement Step 2 of docs/MOBILE_LAYOUT_BLUEPRINT.md. Read the existing App and TripPanel behavior first. Extract MapContainer, TripContent, and HistoryContent using current props and handlers. Keep Leaflet initialization and domain state in App. Verify desktop behavior before adding the compact shell.”

## 10. Acceptance checklist

- [ ] Test compact widths 320px, 390px, and 768px; short landscape 844×390; and desktop 1280px and wider.
- [ ] Check real Safari on iOS and Chrome on Android, including browser address-bar changes, keyboard opening, and rotation. Emulation alone does not close this item.
- [ ] Sheet scrolling, including reaching either end, does not pan the map or scroll the whole page.
- [ ] The full sheet hides and disables map controls; reducing it restores a correctly sized map without creating a new map instance.
- [ ] Device/date/trip selection works with long names, many trips, loading, empty data, and failures.
- [ ] Trip notes/tags save through the existing API; failed saves retain drafts; layout changes do not issue writes.
- [ ] A permitted ordinary user can browse their data; unrelated device data stays inaccessible; administrator-only edits remain protected by the backend.
- [ ] Two source devices with the same telemetry key retain separate labels, series, and edit targets.
- [ ] Graph and field editor return preserve source, selection, range, and zoom.
- [ ] Map location picking restores the correct Settings form and selected coordinates on Confirm; Cancel preserves the original values.
- [ ] Settings Close, sign out, and account controls remain reachable; desktop Settings functionality is intact.
- [ ] Focus and reading order remain sensible at 200% zoom; icon actions are named; no hover-only essential actions exist.
- [ ] Existing desktop floating-window placement, map gestures, exports, and public share pages still work.
- [ ] Existing automated tests and production build pass, with environment failures distinguished from application failures.

No new dependency is needed for this blueprint. The implementation scope is a mobile layout and interaction migration of the existing application.

### Post-mobile follow-up: Settings by user role

User direction, October 21, 2026: after mobile design/acceptance, restrict non-admin Settings to options that apply to the signed-in user and their permitted devices. Review requiring iPad-sized or greater available width for administrator Settings; the precise threshold remains to be chosen. Preserve server-side authorization regardless of visibility or screen size. Track this separately from History/Trips consolidation in the implementation plan; it is not part of the current acceptance fixes.
### History/Trips consolidation completed — October 22, 2026

The post-mobile follow-up is implemented: desktop History navigation and trip list/details share one Trips window, retaining the History frame position preference. The obsolete separate Trips flyout and its preference/loading wiring were removed. Compact and desktop reuse the same trip content and callbacks. Role-specific Settings remains pending in NEXT_TODO.md.

## Trips hierarchy correction — October 22, 2026

User clarified that consolidation means months contain expandable days, and each day contains its trips, with a graph icon on the day row. The earlier stacked/split history-and-trip sections were rejected and have been replaced in both desktop and compact layouts. Trip selection, per-trip graph actions, and selected-trip notes/tags remain inside the corresponding day. Day graph actions use only that day's loaded trip points; they are disabled until points are available. Multi-day selection and its graph action remain available. There is no independent lower trip list or old flyout.

Browser verification: October 21 expands to seven nested trips, the day graph opens with 2,486 points, and 390px compact layout preserves the hierarchy/navigation without horizontal overflow. Temporary viewport override reset afterward. Production build passes. Settings-by-role work remains pending.
### Role-specific Settings follow-up — October 22, 2026

Implemented the regular-user Settings view with personal display preferences and Email/SMS alerts. Administrator configuration requires a 1024 CSS-pixel wide layout. The change affects frontend presentation; backend authorization remains authoritative. See the role-specific Settings checkpoint in the implementation tracker and NEXT_TODO.md.
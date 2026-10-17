# Telemetry discovery and focused field editing

Design and implementation notes, 2026-10-14.

**Review checkpoint, 2026-10-16:** Feature expansion is closed, but the current unpublished implementation has correctness and access-control defects to resolve before a multi-user release. The [implementation review below](#implementation-review-2026-10-16) supersedes earlier blanket completion and verification statements. These corrections do not require another Silverado drive or expansion of the research catalogs.

## Implementation status

**Correction pass, 2026-10-16:** Findings R1-R4 and the collection race have implementation corrections; R5-R6 remain open. R1 and R2 now have server-side enforcement: the Traccar proxy only exposes the read-only `/server`, `/devices`, and `/positions` endpoints used by the UI; non-admin device/position results are scoped to direct, group, or active vehicle-binding access; inventory reads/retries and source-mapping history check access to the requested device before reading or queueing; retry calls are throttled per account/device. Source-mapping writes remain administrator-only. R3 is corrected so AVL-number similarity affects neither field-option identity nor conversion selection; status cards and map popups translate the exact received key. R4 now applies effective tracker revisions to status cards, map popups, health/racer reports, and translated range CSV rows as well as graph points. A successful graph save refreshes the app-level revision cache. R7 now invalidates in-flight history collection when device/date selection changes and discards stale results. These are code changes, not yet build/test or live multi-user verification.

R5 and R6 remain open. Graph numeric series still combine same-named keys across sources. Historical shared-profile revision selection and per-point assignment-boundary resolution still need an explicit policy and implementation. The small metadata-preservation and inventory-backfill items are also outstanding; they are not release gates for this pass unless they affect a concrete installation.

For the current automatic path, the graph waits for source-mapping history to load and requires administrator edit access, exact device metadata, and an observed field. It preserves shared profile mappings and any existing tracker history. Automatic, manual, and undo writes are labeled in revision history; automatically applied revisions explain their source and future-only effective time in the editor. The existing research catalogs remain suggestions, so no live mapping was written during this change.

The graph-to-editor interaction is implemented: graph metadata suffixes open a focused field editor; personal descriptions persist per account (and locally when signed out); personal field labels and suggestion dismissals are now scoped to profile, vehicle, Traccar device ID, and field, while older saved choices remain readable and can be restored; matching keys in related saved profiles appear as yellow suggestions with an explanation and no applied conversion; administrators can edit shared mappings; the graph refreshes after a successful shared save; shared-profile edits show an acknowledgement when the profile is assigned to multiple vehicles; and the profile inspector offers measurement, received-unit, and display-unit pick lists with detailed conversion controls tucked under an advanced section. The field editor now shows Traccar's configured device model separately from the app's assigned translation profile, and explicitly reports when Traccar did not supply a model. The unit list covers the symbols currently used by bundled and experimental profiles, including scaled units whose legacy definitions specify a multiplier.

A fail-closed documented-match gate in `telemetryDiscovery.js` now controls the tracker-specific automatic revision flow. Automatic eligibility requires the exact raw key, manufacturer, model, decoder version, explicit compatible firmware and required configuration, approved cited evidence, a complete mapping, explicit auto-apply approval, and no competing interpretation. Numeric firmware ranges reject prerelease or otherwise non-numeric version strings. The gate also requires titled HTTPS references, an explicit value type and measurement identity, and no existing shared or tracker mapping to overwrite. Tests cover these refusal cases. Automatic application is now connected to tracker-specific revisions, but no bundled field-catalog record currently meets the gate: the present research entries call their examples illustrative and leave live device configuration/output unconfirmed. The app now reads the connected Traccar server version at startup and extracts only explicit device model, manufacturer, firmware, and telemetry-configuration metadata; it does not infer missing values, and conflicting firmware fields are rejected. The focused editor shows which match context is available. Tracker firmware or configuration may still be absent, so entries that require them remain suggestions. Profile revision history, effective-dated vehicle assignments, and source-specific override/undo support are in place. Effective-dated vehicle profile assignments are now live-verified: the Silverado's corrected manual revision resolves to the FMM00A catalog option (`teltonika-fmm003`), the earlier entries remain in history, and the reloaded Vehicle Catalog selected Teltonika FMM00A. The API normalizes supplied effective timestamps to UTC before PostgreSQL writes; this was verified after the API and database clocks differed by about two minutes, delaying the revision's activation until its effective time. The backend builds with zero warnings and errors. At that checkpoint, Node tests and the frontend build had not yet been rerun; the later verification is recorded below.

The first separated FMM00A research record lives in `device-field-catalog/teltonika-fmm00a.research.json`. The app now bundles every JSON record in `device-field-catalog/` automatically, so new reviewed records do not need a code import. An exact Traccar device-model/key match surfaces the PCB-temperature label as a yellow suggestion that can only be saved as a personal guess; it carries no units or conversion. It does not mutate the runtime or vehicle profile. The manually reviewed FMM00A profile separately maps AVL 13201 using Teltonika's documented 0.1 °C multiplier and signed value type. A first ledger import adds 63 additional label-only suggestions across exact-model FMB120, FMC003, FMC130, GV300, and GV55 catalogs. Each offers its cited source in the editor and repeats its verification caveat. Only labels and manufacturer field IDs are imported; no illustrative values, units, or conversions are applied. Conflicting and unsupported rows remain excluded or unresolved. The Queclink GV300/GV55 research records now use trimmed exact model names; the matcher was checked to return a single same-model suggestion and reject a cross-model lookup for each. These entries remain label-only because their scoped decoder version and device configuration do not justify unit conversions yet. The live field editor now includes `0.1 °C` in its Temperature pick list, matching the FMM00A profile's documented source scale; pre-existing custom source units are also shown as the selected current value instead of being mislabeled “Unknown.” At that checkpoint, the documented-match gate and research-catalog expansion were still pending; subsequent updates below connect the gate to automatic source revisions and import the reviewed research catalogs. The remaining phase gate is real-data validation after the Traccar model correction. On 2026-10-15 the user corrected the Traccar device model from the vehicle name `Silverado` to the hardware model `FMM00A`; the live app now confirms `Traccar configured model: FMM00A`. The existing `io31` and `io247` samples were captured before that correction, so they describe the prior decoder context. Under the documented v6.14.5 decoder, FMM00A matches the `fmbXXX` predicate and would decode ID 31 as `engineLoad` and ID 247 as an accident alarm. However, Teltonika's FMM00A hardware-support table omits FMM00A for both IDs. The installed Traccar version, tracker firmware/configuration, and any newly decoded FMM00A sample after the correction remain unconfirmed. Preserve the user's personal Engine Load label as a yellow guess, leave the shared mapping unchanged, and keep AVL 247 unresolved until fresh output and exact compatibility scope are confirmed. AVL 13201 is independently supported for FMM00A in Teltonika's table.

As a follow-up, schema 15 adds normalized `engineLoad`, `coolantTemp`, and `rpm` entries to the FMM00A profile, using the units Traccar v6.14.5 assigns to AVL 31, 32, and 36. The migration is additive and does not replace existing mappings. These are only for future normalized keys; the historical `io31`–`io36` values stay raw/unscaled and the personal Engine Load label remains a per-user guess. The user tested normalized `coolantTemp` in the app and reports that it looks correct. The reviewed catalog now lists the normalized names as alternate Traccar keys for the same AVL IDs, so exact-model users whose profile lacks a mapping can receive a label-only personal suggestion. That alias path does not infer units or apply shared edits. No new trip or rewrite of old positions is required.

The graph's Data Elements list now also has a collapsed **Other received fields** inventory for attributes that cannot form a meaningful numeric series, including text, booleans, structured values, and numeric fields with no usable samples. It lists the field label/key, observed type, point count, source device, and first/last observation time; matching keys from different trackers remain separate and each row opens the editor for its own source. The summary does not copy raw attribute values. The field editor hides known identifiers and secrets, starts ordinary text samples hidden with an explicit reveal control, and continues to show numeric measurement samples. Catalog validation now checks model scope, evidence links, duplicate/ambiguous raw and normalized keys, and blocks conversion payloads or automatic use in research entries. All six bundled catalogs pass this check. The Data Elements list now has **All / New / Suggested / Conflicting** review filters, with field status derived from the current mapping and scoped catalog suggestions; matching interpretations remain known, while competing interpretations are surfaced as conflicts. These filters also apply to the unplotted-fields inventory. Live QA on the selected Silverado trip verified each filter and restored All afterward. The full suite passes 115 tests, the production build succeeds with the existing large-chunk warning, and targeted lint completes with existing React warnings in the graph component. The API compiles with zero warnings to a temporary output directory; its normal build output is locked while the user's API process is running. The next Silverado trip remains a useful check of the other normalized fields and a pilot of first-time user discovery.

Shared profile writes now use an expected revision (`If-Match`) and reject stale edits rather than overwriting another administrator's update. The Vehicle App API records immutable profile snapshots, exposes revision history to administrators, and tracks whether a revision came from a manual edit, migration, documented automatic match, or undo. The frontend serializes writes through its existing sync queue and tracks the server revision for each profile. The profile editor now lists saved revisions and can restore one selected field from an earlier snapshot; each restore is saved as a new `undo` revision while preserving the rest of the current profile. The source-mapping schema bootstraps and upgrades itself at API startup, including the change-provenance column. Restart the API to apply it; no additional SQL command is needed. Automatic application runs only when a catalog entry passes the exact-match gate, and no current research entry is eligible.

## Objective and agreed decisions

Make received telemetry useful across different users, vehicles, manufacturers, tracker models, and Traccar decoder versions with little routine setup. Start with the existing graph's discovery of received numeric attributes. The Silverado's six unknown keys are examples, not a special-case feature.

Decisions confirmed by Dan:

- Keep the graph's current display scaling behavior.
- Use the `(AVL ..., unit)` portion of a Data Elements row as the intentional target for editing one field. Return to the same graph after saving.
- Everyone can save personal descriptions and guesses. Administrators manage shared units and conversions.
- Apply strong documented matches automatically, with undo. Keep uncertain interpretations visibly yellow.
- Use readable unit pick lists and remove the need to understand or enter internal unit syntax.

Recommended defaults still open to refinement: shared interpretation edits apply to the current vehicle/source unless the administrator explicitly chooses a reusable profile; personal labels apply to the current user's vehicle/source and survive catalog updates.

## What exists and what needs to change

- `TelemetryGraphViewer.jsx` discovers attributes in the selected trip(s), filters to meaningful numeric series, translates through the assigned profile, and applies a separate plot scale. It also provides derived GPS speed. Preserve this discovery and scaling behavior.
- The focused field editor displays the Traccar device's configured model independently of the assigned translation profile. An absent model is shown as unavailable; never infer it from the selected profile or vehicle make/model.
- `DeviceProtocolProfileEditor.jsx` already has the card, inspector, sample preview, mapping validation, and add-key workflow. Extract reusable field-editor content rather than implement a second editor.
- `carProfiles.js` provides one read-time translator, raw/display values, measurement metadata, legacy conversions, and profile resolution. Keep it as the common interpretation path for graphs, status, reports, and exports.
- `device-profiles/` supplies the FMM003 baseline and experimental Teltonika/Queclink definitions. It does not currently include an FMM00A definition. Experimental status does not make every mapping eligible for automatic application.
- `AddingOtherDevices/Output/field-ledger*.csv` and companion notes contain source references, device scope, decoder behavior, and unresolved questions. These are input to a structured catalog, not evidence that illustrative values were captured from hardware.
- `TelemetryProfileEndpoints.cs` shares profiles with administrator-only writes. Personal labels, immutable revisions, field suggestions, and optimistic concurrency need explicit support.
- An open graph stores profile objects in `graphGroups[*].profileContext`. A field save must refresh all affected contexts without remounting the graph or leaving it with stale translations.
- `saveProfileEdits` currently constructs a new definition with selected properties. New provenance/version metadata must survive save, import, export, synchronization, and migration.
- Historical device-to-vehicle bindings and effective-dated vehicle profile assignment revisions now resolve per telemetry timestamp. Existing profile assignments are initialized as legacy baselines from vehicle creation time because the original assignment date is unavailable; this preserves current behavior while making later changes time-aware.

Local API inspection on this date: `/health` responded successfully after the user's restart. An unauthenticated direct request to `/api/telemetry-profiles` returned HTTP 401. Earlier inspection found diagnostics requests returned HTTP 503. This review did not establish current live profile contents, tracker metadata, or decoded samples. Earlier notes about Traccar 6.14.5 are historical evidence, not a fresh version check.

Live app inspection on 2026-10-14 first found the Silverado assigned to the FMM003 translation option despite the user's confirmation that its tracker is FMM00A; that mismatch was corrected and re-verified on 2026-10-15. The 2018 Chevy Silverado remains bound to the Traccar device named “Silverado,” and the Vehicle Catalog now selects **Teltonika FMM00A**. Its stable internal profile ID is `teltonika-fmm003` even though this catalog entry represents FMM00A; do not rename it without migrating stored assignments. That catalog view confirms the app assignment. Separately, the Traccar device editor and refreshed app confirm the configured Traccar model is `FMM00A`; as the only Silverado data is from October 14, no post-correction sample exists to validate decoder output. A separate read-only inspection of the Device Protocol Profile Editor still showed the FMM003 profile selected there, with its `io31` shared label displayed as “Engine Load??”; the bundled FMM00A profile has no `io31` mapping. Keep any personal graph label distinct from the shared profile mapping and do not copy the FMM003 interpretation onto FMM00A without compatibility evidence.

All Silverado telemetry currently available is from October 14. The Traccar Model field was corrected from `Silverado` to `FMM00A` on October 15, and the refreshed app confirms the new configured model. Therefore the saved October 14 points remain useful for field discovery and value-shape checks, but they cannot confirm how the installed decoder would handle a packet received with the corrected model. No later Silverado sample is available. Six observed raw IDs, AVL 31–36, correspond to OBD labels in Teltonika's reference; its per-row hardware-support lists omit FMM00A, so their labels remain yellow suggestions without units/conversions. Private raw values are intentionally not copied into documentation. Leave the known September 24 identity conflict untouched.

FMM00A-specific evidence update:

- Teltonika’s FMM00A AVL reference defines AVL 31–36 as Engine Load, Coolant Temperature, Short Fuel Trim, Fuel Pressure, Intake MAP, and Engine RPM. Each row is in the OBD group, but its hardware-support list omits FMM00A. The October 14 `io31`–`io36` keys are therefore real observations with plausible standard labels, not proof that the tracker/vehicle supports those OBD values. The exact-model catalog now offers label-only suggestions for all six, explicitly noting the support conflict and pre-correction capture; no units or conversions are supplied.
- Teltonika's [FMM00A AVL reference](https://wiki.teltonika-gps.com/view/FMM00A_Teltonika_Data_Sending_Parameters_ID) lists AVL 13201 as PCB Temperature, signed two-byte, with a 0.1 multiplier and °C units, and explicitly includes FMM00A in the supported hardware list. The documentation applies to FMB firmware 03.29.00 and newer.
- An October 14 Silverado point exposes `io13201` as an integer; it was recorded before the Traccar Model field was corrected to `FMM00A`. Traccar v6.14.5's Teltonika decoder has no special 13201 handler, so it falls through to generic `io<ID>` decoding. The decoder's generic 2-byte reader is unsigned and does not apply Teltonika's 0.1 multiplier. This supports a tentative API interpretation of `io13201` as the wire count. The refreshed app now confirms the Traccar device model is FMM00A, but the installed decoder version, tracker firmware, and active configuration remain unconfirmed. A candidate could propose count × 0.1 °C, with no automatic application until those contexts are verified.
- The only Silverado sample exposes `io247` from October 14, before the Traccar model correction. The inspected FMM00A reference does not list FMM00A in the hardware-support list for AVL 247. Traccar v6.14.5 registers AVL 247 as an accident alarm for its `fmbXXX` model predicate (`FM[B-Z]...`); with configured model `FMM00A`, that release would consume it as an alarm instead of preserving `io247`. The installed release is not verified, and no post-correction Silverado sample exists. Keep `io247` unresolved and unscaled. The event property `event` is a separate input and must not be conflated with `io247`.

The UI currently supplies graph groups from stored route projections whose position attributes are empty, although the raw positions are available through the existing Traccar positions API. A local change now hydrates such groups via the existing fetch callback before graph analysis, merging full points by group while leaving groups with existing attributes alone. This restores telemetry-series discovery for those graphs without adding a new endpoint or changing saved routes. The change is implemented and covered by tests/build locally; it is not deployed to the live app yet.

## User experience

### Data Elements rows

Keep the checkbox, readable description, existing series-color control, and plot scale. Render the metadata suffix as a separate button:

`[ ] Possible PCB temperature  [Guess]  (AVL 13201, unit unknown)  [color]`

This is a layout example only, not an identification of the FMM00A field.

- The suffix opens a focused editor with the matching card and inspector only. The rest of the graph stays mounted beneath it.
- Use one description-editing control in the inspector; inline editing of the graph label is unnecessary initially.
- A yellow/amber description and explicit `Guess` or `Suggested` text distinguish uncertainty. Color alone is insufficient. A normal catalog label does not imply hardware verification.
- Unknown Teltonika `ioN` fields can expose their I/O number without inventing a meaning or unit. Other manufacturers use `(key: adc1, V)` or their actual protocol identifier; do not label every vendor's field as AVL.
- Derived fields such as GPS speed still have a target. Their editor identifies the built-in source, supports personal names, and keeps decoder details read-only.
- Metadata clicks must not toggle the series checkbox, change its color, or close the graph. Restructure the row so the checkbox's label and the metadata button are separate interactive targets.
- Keyboard users can open the same editor. Tooltips follow the existing requested 500 ms show delay and immediate dismissal on pointer exit.

### Focused editor

Show the vehicle/source, tracker model when known, raw key, actual API sample, and active mapping context. For an unknown key, create an unsaved field draft automatically; do not ask the user to type the key again.

Default view:

1. **Description:** current resolved name and a personal-name option. Personal guesses remain marked `Guess` until explicitly resolved; saving text does not verify a physical interpretation.
2. **Suggestions:** a short ranked list with plain reasons, such as matching model and decoder, or a weaker match from a related model. Include `None of these` and `Keep as unknown`; allow manual text.
3. **Measurement type:** Temperature, Pressure, Voltage, Speed, Distance, Fuel volume, Fuel flow, Acceleration, Count, State, Identifier, Text, or Unknown, using the supported registry.
4. **Received unit** and **Show as:** readable choices with symbols; ordinary users see the shared interpretation read-only. Administrators can edit interpretation and preview the result.
5. **Preview:** Received value -> Shown value, using a sample from the selected graph. More samples and documented invalid/missing values are available in details.
6. **Save and return to graph**, **Cancel**, and **Reset my description** where applicable.

Advanced details hold raw adjustments, offset, documented unavailable values, protocol/source notes, mapping evidence, and internal compatibility fields. Most people should never need this section.

An administrator chooses current vehicle/source or a shared profile when changing interpretation; explain how many vehicles share that profile. Saving a personal name never writes a shared profile. A conflicting profile shared by unlike tracker models must be split or overridden for the relevant source before applying new meanings to it.

New-device setup should normally be: connect/assign the tracker, detect its protocol/model where the API provides reliable metadata, and populate known descriptions automatically as data arrives. If the exact model is missing, offer a searchable manufacturer/model choice once per source; a vehicle's make/year alone does not identify its tracker. Do not require users to create profiles or research each field before they can use the graph. Do not automatically change Traccar's configured device model, because that can change upstream decoding.

After a successful save, refresh labels/translation contexts in the existing graph and return keyboard focus to the originating suffix. Preserve selected series, colors, selected trips/days, zoom/range, scaling settings, and Data Elements scroll. Shared save failures keep the draft open with retry; do not report a server save as successful when only a local copy exists. Cancel discards only the field draft.

## Units and stored values

Keep the original Traccar API value and type in source storage. A manufacturer's wire value and a received API value can differ because Traccar already decoded it. `Received unit` always describes the API value that this application actually receives.

The normal editor needs two concepts:

- **Received unit:** Unknown, No unit, Degrees Celsius (°C), Millivolts (mV), Volts (V), etc.
- **Show as:** Follow my display settings, Same as received, or a compatible unit such as Degrees Fahrenheit (°F).

Unknown unit and No unit are different. No unit is appropriate for documented counts or ratios; Unknown does not assert a physical interpretation. Identifiers, text, enumerations, and packed flags do not acquire physical units just because their API representation is numeric.

An optional **Value adjustment** handles documented raw counts, for example count × 0.1 -> °C, before display conversion. Prefer named presets from the catalog; multiplier and offset remain advanced controls. If the API already supplies 12.5 V, do not apply the manufacturer's mV-to-V wire conversion a second time.

Create a central unit registry with stable internal IDs, friendly names, symbols, measurement dimensions, and supported conversions. Dropdowns contain only implemented compatible conversions. Specify US gallons versus UK gallons and distinguish acceleration milli-g from mass milligrams. Use a controlled registry for measurement types, display precision, and unavailable-value editing as well; users should not type conversion function names or JSON arrays in the normal workflow. Custom units are an advanced pass-through option until a compatible conversion is defined.

Personal display-unit choices can use compatible units for an already identified measurement without altering its shared received-unit definition. Claiming that an unknown source value is Celsius or millivolts changes interpretation and remains an administrator operation; a normal user can propose it as a guess.

Remove `Canonical` from the normal interface. Preserve the existing internal conversion path during migration; if its intermediate fields remain exposed in advanced details, name them **Reference unit**, **Adjustment multiplier**, and **Adjustment offset**, with explanations. Internally a reference unit can simplify conversion and cross-tracker reports without changing source storage. Public API reuse is not the reason for it, and storing a normalized copy of every measurement is unnecessary.

Do not change graph display scaling. It remains the last plotting operation after interpreting the physical value, separate from unit conversion and source storage.

## Automatic discovery and interpretation

### Discover broadly

Inventory all received attribute keys, not a fixed allowlist and not just six known examples. Record source identity, observed types, first/last seen, counts, and bounded representative samples. Discovery should reuse data already fetched for graphs and normal ingestion; backfill asynchronously where needed. It must not scan all historical positions whenever a graph opens.

Keep all detected elements inspectable. Text, identifiers, state codes, and packed values belong in inspection even when they are unsuitable for numeric graphs. Retain current raw graphing for suitable unknown numeric values. Do not coerce missing to zero, infer unavailable values from a single sample, or convert identifiers into measurements. Large integers/packed data need type-aware handling; original precision already lost upstream cannot be recovered from a rounded JSON number.

### Match a catalog

Build a versioned, distributable catalog from manufacturer documentation, pinned Traccar decoder behavior, and the existing evidence ledgers. Each mapping records:

- Manufacturer/protocol, exact model or explicitly supported model family, relevant firmware/configuration limits, and decoder/API representation.
- Raw API key, optional manufacturer field ID, value type, stable measurement meaning, source unit/adjustment, supported display units, and unavailable values.
- Source references and revision, known conflicts, and the reason it is eligible for automatic use or only a suggestion.

Do not treat a friendly label as the stable measurement identity. The same key may differ across manufacturers; the same normalized Traccar key can originate from more than one AVL source. Do not invent one definitive AVL ID if that provenance is ambiguous. Do not merge simultaneously present aliases without a documented rule.

Resolution order: applicable vehicle/source override -> explicit shared profile mapping -> compatible shipped catalog definition -> unconfirmed candidate -> raw unknown. Personal names overlay the resolved description only. No fallback silently selects the FMM003 interpretation for another device.

For a strong match, require an applicable device/model and decoder representation, compatible known configuration/firmware scope where relevant, a documented meaning and conversion, and no competing interpretation. Observed shape/range can reject a candidate or flag a change; plausible range alone cannot prove a unit or physical meaning. Missing context downgrades the candidate instead of fabricating certainty.

### Apply strong matches; suggest the rest

- Apply eligible catalog definitions to newly observed fields automatically. Show a quiet summary, not a modal interruption per key.
- Every automatic change has a previous revision and undo. Undo creates an explicit override/dismissal so discovery does not reapply it immediately.
- Existing manual overrides and personal names survive package updates. Package revisions update the supplied base; a changed conversion for an already interpreted field gets a comparison and explicit administrator action rather than silently rewriting its meaning.
- For weaker matches, show a yellow proposed description, raw key, and short reason. Candidate units/conversions remain proposals until an administrator accepts them. Keep actual plotted values in raw units while only a semantic guess is active.
- Allow a user to save their own yellow description and dismiss a bad candidate. An administrator can accept a documented interpretation and appropriate scope in one action.
- If evidence is insufficient, staying unknown is a valid result. The app cannot recover a custom sensor's meaning from an arbitrary number alone.
- Provide `New / Suggested / Conflicting / All` filters. Batch acceptance is available for compatible documented mappings; never require editing every correctly identified field by hand.
- Automated label suggestions can use curated related-model entries or optional future research/AI assistance, with attribution. Do not make a model-generated answer an automatic conversion rule. No external AI dependency is needed for the initial implementation.

Catalog parsing and review happen during library maintenance, not through web scraping on every user's graph. Packages ship with releases or a separately versioned update mechanism; ordinary installations do not require live manufacturer sites. A future contribution workflow may share reviewed definitions, with explicit opt-in and sanitized metadata, rather than automatically uploading private telemetry.

## Scope, history, and multiple users

Keep four distinct layers: shipped catalog definitions, installation-wide administrator mappings, vehicle/source-specific administrator overrides, and personal descriptions. Personal names are scoped by account, vehicle/source, raw key, and interpretation context, not globally by an `ioN` number. Allow broader reuse as an explicit choice.

Long term, decode according to the tracker/source effective at the record time; use the vehicle for ownership and presentation. One vehicle can change trackers, one tracker can move vehicles, and two same-model vehicles can expose different subsets. Preserve existing vehicle profile assignments as a migration fallback and avoid an immediate disruptive reassignment.

Store immutable profile/catalog revisions and effective source assignments. A source or conversion change should not silently reinterpret all older records. Permit an explicit historical correction with scope/date range, preview, and undo; a corrected definition may legitimately need to improve historical interpretation. Personal description changes can apply to the user's views immediately because they do not change physical values. Shared exports record interpretation revision and uncertainty; published telemetry snapshots retain their original label/value snapshots unless regenerated.

Use the existing backend for shared state and add account-scoped preferences. Authorize and validate server writes, and use revision checks to prevent one administrator from overwriting another's changes. Offline edits show their actual local/sync state. Preserve unknown definition properties through round trips.

## Implementation sequence and completion checks

### 1. Shared field metadata and simpler units

Define the resolved field descriptor, unit registry, source/display terminology, uncertainty/provenance metadata, and override scope. Keep legacy definitions/translations compatible. Add personal-description storage with account/vehicle permissions. This foundation makes the focused editor useful without forcing a backend/schema rewrite of received telemetry.

Completion: existing FMM003/experimental profile translations remain compatible; readable unit choices match supported conversions; raw values/types are preserved; personal names cannot change shared conversion behavior.

### 2. Graph-to-field-editor workflow

Extract the existing inspector/card, open it from the suffix, support unknown-key drafts and personal guesses, preserve the graph, and refresh resolved profile contexts after save. Use a field-level update against the latest profile revision so an older whole-profile draft cannot erase other edits.

Completion: click/save/cancel works for known, unknown, derived, and non-Teltonika fields; mouse/keyboard actions do not toggle a graph checkbox accidentally; state and focus survive; failed/conflicting shared saves retain drafts; another account does not inherit a personal name. Multi-profile graph rows identify which source interpretation is being edited.

### 3. Discovery and catalog suggestions

Add observed-field inventory and source metadata capture, import the existing ledgers into structured candidates, implement conservative matching and statuses, automatic eligible matches, undo/dismissal, and batch review. Expand diagnostics beyond the current key allowlist while respecting the viewer's vehicle permissions and treating identifiers/sensitive samples appropriately.

Completion: the same raw key can resolve differently on different tracker models; exact-model catalog suggestions take precedence over cross-profile suggestions in graph labels, while both remain visibly uncertain; wrong-model or ambiguous candidates stay yellow; plausible numeric values alone never activate a conversion; undone matches stay dismissed; updates preserve user choices. New unrelated keys appear without application code changes.

### 4. Revisions, historical resolution, and pilot rollout

Introduce profile revisions and effective source assignments before automatic conversion changes are enabled in production. Pilot with the FMM00A Silverado, the existing FMM003 data, one experimental Teltonika profile, and one Queclink profile. Synthetic cases prove workflow behavior; they do not certify unobserved hardware mappings. Unsupported real-world mappings remain suggestions until evidence exists.

Completion: device moves/swaps, decoder-key changes, mixed-source trips, two administrators, and old exports all resolve predictably. Cross-check selected displayed values against the API and documented input representation. Test genuine invariants: storage preservation, conversion agreement across graph/status/report/export, permission boundaries, revision conflicts, no double conversion, and graph-state preservation.

Catalog coverage can expand continuously after this infrastructure ships. FMM00A's six keys are an initial discovery case; availability of many models must not depend on separately hand-editing every user's profile.

### Current implementation note

The graph field editor now has an administrator scope choice for a tracker-specific mapping or the existing shared profile mapping. Tracker-specific edits are appended to `telemetry_source_mapping_revisions`, keyed by the current Traccar device ID and field key. The API records the effective time on save, uses per-field revision checks, and returns history to the graph. An admin can undo the latest tracker-only edit: the previous tracker mapping is appended as a new revision, or the override is cleared so the shared profile applies. Each graph point resolves the latest mapping effective at that point's timestamp, so an edit does not silently change earlier telemetry. The API creates the additive history table and index during startup; restarting the API applies that schema without a separate SQL command.

The current integration uses Traccar device IDs because graph points and bindings expose that identity today. If this installation later connects multiple independent Traccar servers with overlapping device IDs, add the configured Traccar source ID to graph groups, the mapping key, and the API routes before enabling mappings across those sources. Vehicle profile assignments are append-only revisions with an explicit effective timestamp; the Vehicle Catalog has a separate Profile effective from control. The API creates the assignment table/index and baseline rows during startup. Restart the API to apply this schema; no manual SQL is needed. Until that restart, the frontend gracefully falls back to current profile assignments.

A corrected Traccar device-model field changes how future packets are decoded; it does not invalidate older positions from a physically identified tracker. Preserve and map those historical raw `io<ID>` observations in the application instead of requiring a new trip or rewriting position records just to repair their labels. When the corrected model causes future keys to normalize, map both the historical raw keys and the normalized keys when the installed decoder supports both representations.

FMM00A catalog review (2026-10-15): the research catalog includes `io1593` and OBD fields `io540`–`io542` as exact-model, label-only suggestions because Teltonika lists FMM00A support while the pinned Traccar decoder preserves these fields as raw `io<ID>` values. OBD reporting still depends on vehicle and tracker configuration, so the entries intentionally carry no unit or conversion and remain yellow until observed and confirmed. AVL `io31`–`io36` remain suggestions where the manufacturer table does not list FMM00A support. Catalog tests and the production build pass; runtime behavior still needs a naturally occurring matching key to exercise the suggestion display.

Catalog evidence audit (2026-10-15): Traccar decoder citations across the research catalogs are pinned to v6.14.5 and describe the emitted API key. Manufacturer citations carry the field meaning and support context. This keeps a normalized Traccar attribute name from being mistaken for proof of a tracker-specific unit or physical meaning; all imported candidates remain label-only suggestions pending device-level confirmation.

Exact-model support audit (2026-10-15): Teltonika's FMC003 and FMC130 tables omit several common I/O IDs that appeared in the imported research subset. Those keys can still be useful to suggest when they are observed, but their catalog suggestions now omit the unsupported AVL-ID link and explain the model-support gap. Documented FMC003 AVL 389 and FMC130 AVL 68 associations remain linked. No units or conversions were added.

Queclink source review (2026-10-15): public protocol documents used for the GV300/GV55 suggestions are third-party-hosted mirrors, so the UI now says this in each uncertainty reason and keeps the candidates label-only. The GV300 analog-input labels additionally cite Queclink's official product specification for hardware/pin context, not protocol-key or value semantics. A vendor-issued protocol copy or real matching device sample is still needed before any of these suggestions could be promoted.

## Principal references

- `docs/DEVICE_PROTOCOL_PROFILES.md`, `docs/DEVICE_PROTOCOL_PROFILE_TODO.md`, `docs/TELTONIKA_FMB003_DATA_CATALOG.md`, and `device-profiles/README.md`.
- Workspace evidence: `../DEVICE_PROFILE_EXPANSION_PROGRESS.md` and `../AddingOtherDevices/Output/` relative to the repository root. These are local review material and are not required runtime resources.
- [Teltonika FMM00A AVL reference](https://wiki.teltonika-gps.com/view/FMM00A_Teltonika_Data_Sending_Parameters_ID): manufacturer meanings require model/hardware/firmware context.
- [Traccar Teltonika decoder at v6.14.5](https://github.com/traccar/traccar/blob/v6.14.5/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java): pinned reference for generic `io<ID>` fallback and the model-scoped AVL 247 alarm handler. Confirm the actual installed release and device model before treating it as the current decoder contract.


FMB120 model-support audit (2026-10-15): the official FMB-family AVL table explicitly lists FMB120 for each AVL ID represented in the current 15-field research catalog. The exact FMB120 page remains the field-name citation; the family table supplies independently readable hardware-support evidence. These candidates remain yellow and label-only because the deployed firmware/configuration and received Traccar attribute are not confirmed. The audit adds no units, conversions, or automatic mappings.


Normalized-key automatic-match support (2026-10-15): the documented-match gate now accepts a catalog entry’s explicit `alternateTraccarKeys` in addition to its primary raw key. It still requires the full approved model/firmware/decoder/configuration context, approved titled HTTPS evidence, explicit units and measurement identity, no competing interpretation, and no existing mapping. The returned match retains the catalog key and records that the observed key matched through an alias. Yellow research suggestions remain ineligible.


Unknown-field inventory check (2026-10-15): unplotted-field summaries retain zero-only numeric keys and summarize only type/count/time/source metadata; they do not copy raw values. Added a regression case for an always-zero unknown AVL key so it remains discoverable/editable even when it has no meaningful graph series. Direct function assertions pass.
Mapping-history state fix (2026-10-15): automatic, manual, and undo saves now append revisions through one immutable helper. This avoids duplicating a successful automatic revision through an in-place React state mutation and keeps undo pointed at the preceding mapping; a regression test covers preservation and undo target.

## User-submitted profile review package (2026-10-15)

Any signed-in user can prepare a review request from the visual Device Protocol Profile editor, including the current unsaved draft, a selected device, a date range, and an optional note. The selected date range is limited to 14 days. Every point returned for that range is included without downsampling, up to a 100,000-point safety ceiling; the interface reports the full included count.

The To address is fixed to support@rvthinker.com; the subject starts with Traccar React:. The user sees the recipient, subject, and concise body before sending. The full proposed profile and selected points are packaged as a ZIP containing `submission.json` and a README. Every point returned for the selected range is retained, without downsampling. All telemetry fields are included by default; a responsive two-column switch list lets users exclude individual fields, and the excluded JSON paths are recorded in the ZIP. The interface says support will use the submission only to create or update shared device profiles. Direct submission attaches this ZIP. When sending manually, the user can download the same ZIP, copy the three email fields, and attach it themselves. The send handler rebuilds the profile and message from the current profile, note, dates, and field choices at the time the user clicks send. Older clients without field selections retain the previous default identifier/location filtering for compatibility.

The signed-in user's saved name and email are included by default when both are present, with a visible checkbox to exclude them; the API obtains those details from the authenticated account rather than trusting contact data from the browser. The readiness message reports the configured provider and missing settings, including the Graph sender mailbox when needed, to match the email-alert readiness check. Sending is explicit, rate-limited, and addressed only to support. Microsoft Graph's simple attachment endpoint accepts files under 3 MB; when the ZIP exceeds the local safe threshold, the UI directs the user to download it and send it manually. A suggestion never saves or publishes shared profile changes; administrators still review and apply accepted mappings. The API does not persist the submitted tracking sample.

## Scope closure and finite exit check (2026-10-15)

The agreed software scope, including the user-submitted review workflow documented above, is implemented: source-aware discovery, a focused field editor with personal/shared scopes, evidence-labeled suggestions, fail-closed automatic application with undo, and effective-dated profile/source history. Do not add adjacent UI, catalog, or architecture work unless validation exposes a defect in these behaviors. The remaining end-to-end gate is a fresh Silverado capture after Traccar reports model `FMM00A`: confirm the received keys and units against that decoder context, verify historical October 14 raw records retain their prior interpretation, and close with the normal test/build checks when the project runner is available. Unsupported or unobserved meanings remain yellow suggestions; that is the intended outcome, not an unfinished feature. Once this gate passes, close this phase rather than opening a new enhancement list.


## Implementation review, 2026-10-16

### Assessment and scope

The feature set is substantially implemented. Discovery no longer depends on a short allowlist, the focused editor supports personal and administrator workflows, received data remains separate from interpretation, research catalogs are conservative, and revision/undo infrastructure exists. The contribution package follows the later decisions to include every returned point, offer field exclusions, and rebuild the note/profile at send time. Keep these design choices.

However, implementation presence is not the same as release acceptance. The most significant gaps are permission enforcement and agreement between displays. Correct the defects below before describing the multi-user behavior as complete. This is a finite correction list, not a new feature phase.

Review baseline: local master at b1066af, with 31 modified tracked files and 38 untracked status entries before this document update. Untracked directories count as single status entries. HEAD has no commits ahead of the locally recorded origin/master; the pending work is in the working tree, including new endpoint files, libraries, catalogs, tests, and this plan. No remote fetch was performed, so this does not certify the remote's current head. Review covered the telemetry paths and associated unpublished proxy, settings, account, email, report, and map changes. No application code, database records, email deliveries, or Git commits were changed during this review.

### Corrections, in priority order

#### R1 — P1: The shared Traccar proxy grants ordinary users the shared account's upstream privileges

Evidence: backend/VehicleApp.Api/TraccarProxyEndpoints.cs:9-14 forwards GET, HEAD, POST, PUT, PATCH, and DELETE for an unrestricted path. Line 53 replaces caller credentials with the installation's shared Basic credentials. The route requires authentication but neither an administrator role nor device-level access. Program.cs's configuration-write middleware does not include this proxy route.

An ordinary signed-in user can therefore request upstream routes outside their VehicleApp permissions, including writes if the configured Traccar account permits them. Client-side filtering cannot protect those routes.

Correction: allowlist the upstream routes and methods actually required by the application. Check the current user's device/vehicle/group permissions before upstream reads; filter collection responses server-side where appropriate. Authorize configuration writes separately, with administrator-only access where intended. Do not expose an unrestricted upstream API under a shared privileged account. Keep the password encrypted and server-side as currently implemented.

Acceptance: using a non-admin test account, permitted device reads succeed, another user's devices/positions are inaccessible, and configuration writes are rejected without reaching a fake upstream. Test both collection and deviceId-query routes. This can be tested without modifying live trackers.

#### R2 — P1: Inventory and source-mapping reads do not check access to the requested device — corrected in code, verification pending

Evidence: TelemetryFieldInventoryEndpoints.cs:521-539 accepts any positive device ID after authentication. Its background service scans with shared Traccar credentials at lines 184-191. TelemetrySourceMappingEndpoints.cs:16-39 returns mapping history for an arbitrary device ID; AuthorizeAsync only checks for an active account and optionally the administrator role.

A user can enumerate another device's field names, observation timestamps/counts, and mapping history, including changedBy identities. Inventory GET can also enqueue a shared-account scan, and retry has no device authorization or request throttling. These are separate leaks even after the proxy is fixed.

Correction: reuse one server-side effective device-access check for inventory GET/retry and mapping GET. Define retry permissions and throttle expensive work. Keep shared mapping writes restricted to administrators. Check authorization before reading cached metadata or queueing work, not only at the Traccar server.

Acceptance: two ordinary users with disjoint device access cannot read or queue work for each other's device IDs; authorized group access still works; administrators retain intended access.

#### R3 — P1: Status cards and map popups can apply a normalized key's conversion to an unconfirmed raw AVL key — corrected in code, verification pending

Evidence: src/lib/statusCardFields.js:83-130 infers aliases from an AVL number, synthesizes io<ID> alternatives, and selects a descriptive mapping for translation. VehicleStatusCard.jsx:109-128 then passes the raw value under that selected profile key to translateAttribute. The current bundled FMM00A profile defines coolantTemp, but has no explicit io32 mapping.

Reproduced in memory using the actual helpers and bundled profile: a synthetic io32 value of 20 translates as unmapped value 20 with no unit in the graph's raw-key path. The status helper selects coolantTemp and translates that same value to 68 °F. This demonstrates inconsistent interpretation; it is not evidence about the physical unit of a real io32 sample. The pre-existing status-card alias test now asserts that AVL-number matches do not share conversion identity.

Correction: separate grouping/display aliases from conversion equivalence. Sharing an AVL number can offer a descriptive suggestion, but it must not authorize borrowing the normalized representation's units, scale, offset, or sentinel rules. Translate the exact received key unless an explicit, reviewed representation alias or source mapping establishes equivalence. Preserve a raw field's own mapping even when a normalized alternative exists.

Acceptance: raw-only, normalized-only, and simultaneously present raw/normalized inputs behave consistently across graph, status, and map popup; an unconfirmed raw field stays raw. Include a case where the two representations deliberately have different scales.

#### R4 — P1: Tracker-specific revisions are applied in the graph but not the other consumers — corrected in code, verification pending

Evidence: TelemetryGraphViewer.jsx:236-243 builds per-point source mapping resolvers from fetched revisions. App.jsx:4264 supplies VehicleStatusCard only profileContextFor(...).profile; that resolver selects a vehicle's profile and does not apply source-mapping revisions. Export construction at App.jsx:3433 also uses the base profile context. ReportsWorkspace resolves assignment history but does not compose tracker-specific revisions.

Reproduced with the shared helper: an effective tracker override with scale 0.1 changes a synthetic received value 120 to 12 V; the unchanged base profile still returns unmapped 120. That is the discrepancy these separate paths permit. A successful focused tracker edit cannot reliably mean the same thing throughout the app.

Correction: move source-revision loading/caching and effective-time composition into a shared interpretation service used by graph, status, popup, reports, and interpreted exports. Pass the telemetry timestamp and source identity into that service. Keep raw exports raw and identify them as such. Preserve frozen public-share snapshots rather than reinterpreting them silently.

Acceptance: for one explicit override, the same point has the same interpreted value/unit everywhere before its effective time, after its effective time, and after undo. Test historical selection as well as live status.

#### R5 — P2: Numeric graph rows still combine different sources under one raw key — corrected in code, verification pending

Evidence: TelemetryGraphViewer.jsx:254-269 creates one availableKeys Set across all groups; lines 395-405 build one numeric series per key from all points. contextForKey at lines 411-426 chooses one source's latest point for editing, while profileForKey chooses a first matching point for other labels. Unplotted fields already carry sourceKey, so the two inventories behave differently.

If two trackers emit io1 with different meanings or units, the graph can connect their values in one series, show one label, and open the editor for only one of the sources. Even equal meanings should not create a misleading route/series transition between different vehicles without an explicit grouping rule.

Correction: use source identity plus raw key as the numeric row/series/edit target identity. Only combine compatible measurements through an explicit rule. Include source context in labels when needed. Preserve current plot scaling within each resulting series. The implementation now applies that composite identity to selection persistence, plot paths, colors, editor targets, and share-series metadata. Legacy key-only saved selections migrate to matching source-specific rows. Missing values on other sources break the SVG path so it cannot draw a cross-source segment.

Acceptance: a two-device graph with the same key but different mappings shows separate values, labels, colors/selections, and edit targets; no cross-source line segment is drawn. Editing either row affects its intended source only.

#### R6 — P2: Shared-profile snapshots are recorded, but historical resolution still uses the latest definition — effective-time resolution implemented; verification pending

Evidence: carProfiles.js:492-529 resolves an effective profile ID and then reads profileMap[profileId]. It does not select an immutable definition revision for the point time. saveGraphFieldMapping replaces the shared definition, and existing graph contexts are refreshed with that latest definition. Each graph group also starts with one base profile selected at the trip start; a profile assignment changing within a group is not resolved per point.

The history infrastructure therefore supports audit/undo and assignment selection, but does not yet guarantee that older telemetry retains its previous shared conversion. A shared scale edit can change old displayed values. This differs from future-only tracker edits and should not be hidden behind a general claim of historical stability.

Correction: bind historical interpretation to a definition revision/effective interval, while ordinary shared edits take effect from the save time forward. Resolve assignment boundaries per point or split groups/windows at boundaries. Do not impose frozen historical labels where only a personal description changed. The graph resolves the vehicle's profile assignment at each telemetry timestamp and refuses combined share/export when selected points span different assignments or shared profile revisions, including within one trip. Reports and interpreted exports resolve assignment context per point. Shared profile revisions now carry `effective_at`; the API exposes sanitized snapshots to authenticated users, and App resolves the snapshot effective at each sample timestamp before applying tracker-specific mappings. Admin audit history displays both effective and recorded times. Existing snapshots are backfilled from `created_at`, with the oldest retained revision set as the baseline because its original effective time was not recorded; this legacy boundary is approximate. New revisions record the profile row's `updated_at` as their effective time.

Acceptance still required: after applying the schema migration and restarting the API, change a shared scale and confirm older and newer points use the corresponding snapshots. Include an assignment boundary inside one trip/report window and verify graph, report, interpreted CSV, share refusal, and administrative history agree on both sides. Verify that a deliberate revision restore creates a new forward-effective snapshot and leaves prior history unchanged.

#### R7 — P2: Changing the sample device or dates during collection can mislabel a support ZIP — corrected in code, verification pending

Evidence: TelemetryProfileSubmissionDialog.jsx:134-164 fetches points for the device/range captured when gathering begins, then unconditionally installs the response. The device/date controls at lines 271-283 remain enabled. Their handlers clear prepared state, but do not invalidate an in-flight request. The draft subsequently uses the current dates and the returned positions.

If a user starts gathering for device/range A and switches to B while it loads, A's result can repopulate the dialog under B's selected dates/device. Rebuilding the note and profile at send time is correct and should be retained; sample identity needs its own immutable capture.

Correction: attach a request generation token or AbortController to gathering, discard results when the selection changes, and store the gathered source/range alongside the points. Permit note/profile/exclusion edits before send, but require gathering again after a device/date change.

Acceptance: resolve a deliberately delayed A request after switching to B; no A points become sendable under B. Check ZIP metadata and preview as well as the send request.

### Smaller gaps and maintenance recommendations

- Preserve unknown definition-level metadata through the full profile editor. App.jsx:3744 saveProfileEdits reconstructs the definition using only id, name, schemaVersion, and attributeMap. This can discard future provenance/catalog metadata even though the focused shared-save path spreads the existing definition. Define the fields supported by persistence/import/export and add a round-trip check before relying on new top-level metadata.
- The field inventory is keyed by Traccar device ID, not by the vehicle's historical source intervals. That works for the current attached tracker, but is not yet an all-trackers-ever-used inventory for a vehicle. Document this scope; when supporting swaps, combine only the vehicle's authorized binding intervals rather than another vehicle's entire tracker history.
- Inventory refresh resumes beyond scannedThrough. Delayed/backfilled records whose queried timestamps fall before that cursor may not introduce their fields into the cache. Clarify the supported ingestion/backfill contract and provide a deliberate rebuild or bounded overlap strategy with deduplication if required. Do not rescan all history on graph open.
- Shared/source save endpoints validate outer JSON shape, but source mapping PUT does not apply the frontend's full mapping/conversion validation. Add equivalent server-side validation when correcting the interpretation path, so malformed or incompatible units/scales are rejected consistently.
- The FMM00A entry's legacy internal ID teltonika-fmm003 is confusing but already stored in assignments. Keep it stable for this correction phase; document it and use a separate migration only if renaming later becomes necessary.
- Batch acceptance is described in the design, but the reviewed UI exposes individual acceptance and the current catalogs intentionally contain no automatic-eligible entries. Record batch review as dormant/deferred while there are no eligible mappings, rather than adding a new UI solely to claim completion.
- Separate the eventual Git commits into coherent reviewable changes: permission fixes; telemetry interpretation/history; discovery/editor/inventory; support submissions; account/map UI; documentation/tests. Include the currently untracked files, especially endpoint/schema/catalog files. This is packaging advice, not authorization to commit or push.

### Validation performed at this checkpoint

- All six shipped research catalogs passed their existing validateResearchCatalog function in process. This validates structure and conservative flags, not the scientific correctness or current availability of cited documentation. No new manufacturer/decoder evidence was asserted, so no external source audit was performed.
- All seven shipped device-profile JSON files parsed and passed validateAttributeMap in process.
- Direct checks exercised the existing source-mapping helper before and after an effective timestamp and confirmed null-mapping undo clears the override. The raw io32/normalized coolantTemp discrepancy above was reproduced using actual helper code and a synthetic value.
- The in-process checks evaluated the existing JS helper bodies with imported dependencies supplied in memory and the browser-only import.meta.glob path disabled. They are targeted checks, not a substitute for the normal Node test suite or browser interaction tests.
- Vite returned HTTP 200 for the current App, graph, focused editor, full profile editor, submission dialog, and user-profile modules. This verifies transformation, not visual layout or end-to-end behavior.
- One bounded normal Node test-suite invocation failed before executing tests with the known EPERM lstat error on D:\Cust\Developement. It was launched with the repository as its explicit working directory; Node's internal test discovery traversed the ancestor. The process exited immediately, and no ancestor-folder workaround was attempted. The older 115-test/build success statements above describe prior checkpoints and must not be treated as fresh results for this working tree.
- The API project built after the access-control and resolver changes with zero warnings and errors. The production frontend build could not be launched through the normal npm entry point in this environment; direct Node invocation failed before Vite started with the known EPERM lstat error on D:\Cust\Developement. No ancestor-folder workaround was attempted. No authenticated two-user integration test, visual browser QA, or live telemetry/package delivery was performed, so those behaviors remain unverified.

### Finite acceptance recommendation

Keep feature expansion closed. R1-R5 and R7 have implementation corrections but still require the acceptance checks above. The graph separates same-named fields by source; its cross-source behavior has had a code-path review, but no two-device browser test has been completed. R6 now has implementation support for effective-dated shared revisions, but it is not release-accepted until the schema migration is applied and the historical checks above pass. Historical October 14 raw data, the newer Silverado sample, and synthetic fixtures are sufficient; no additional drive is required. Catalog coverage, new tracker models, and optional maintenance improvements can remain later work.

### Follow-up validation, 2026-10-16

- Fixed the API compile error reported by the user by adding the `Npgsql` namespace import to `TraccarProxyEndpoints.cs`. A normal output build later found `VehicleApp.Api.exe` locked and did not overwrite it; building with `UseAppHost=false` to `.artifacts/profile-history-build` succeeded with zero warnings and errors. No API process was started or stopped by this check.
- The running Vite dev server returned HTTP 200 with transformed source for `TelemetryGraphViewer.jsx`, `App.jsx`, `ReportsWorkspace.jsx`, and `DeviceProtocolProfileEditor.jsx` after effective-time resolution was wired through.
- The standard Node CLI test invocation fails before loading tests with `EPERM lstat D:\Cust\Developement`. Running the same `node:test` files through Node's in-process `run()` API avoided CLI entry-point path resolution: all 24 files and 135 tests passed, including the new effective-revision selection and shared-history API tests. No ancestor-path workaround was attempted.
- No authenticated multi-user integration test or browser interaction test was performed. R1-R5 and R7 therefore remain implementation corrections pending their documented acceptance checks. R6's effective-time path has not yet been exercised against PostgreSQL or historical graph/report data; apply the updated schema before testing it.
- Git status was inspected using a per-command safe-directory setting; the large working tree remains unpublished (`master...origin/master`) and includes the existing feature work plus the current review corrections. Nothing was committed or pushed.

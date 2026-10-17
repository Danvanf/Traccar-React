# Device field catalog research

This folder contains reviewed or in-progress field evidence records. Every `*.json` file here is bundled automatically, so adding a catalog record does not require a runtime import change. Research candidates can appear at runtime as yellow, label-only suggestions when the raw key and exact Traccar device model match; they do not change units, conversions, or vehicle profile mappings. Only definitions in `device-profiles/*.json` are bundled as selectable profiles.

Use `status: "suggestion"` when some evidence supports a meaning but the exact device, firmware, decoder, configuration, or API representation is not fully verified. Include a manufacturer, exact model, raw Traccar key, readable label, reason for uncertainty, and cited evidence. Keep `autoApply` false until the documented-match gate has every required scope value and the entry has been reviewed. Never include private position samples, identifiers, or credentials in catalog files.

The workspace CSV ledgers are research inputs, not runtime catalog files. Import a row only after its device scope, decoder/API key, units, and source are clear. Preserve unresolved conflicts as unresolved; do not turn illustrative examples into observations or automatic mappings.

The FMM00A record captures initial evidence from the Silverado and separates manufacturer wire semantics from Traccar API representation. Its PCB temperature label is offered only as a personal guess. It intentionally leaves AVL 247 unresolved.

The FMB120, FMC003, FMC130, GV300, and GV55 research files contain a small, label-only subset imported from the workspace evidence ledgers. Each candidate is scoped to its exact tracker model, includes a source link, and repeats the ledger's verification caveat. No ledger values, units, or conversions are imported. Teltonika AVL 247 and other rows with unresolved decoder-key conflicts are excluded. The editor shows the cited sources beside each catalog suggestion.

The FMC003 and FMC130 lists also contain observed/common Traccar keys for which the Teltonika hardware-support table does not list that exact model at the corresponding AVL ID. These remain unlinked label suggestions only: the catalog omits the manufacturer AVL ID and states the model-support gap, so the UI does not imply that the observed key came from that AVL field. Entries with explicit model support, such as FMC003 AVL 389 and FMC130 AVL 68, retain their AVL association while still carrying no conversion.

Queclink's protocol documents in the current GV300/GV55 subset are hosted on third-party mirrors; the app discloses this in each candidate's uncertainty reason. They remain yellow label guesses, not accepted mappings. The GV300 analog-input candidates also cite Queclink's official product specification for hardware context, while explicitly noting that the specification does not define Traccar keys or wire-value semantics. Replace mirrored protocol links with vendor-issued copies if they become available.

Traccar decoder links in these catalogs are pinned to v6.14.5, the version observed in the development installation during this review. Keep decoder references pinned to the release being reviewed; a `master` link can change its emitted keys or value handling without a catalog change.

Keep evidence roles distinct: a manufacturer reference establishes its field meaning, units, support, and configuration limits; a Traccar decoder reference establishes which API attribute is emitted and any decoder-side transformation. A decoder's position key alone does not prove the physical meaning or source unit of a tracker-specific field.

## Reviewed manufacturer dictionaries

The nested [teltonika](teltonika/) namespace contains a complete factual FMX003 reference (349 IDs) and a reviewed mapping dictionary with per-model overrides. It supplies the FMM003/FMM00A portable profiles through scripts/build_teltonika_profiles.mjs. These nested files are not loaded as root-level research suggestions by the application glob.

Research catalogs remain label-only fallbacks. Promoting a definition into a reviewed profile does not grant permission to apply its conversions to another model, firmware or decoded representation. Future brands need separate namespaces and explicit model scope. See the [reference and reuse design](../docs/TELTONIKA_FMM003_FMM00A_AVL_REFERENCE.md).

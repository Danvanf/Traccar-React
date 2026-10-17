# Natural language vehicle queries: first release

## What this release does

The map screen has an **Ask** entry point for questions about saved trip summaries. The first release recognizes five measures: trip count, distance, driving time, highest recorded speed, and recorded event count. It can use a named vehicle or all vehicles the signed-in user is permitted to see.

Ask remains experimental and is hidden by default. In a Vite development browser, append `?experimentalAsk=true` to the local app URL to show it with a yellow outline. Production builds always hide it, even if that query parameter is present.

Date phrases supported today are today, yesterday, this week/month to date, last calendar week/month, the last 7 days, and explicit `YYYY-MM-DD to YYYY-MM-DD` ranges. If no period is given, it uses the last seven local calendar days. The panel shows the interpreted measure, vehicle scope, and date range before presenting the result.

## Data flow and privacy

The parser runs in the browser and produces only a fixed query plan. It calls the existing authenticated usage-summary report endpoint, which applies vehicle access rules and returns daily aggregates. The query screen does not request trip-by-trip coordinates, raw Traccar positions, VINs, or device identifiers, and it does not call an external language model. It cannot write data or generate SQL.

## Current limits

This is intentionally a small deterministic vocabulary, not a general assistant. It does not yet search destinations, classify event types, answer live-location questions, compare telemetry fields, or make profile-mapping claims. Questions about sensor values should be added only when the query can follow the graph's time-specific profile and mapping-resolution path and show its confidence accurately.

The next meaningful expansion depends on real, varied records: multiple vehicles with distinct trip patterns, event examples, and telemetry samples under confirmed and suggested mappings. Those examples will tell us which language patterns and result explanations are useful without making unsupported assumptions. Until that data is available, the five measures above define the complete supported scope for this first release.

> **Archived snapshot (2026-10-18).** Historical investigation. Its support/query-contract follow-up was unresolved as of the capture date; current status has not been verified here.
>
> This file records the original project discussion and its status at that time. Verify claims and commands against the current code and documentation before reusing them.

# Bouncie REST import investigation — 2026-10-07

## Result

The development workstation development API (sharing Traccar host's sole PostgreSQL database) makes authenticated Bouncie `GET https://api.bouncie.dev/v1/trips` requests. Bouncie returns HTTP 200 and an empty JSON array for dates with trips visible in its web UI. This was reproduced after replacing and reauthorizing the Bouncie app connection.

Read-only local probe results:

| Vehicle / interval (UTC) | `gpsFormat=geojson` | `gpsFormat=polyline` | No `gpsFormat` |
| --- | --- | --- | --- |
| test vehicle, 2021-12-29 05:00–2021-12-30 05:00 | 200, `[]` | 200, `[]` | 400 |
| test vehicle, 2021-12-28 00:00–2021-12-31 00:00 | 200, `[]` | 200, `[]` | 400 |
| Truck, 2022-01-01 05:00–2022-01-08 05:00 | 200, `[]` | 200, `[]` | 400 |
| test vehicle, 2022-01-01 05:00–2022-01-08 05:00 | 200, `[]` | 200, `[]` | 400 |

The import parser receives zero elements. The zero result occurs before persistence and cannot be fixed by deleting import checkpoints. A normal OAuth connection and vehicle list confirm that some API calls work; they do not prove historical trip retrieval works.

Dan confirms the January 2022 records were previously downloaded through the REST API; the CSV path was only used for testing and caused duplicates. The later zero-row database audit does not overturn that history—the queried records are no longer present in the current database.

## Code findings

- `backend/TraccarReact.Api/BouncieRestService.cs`: `BuildTripsPath` sends IMEI, UTC `startsAfter`, UTC `endsBefore`, and `gpsFormat=geojson`; `GetJsonAsync` sends the raw access token as `Authorization`. This matches Bouncie's published base URL and token-header convention. The exact trip filter semantics are not conclusively validated against an official endpoint reference.
- The original committed importer also sent `includeGps=true`. A fresh probe of the known test vehicle date tested that exact old request shape: it also returned HTTP 200 with `[]`. The flag removal does not explain the current zero results.
- The same service marks every 200/empty trip response as a **completed** checkpoint. Coverage therefore means “queried,” not “historical trips received.” A transient or incorrect empty answer becomes a durable gap until its checkpoint is deleted. This is a Traccar React behavior to revisit after the upstream issue is understood.
- `backend/TraccarReact.Api/BouncieImportEndpoints.cs` handles both browser CSV and REST rows. REST rows carry `external_metadata.source = 'bouncie-rest-v1'`; CSV rows generally have `derivation_version = 'bouncie-csv-v1'` without that REST marker. Dan confirms the January 2022 records previously came through REST; the current database query returns zero because those rows are no longer present.
- The temporary probe is at `/api/integrations/bouncie/diagnostic/trips`, only in Development from loopback. It returns counts and field names, not tokens or trip locations.

## Database source audit (completed)

The read-only query in `scripts/audit_bouncie_saved_sources.sql` returned zero rows for Dec 2021–Jan 2022. This is consistent with the trip rows having since been removed. Dan confirms those former January records came from REST, so this audit cannot identify their source now.

The query is retained for future use; from Traccar host's project directory:

```bash
sudo docker exec -i traccar-db psql -U traccar -d traccar_react_api < ./scripts/audit_bouncie_saved_sources.sql
```

The query is also reproduced here for reference:

```sql
select v.display_name,
       date_trunc('month', t.started_at at time zone 'UTC')::date as month_utc,
       case
         when t.external_metadata ->> 'source' = 'bouncie-rest-v1' then 'bouncie-rest'
         when t.derivation_version = 'bouncie-csv-v1' then 'bouncie-csv-or-other'
         else coalesce(t.derivation_version, 'other')
       end as saved_source,
       count(*) as trips,
       min(t.started_at) as first_trip_utc,
       max(t.started_at) as last_trip_utc
from trips t
join vehicles v on v.id = t.vehicle_id
where t.started_at >= timestamptz '2021-12-01 00:00:00+00'
  and t.started_at <  timestamptz '2022-02-01 00:00:00+00'
group by 1, 2, 3
order by 1, 2, 3;
```

The known test vehicle date returns `200 []` with both current query parameters and the original `includeGps=true` request. This points to Bouncie's trip response or a remaining query-contract mismatch. A useful next test is to compare an exact trip transaction ID (if visible in Bouncie's trip details) against the date-window query. Bouncie support can also investigate this response; provide the app ID and UTC interval, never tokens.

The previously attached trip-history page captures contain no transaction IDs. The public Bouncie docs we could access describe OAuth and the API base, but don't expose a detailed `/trips` query schema, so support confirmation of filter semantics is useful.

Suggested support request:

> Our app's OAuth connection succeeds and lists both authorized vehicles. A GET to `/v1/trips` for the test vehicle (device identifier omitted), with `gpsFormat=geojson`, `includeGps=true`, `startsAfter=2021-12-29T05:00:00Z`, and `endsBefore=2021-12-30T05:00:00Z`, returns HTTP 200 with an empty array. The Bouncie web history shows multiple trips on Dec 29, 2021. A new authorization using a newly issued app credential behaves the same. Is this historical date supported for REST trip lookup, and are these query parameters correct for the current API? Please check whether this account/app has REST access to those historical trips.

Never include access tokens, refresh tokens, client secrets, or full vehicle identifiers in a support ticket unless Bouncie requests them through a secure channel.

Do not run a broad reimport yet: every empty week is currently checkpointed as complete. The API can be probed without modifying checkpoints.

## Handoff

This investigation is sufficiently bounded for a lower cost assistant. Remaining work is to find a transaction ID if Bouncie exposes one, or use the prepared support request to confirm historical-trip access and current filter semantics.

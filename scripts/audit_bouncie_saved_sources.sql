-- Read-only audit: how did the trips visible around January 2022 enter TraccarScopeApi?
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

-- Phase 6 read-only maintenance report for vehicle_app.
select schemaname, relname as table_name, n_live_tup::bigint as estimated_rows,
       n_dead_tup::bigint as estimated_dead_rows, last_analyze, last_autoanalyze,
       last_vacuum, last_autovacuum,
       case when n_dead_tup > greatest(n_live_tup * 0.2, 10000) then 'REVIEW: dead rows > 20%'
            when coalesce(last_analyze, last_autoanalyze) is null then 'REVIEW: never analyzed'
            when coalesce(last_analyze, last_autoanalyze) < now() - interval '14 days' then 'WATCH: analyze older than 14 days'
            else 'OK' end as maintenance_status
from pg_stat_user_tables
where schemaname = 'vehicle_app'
order by n_dead_tup desc, relname;

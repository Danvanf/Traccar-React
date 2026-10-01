-- Phase 6 read-only growth report for vehicle_app.
with table_sizes as (
  select c.relname as table_name, pg_total_relation_size(c.oid) as total_bytes,
         n_live_tup::bigint as estimated_rows
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_user_tables s on s.relid = c.oid
  where n.nspname = current_schema() and c.relkind = 'r'
)
select table_name, pg_size_pretty(total_bytes) as total_size, estimated_rows,
       case when total_bytes >= 10 * 1024 * 1024 * 1024 then 'REVIEW: table >= 10 GB'
            when total_bytes >= 1 * 1024 * 1024 * 1024 then 'WATCH: table >= 1 GB'
            else 'OK' end as size_status
from table_sizes order by total_bytes desc;

select pg_size_pretty(pg_database_size(current_database())) as database_total_size,
       pg_database_size(current_database()) as database_total_bytes,
       pg_size_pretty(sum(pg_total_relation_size(c.oid))) as vehicle_app_tables_size,
       sum(coalesce(s.n_live_tup, 0))::bigint as estimated_rows,
       case when pg_database_size(current_database()) >= 50 * 1024 * 1024 * 1024 then 'REVIEW: database >= 50 GB'
            when pg_database_size(current_database()) >= 10 * 1024 * 1024 * 1024 then 'WATCH: database >= 10 GB'
            else 'OK' end as schema_status
from pg_class c join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'vehicle_app' and c.relkind = 'r';

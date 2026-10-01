using Npgsql;

public static class OperationsReportEndpoints
{
    public static void MapOperationsReportEndpoints(this WebApplication app)
    {
        app.MapGet("/api/admin/reports/{report}", async (string report, NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
        {
            var allowed = new[] { "daily", "growth", "maintenance", "retention-preview" };
            if (!allowed.Contains(report, StringComparer.OrdinalIgnoreCase))
                return Results.BadRequest(new { error = "Unknown report." });

            var sql = report.ToLowerInvariant() switch
            {
                "daily" => """
                    select 'trips' as metric, count(*) filter (where created_at >= now() - interval '24 hours') as recent_count, max(created_at) as newest_at from trips
                    union all select 'dtc_events', count(*) filter (where created_at >= now() - interval '24 hours'), max(created_at) from dtc_events;
                    """,
                "growth" => """
                select table_name, total_size, estimated_rows
                from (
                    select 'DATABASE TOTAL' as table_name,
                           pg_size_pretty(pg_database_size(current_database())) as total_size,
                           null::bigint as estimated_rows,
                           0 as sort_order
                    union all
                    select c.relname,
                           pg_size_pretty(pg_total_relation_size(c.oid)),
                           coalesce(s.n_live_tup, 0)::bigint,
                           1
                    from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    left join pg_stat_user_tables s on s.relid = c.oid
                    where n.nspname = current_schema() and c.relkind = 'r'
                ) sizes
                order by sort_order, table_name;
                """,
                "maintenance" => """
                    select relname as table_name, n_live_tup::bigint as estimated_rows, n_dead_tup::bigint as estimated_dead_rows, last_analyze, last_autoanalyze, last_vacuum, last_autovacuum from pg_stat_user_tables order by n_dead_tup desc;
                    """,
                _ => """
                    select count(*) filter (where started_at < now() - interval '24 months') as trips_eligible_for_archive, min(started_at) as oldest_eligible_trip from trips;
                    """,
            };
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand(sql, connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var rows = new List<Dictionary<string, object?>>();
            while (await reader.ReadAsync(cancellationToken))
            {
                var row = new Dictionary<string, object?>();
                for (var index = 0; index < reader.FieldCount; index++)
                    row[reader.GetName(index)] = reader.IsDBNull(index) ? null : reader.GetValue(index);
                rows.Add(row);
            }
            return Results.Ok(new { report, generatedAtUtc = DateTimeOffset.UtcNow, rows });
        });
    }
}

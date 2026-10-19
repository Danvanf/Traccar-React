using Npgsql;

public static class TelemetrySourceMappingSchema
{
    public static async Task EnsureAsync(IServiceProvider services)
    {
        var dataSource = services.GetRequiredService<NpgsqlDataSource>();
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(
            """
            create table if not exists telemetry_source_mapping_revisions (
                traccar_device_id integer not null,
                field_key varchar(200) not null,
                revision bigint not null,
                effective_at timestamptz not null,
                mapping_json jsonb null,
                changed_by varchar(200) null,
                change_kind varchar(32) not null default 'manual',
                created_at timestamptz not null default now(),
                primary key (traccar_device_id, field_key, revision)
            );
            alter table telemetry_source_mapping_revisions
                add column if not exists change_kind varchar(32) not null default 'manual';
            create index if not exists ix_telemetry_source_mapping_effective
                on telemetry_source_mapping_revisions (traccar_device_id, field_key, effective_at desc, revision desc);
            """, connection);
        await command.ExecuteNonQueryAsync();
    }
}

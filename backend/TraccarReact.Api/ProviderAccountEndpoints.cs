using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

public static class ProviderAccountEndpoints
{
    private static readonly IReadOnlyDictionary<string, ProviderDefinition> Providers = new Dictionary<string, ProviderDefinition>(StringComparer.OrdinalIgnoreCase)
    {
        ["Graph"] = new("email", ["TenantId", "ClientId"], ["ClientSecret"]),
        ["Resend"] = new("email", ["From"], ["ApiKey", "WebhookSecret"]),
        ["Brevo"] = new("email", ["FromEmail", "FromName"], ["ApiKey", "WebhookToken"]),
        ["Twilio"] = new("sms", ["AccountSid", "ApiKeySid", "FromNumber", "WebhookBaseUrl", "WebhookUsername", "TestAccountSid"], ["ApiKeySecret", "WebhookPassword", "TestAuthToken"]),
        ["Textbelt"] = new("sms", [], ["ApiKey"]),
    };

    public static void MapProviderAccountEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/provider-accounts")
            .RequireAuthorization(policy => policy.RequireRole("admin"));

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapPut("/{accountId:guid}", UpdateAsync);
        group.MapPost("/rotate-credentials", RotateCredentialsAsync);
        group.MapGet("/vehicle-assignments/{channel}", ListVehicleAssignmentsAsync);
        group.MapPut("/vehicles/{vehicleId:guid}/{channel}", SetVehicleAssignmentAsync);
    }

    private static async Task<IResult> RotateCredentialsAsync(
        NpgsqlDataSource dataSource,
        CredentialProtectionService protection,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (!protection.CanProtect || string.IsNullOrWhiteSpace(protection.ActiveKeyId))
            return Results.Problem(protection.ConfigurationError ?? "Credential encryption is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);

        var rotated = 0;
        try
        {
            while (true)
            {
                await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
                await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
                var batch = new List<(Guid AccountId, string Name, string Ciphertext)>();
                await using (var select = new NpgsqlCommand("""
                    select a.id, s.secret_name, s.encrypted_value
                    from provider_accounts a
                    join provider_account_secrets s on s.account_id = a.id
                    where split_part(s.encrypted_value, '.', 2) <> @activeKeyId
                    order by a.id, s.secret_name
                    limit 100
                    for update of a, s
                    """, connection, transaction))
                {
                    select.Parameters.AddWithValue("activeKeyId", protection.ActiveKeyId);
                    await using var reader = await select.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                        batch.Add((reader.GetGuid(0), reader.GetString(1), reader.GetString(2)));
                }

                if (batch.Count == 0)
                {
                    await transaction.CommitAsync(cancellationToken);
                    break;
                }

                var changedByAccount = new Dictionary<Guid, List<string>>();
                foreach (var item in batch)
                {
                    var plaintext = protection.Unprotect(item.AccountId, item.Name, item.Ciphertext);
                    var replacement = protection.Protect(item.AccountId, item.Name, plaintext);
                    await using var updateSecret = new NpgsqlCommand("""
                        update provider_account_secrets
                        set encrypted_value = @replacement, updated_at = now()
                        where account_id = @accountId and secret_name = @name and encrypted_value = @old
                        """, connection, transaction);
                    updateSecret.Parameters.AddWithValue("replacement", replacement);
                    updateSecret.Parameters.AddWithValue("accountId", item.AccountId);
                    updateSecret.Parameters.AddWithValue("name", item.Name);
                    updateSecret.Parameters.AddWithValue("old", item.Ciphertext);
                    if (await updateSecret.ExecuteNonQueryAsync(cancellationToken) != 1)
                        throw new InvalidOperationException("A provider credential changed while key rotation was in progress.");
                    if (!changedByAccount.TryGetValue(item.AccountId, out var names))
                        changedByAccount[item.AccountId] = names = [];
                    names.Add($"secret:{item.Name}");
                }

                foreach (var (accountId, fields) in changedByAccount)
                {
                    await using (var updateAccount = new NpgsqlCommand("update provider_accounts set revision = revision + 1, updated_at = now() where id = @id", connection, transaction))
                    {
                        updateAccount.Parameters.AddWithValue("id", accountId);
                        await updateAccount.ExecuteNonQueryAsync(cancellationToken);
                    }
                    await WriteAuditAsync(connection, transaction, accountId, context.User.Identity?.Name ?? "unknown", "updated", [.. fields, "credentialKeyRotation"], cancellationToken);
                }

                await transaction.CommitAsync(cancellationToken);
                rotated += batch.Count;
            }
        }
        catch (CredentialProtectionException)
        {
            return Results.Conflict(new
            {
                rotated,
                error = "Rotation stopped because a stored credential could not be decrypted. The current batch was rolled back; keep the previous key configured and resolve the affected account before retrying."
            });
        }

        return Results.Ok(new { rotated, activeKeyId = protection.ActiveKeyId });
    }

    private static async Task<IResult> ListAsync(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            select a.id, a.channel, a.provider, a.name, a.enabled, a.is_default,
                   a.settings::text, a.revision, a.updated_at,
                   coalesce(array_agg(s.secret_name) filter (where s.secret_name is not null), '{}')
            from provider_accounts a
            left join provider_account_secrets s on s.account_id = a.id
            group by a.id
            order by a.channel, a.is_default desc, a.name
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var results = new List<ProviderAccountView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var provider = reader.GetString(2);
            var configuredSecrets = reader.GetFieldValue<string[]>(9).ToHashSet(StringComparer.Ordinal);
            results.Add(new ProviderAccountView(
                reader.GetGuid(0), reader.GetString(1), provider, reader.GetString(3), reader.GetBoolean(4),
                reader.GetBoolean(5), JsonSerializer.Deserialize<Dictionary<string, string?>>(reader.GetString(6)) ?? [],
                reader.GetInt32(7), reader.GetFieldValue<DateTimeOffset>(8),
                Providers[provider].SecretNames.ToDictionary(name => name, configuredSecrets.Contains, StringComparer.Ordinal)));
        }
        return Results.Ok(results);
    }

    private static async Task<IResult> ListVehicleAssignmentsAsync(string channel, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (channel is not ("email" or "sms")) return Results.BadRequest(new { error = "Choose email or sms." });
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("select vehicle_id, account_id from vehicle_provider_accounts where channel = @channel", connection);
        command.Parameters.AddWithValue("channel", channel);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var assignments = new Dictionary<Guid, Guid>();
        while (await reader.ReadAsync(cancellationToken)) assignments[reader.GetGuid(0)] = reader.GetGuid(1);
        return Results.Ok(assignments);
    }

    private static async Task<IResult> SetVehicleAssignmentAsync(Guid vehicleId, string channel, VehicleProviderAccountRequest request, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (channel is not ("email" or "sms")) return Results.BadRequest(new { error = "Choose email or sms." });
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var vehicle = new NpgsqlCommand("select exists(select 1 from vehicles where id = @id)", connection, transaction))
        {
            vehicle.Parameters.AddWithValue("id", vehicleId);
            if ((bool?)await vehicle.ExecuteScalarAsync(cancellationToken) != true)
                return Results.NotFound(new { error = "Vehicle not found." });
        }
        if (request.AccountId is null)
        {
            await using var clear = new NpgsqlCommand("delete from vehicle_provider_accounts where vehicle_id = @vehicleId and channel = @channel", connection, transaction);
            clear.Parameters.AddWithValue("vehicleId", vehicleId);
            clear.Parameters.AddWithValue("channel", channel);
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }
        else
        {
            await using var validate = new NpgsqlCommand("select exists(select 1 from provider_accounts where id = @id and channel = @channel and (@channel <> 'sms' or provider = 'Twilio'))", connection, transaction);
            validate.Parameters.AddWithValue("id", request.AccountId.Value);
            validate.Parameters.AddWithValue("channel", channel);
            if ((bool?)await validate.ExecuteScalarAsync(cancellationToken) != true)
                return Results.BadRequest(new { error = channel == "sms" ? "Choose an existing Twilio account for automatic SMS alerts." : "Choose an existing email provider account." });
            await using var save = new NpgsqlCommand("""
                insert into vehicle_provider_accounts (vehicle_id, channel, account_id, updated_at)
                values (@vehicleId, @channel, @accountId, now())
                on conflict (vehicle_id, channel) do update set account_id = excluded.account_id, updated_at = now()
                """, connection, transaction);
            save.Parameters.AddWithValue("vehicleId", vehicleId);
            save.Parameters.AddWithValue("channel", channel);
            save.Parameters.AddWithValue("accountId", request.AccountId.Value);
            await save.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(new { saved = true, vehicleId, channel, accountId = request.AccountId });
    }

    private static async Task<IResult> CreateAsync(
        ProviderAccountUpsertRequest request,
        NpgsqlDataSource dataSource,
        CredentialProtectionService protection,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (!TryValidate(request, out var definition, out var error)) return Results.BadRequest(new { error });
        var accountId = Guid.NewGuid();
        try
        {
            var encrypted = EncryptChanges(protection, accountId, request.Secrets);
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            if (request.IsDefault) await ClearDefaultAsync(connection, transaction, definition.Channel, null, cancellationToken);
            await using (var insert = new NpgsqlCommand("""
                insert into provider_accounts (id, channel, provider, name, enabled, is_default, settings)
                values (@id, @channel, @provider, @name, @enabled, @isDefault, @settings)
                """, connection, transaction))
            {
                AddAccountParameters(insert, accountId, definition.Channel, request);
                await insert.ExecuteNonQueryAsync(cancellationToken);
            }
            await WriteSecretsAsync(connection, transaction, accountId, request.Secrets, encrypted, cancellationToken);
            await WriteAuditAsync(connection, transaction, accountId, context.User.Identity?.Name ?? "unknown", "created", ChangedFields(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Created($"/api/admin/provider-accounts/{accountId}", new { id = accountId, revision = 1 });
        }
        catch (CredentialProtectionException exception)
        {
            return Results.Problem(exception.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException exception) when (exception.SqlState == "23505")
        {
            return Results.Conflict(new { error = "An account with that default selection already exists. Refresh the account list and try again." });
        }
    }

    private static async Task<IResult> UpdateAsync(
        Guid accountId,
        ProviderAccountUpsertRequest request,
        NpgsqlDataSource dataSource,
        CredentialProtectionService protection,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (!TryValidate(request, out var definition, out var error)) return Results.BadRequest(new { error });
        if (request.Revision is null or < 1) return Results.BadRequest(new { error = "The current account revision is required." });
        var encrypted = new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            encrypted = EncryptChanges(protection, accountId, request.Secrets);
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            int currentRevision;
            string currentProvider;
            await using (var lockAccount = new NpgsqlCommand("select revision, provider from provider_accounts where id = @id for update", connection, transaction))
            {
                lockAccount.Parameters.AddWithValue("id", accountId);
                await using var reader = await lockAccount.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken)) return Results.NotFound(new { error = "Provider account not found." });
                currentRevision = reader.GetInt32(0);
                currentProvider = reader.GetString(1);
            }
            if (currentProvider != request.Provider) return Results.BadRequest(new { error = "An account's provider cannot be changed. Create a new account for a different provider." });
            if (currentRevision != request.Revision) return Results.Conflict(new { error = "This account changed since it was loaded. Refresh before saving." });
            if (request.IsDefault) await ClearDefaultAsync(connection, transaction, definition.Channel, accountId, cancellationToken);
            await using (var update = new NpgsqlCommand("""
                update provider_accounts set name = @name, enabled = @enabled, is_default = @isDefault,
                    settings = @settings, revision = revision + 1, updated_at = now()
                where id = @id
                """, connection, transaction))
            {
                AddAccountParameters(update, accountId, definition.Channel, request);
                await update.ExecuteNonQueryAsync(cancellationToken);
            }
            await WriteSecretsAsync(connection, transaction, accountId, request.Secrets, encrypted, cancellationToken);
            await WriteAuditAsync(connection, transaction, accountId, context.User.Identity?.Name ?? "unknown", request.Enabled ? "updated" : "disabled", ChangedFields(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new { saved = true, id = accountId, revision = currentRevision + 1 });
        }
        catch (CredentialProtectionException exception)
        {
            return Results.Problem(exception.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (PostgresException exception) when (exception.SqlState == "23505")
        {
            return Results.Conflict(new { error = "Another account is already the default. Refresh the account list and try again." });
        }
    }

    private static bool TryValidate(ProviderAccountUpsertRequest request, out ProviderDefinition definition, out string error)
    {
        definition = null!;
        if (request is null || !Providers.TryGetValue(request.Provider?.Trim() ?? "", out var selectedDefinition))
        {
            error = "Choose a supported provider: Graph, Resend, Brevo, Twilio or Textbelt.";
            return false;
        }
        definition = selectedDefinition;
        if (request.Revision is null && !request.Enabled)
        {
            error = "A new provider account must be enabled before it can be saved.";
            return false;
        }
        if (request.IsDefault && !request.Enabled)
        {
            error = "A disabled provider account cannot be selected as the default.";
            return false;
        }
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 100)
        {
            error = "Enter an account name between 1 and 100 characters.";
            return false;
        }
        if (request.Settings is null || request.Settings.Keys.Any(key => !selectedDefinition.Settings.Contains(key, StringComparer.Ordinal)))
        {
            error = "The account contains a setting that is not supported by this provider.";
            return false;
        }
        if ((request.Secrets ?? []).Keys.Any(key => !selectedDefinition.SecretNames.Contains(key, StringComparer.Ordinal)))
        {
            error = "The account contains a secret field that is not supported by this provider.";
            return false;
        }
        if (request.Settings.Values.Any(value => value?.Length > 500) || (request.Secrets ?? []).Values.Any(value => value?.Length > 8192))
        {
            error = "One or more provider settings exceed the allowed length.";
            return false;
        }
        error = "";
        return true;
    }

    private static Dictionary<string, string> EncryptChanges(CredentialProtectionService protection, Guid accountId, Dictionary<string, string?>? secrets)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, value) in secrets ?? [])
        {
            if (!string.IsNullOrWhiteSpace(value)) result[name] = protection.Protect(accountId, name, value);
        }
        return result;
    }

    private static void AddAccountParameters(NpgsqlCommand command, Guid accountId, string channel, ProviderAccountUpsertRequest request)
    {
        command.Parameters.AddWithValue("id", accountId);
        command.Parameters.AddWithValue("channel", channel);
        command.Parameters.AddWithValue("provider", request.Provider.Trim());
        command.Parameters.AddWithValue("name", request.Name.Trim());
        command.Parameters.AddWithValue("enabled", request.Enabled);
        command.Parameters.AddWithValue("isDefault", request.IsDefault);
        command.Parameters.Add("settings", NpgsqlDbType.Jsonb).Value = JsonSerializer.Serialize(request.Settings);
    }

    private static async Task ClearDefaultAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string channel, Guid? exceptId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("update provider_accounts set is_default = false, revision = revision + 1, updated_at = now() where channel = @channel and is_default and (@exceptId is null or id <> @exceptId)", connection, transaction);
        command.Parameters.AddWithValue("channel", channel);
        command.Parameters.Add("exceptId", NpgsqlDbType.Uuid).Value = (object?)exceptId ?? DBNull.Value;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task WriteSecretsAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, Guid accountId, Dictionary<string, string?>? requestedSecrets, Dictionary<string, string> encrypted, CancellationToken cancellationToken)
    {
        // A supplied empty value explicitly clears that secret; omitted keys preserve it.
        foreach (var (name, suppliedValue) in requestedSecrets ?? [])
        {
            if (string.IsNullOrWhiteSpace(suppliedValue))
            {
                await using var delete = new NpgsqlCommand("delete from provider_account_secrets where account_id = @accountId and secret_name = @name", connection, transaction);
                delete.Parameters.AddWithValue("accountId", accountId);
                delete.Parameters.AddWithValue("name", name);
                await delete.ExecuteNonQueryAsync(cancellationToken);
                continue;
            }
            var value = encrypted[name];
            await using var command = new NpgsqlCommand("""
                insert into provider_account_secrets (account_id, secret_name, encrypted_value, updated_at)
                values (@accountId, @name, @value, now())
                on conflict (account_id, secret_name) do update set encrypted_value = excluded.encrypted_value, updated_at = now()
                """, connection, transaction);
            command.Parameters.AddWithValue("accountId", accountId);
            command.Parameters.AddWithValue("name", name);
            command.Parameters.AddWithValue("value", value);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task WriteAuditAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, Guid accountId, string actor, string action, string[] fields, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("insert into provider_account_audit (account_id, actor, action, changed_fields) values (@id, @actor, @action, @fields)", connection, transaction);
        command.Parameters.AddWithValue("id", accountId);
        command.Parameters.AddWithValue("actor", actor);
        command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("fields", fields);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string[] ChangedFields(ProviderAccountUpsertRequest request) =>
        ["name", "enabled", "isDefault", "settings", .. (request.Secrets?.Keys.Select(name => $"secret:{name}") ?? [])];

    private sealed record ProviderDefinition(string Channel, string[] Settings, string[] SecretNames);
}

public sealed record ProviderAccountUpsertRequest(
    string Provider,
    string Name,
    bool Enabled,
    bool IsDefault,
    Dictionary<string, string?> Settings,
    Dictionary<string, string?>? Secrets,
    int? Revision = null);

public sealed record ProviderAccountView(
    Guid Id,
    string Channel,
    string Provider,
    string Name,
    bool Enabled,
    bool IsDefault,
    Dictionary<string, string?> Settings,
    int Revision,
    DateTimeOffset UpdatedAt,
    Dictionary<string, bool> SecretConfigured);

public sealed record VehicleProviderAccountRequest(Guid? AccountId);

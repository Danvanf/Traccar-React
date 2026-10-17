using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;

var oldKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
var newKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
var accountId = Guid.NewGuid();
var oldProtector = CreateProtectorWithKeys([("old", oldKey)], "old");
var oldEnvelope = oldProtector.Protect(accountId, "ClientSecret", "a provider secret");
var secondEnvelope = oldProtector.Protect(accountId, "ClientSecret", "a provider secret");
Check("random nonce creates distinct ciphertext", oldEnvelope != secondEnvelope);
Check("round trip recovers secret", oldProtector.Unprotect(accountId, "ClientSecret", oldEnvelope) == "a provider secret");
CheckThrows("account ID is authenticated", () => oldProtector.Unprotect(Guid.NewGuid(), "ClientSecret", oldEnvelope));
CheckThrows("secret purpose is authenticated", () => oldProtector.Unprotect(accountId, "ApiKey", oldEnvelope));
var parts = oldEnvelope.Split('.');
parts[^1] = FlipBase64Byte(parts[^1]);
CheckThrows("authentication tag tampering is rejected", () => oldProtector.Unprotect(accountId, "ClientSecret", string.Join('.', parts)));

var rotatingProtector = CreateProtectorWithKeys([("old", oldKey), ("new", newKey)], "new");
Check("rotation key ring reads old ciphertext", rotatingProtector.Unprotect(accountId, "ClientSecret", oldEnvelope) == "a provider secret");
var newEnvelope = rotatingProtector.Protect(accountId, "ClientSecret", "rotated secret");
Check("rotation key ring writes with active key", newEnvelope.StartsWith("v1.new.", StringComparison.Ordinal));
Check("rotation key ring reads new ciphertext", rotatingProtector.Unprotect(accountId, "ClientSecret", newEnvelope) == "rotated secret");
CheckThrows("retired key is unavailable", () => CreateProtectorWithKeys([("new", newKey)], "new").Unprotect(accountId, "ClientSecret", oldEnvelope));

var missingKeyProtector = CreateProtectorWithKeys([], "missing");
Check("missing active key disables credential writes", !missingKeyProtector.CanProtect);
CheckThrows("missing active key rejects credential writes", () => missingKeyProtector.Protect(accountId, "ClientSecret", "secret"));
var aliases = new ConfigurationManager();
aliases.AddInMemoryCollection(new Dictionary<string, string?> {
    ["TraccarReactApi:Auth:Username"] = "default",
    ["ConnectionStrings:TraccarReactApi"] = "default-db",
});
aliases.AddInMemoryCollection(new Dictionary<string, string?> {
    ["VehicleApp:Auth:Username"] = "legacy-environment",
    ["VehicleApp:CredentialEncryption:ActiveKeyId"] = "old",
    ["VehicleApp:CredentialEncryption:Keys:old"] = oldKey,
    ["ConnectionStrings:VehicleApp"] = "existing-db",
});
aliases.AddInMemoryCollection(new Dictionary<string, string?> {
    ["VehicleApp:Auth:Password"] = "legacy-password",
    ["TraccarReactApi:Auth:Password"] = "current-password",
});
ApiConfigurationAliases.Apply(aliases);
Check("legacy environment wins over new defaults", aliases["TraccarReactApi:Auth:Username"] == "legacy-environment");
Check("current key wins at equal provider priority", aliases["TraccarReactApi:Auth:Password"] == "current-password");
Check("existing connection string survives rename", aliases.GetConnectionString("TraccarReactApi") == "existing-db");
Check("legacy key ring still decrypts stored ciphertext", new CredentialProtectionService(aliases).Unprotect(accountId, "ClientSecret", oldEnvelope) == "a provider secret");
var upgradedSettings = System.Text.Json.Nodes.JsonNode.Parse(ApiNamingMigration.UpgradeGeneralSettingsJson("""{"vehicleApiBaseUrl":"https://example.test/vehicle-api","pollIntervalMs":12000}"""))!;
Check("server settings preserve custom host", upgradedSettings["traccarReactApiBaseUrl"]!.GetValue<string>() == "https://example.test/traccar-react-api");
Check("server settings preserve unrelated fields", upgradedSettings["pollIntervalMs"]!.GetValue<int>() == 12000);
Console.WriteLine("Credential protection and API naming migration: all checks passed; no database or network access.");

static CredentialProtectionService CreateProtectorWithKeys((string Id, string Value)[] keys, string active)
{
    var values = new Dictionary<string, string?> { ["TraccarReactApi:CredentialEncryption:ActiveKeyId"] = active };
    foreach (var (id, value) in keys) values[$"TraccarReactApi:CredentialEncryption:Keys:{id}"] = value;
    var configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    return new CredentialProtectionService(configuration);
}

static string FlipBase64Byte(string value)
{
    var bytes = Convert.FromBase64String(value);
    bytes[0] ^= 0x40;
    return Convert.ToBase64String(bytes);
}

static void Check(string name, bool passed)
{
    if (!passed) throw new InvalidOperationException($"FAIL {name}");
    Console.WriteLine($"PASS {name}");
}

static void CheckThrows(string name, Action action)
{
    try { action(); }
    catch (CredentialProtectionException) { Console.WriteLine($"PASS {name}"); return; }
    throw new InvalidOperationException($"FAIL {name}: expected CredentialProtectionException");
}

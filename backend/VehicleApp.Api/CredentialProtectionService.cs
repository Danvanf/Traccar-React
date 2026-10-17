using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;

public sealed class CredentialProtectionService
{
    private const string EnvelopeVersion = "v1";
    private readonly IReadOnlyDictionary<string, byte[]> _keys;
    private readonly string? _activeKeyId;
    private readonly string? _configurationError;

    public CredentialProtectionService(IConfiguration configuration)
    {
        var keys = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var errors = new List<string>();
        var configuredKeys = configuration.GetSection("VehicleApp:CredentialEncryption:Keys").GetChildren().ToArray();
        foreach (var section in configuredKeys)
        {
            if (!Regex.IsMatch(section.Key, "^[A-Za-z0-9_-]{1,64}$"))
            {
                errors.Add("A credential encryption key ID is invalid.");
                continue;
            }
            try
            {
                var decoded = Convert.FromBase64String(section.Value ?? string.Empty);
                if (decoded.Length != 32) errors.Add("A credential encryption key must decode to exactly 32 bytes.");
                else keys[section.Key] = decoded;
            }
            catch (FormatException)
            {
                errors.Add("A credential encryption key is not valid Base64.");
            }
        }

        _keys = keys;
        var configuredActiveKeyId = configuration["VehicleApp:CredentialEncryption:ActiveKeyId"];
        HasConfiguration = configuredKeys.Length > 0 || !string.IsNullOrWhiteSpace(configuredActiveKeyId);
        _activeKeyId = configuredActiveKeyId?.Trim();
        if (string.IsNullOrWhiteSpace(_activeKeyId)) errors.Add("VehicleApp:CredentialEncryption:ActiveKeyId is required to save provider credentials.");
        else if (!keys.ContainsKey(_activeKeyId)) errors.Add("The active credential encryption key is missing or invalid.");
        _configurationError = errors.Count == 0 ? null : string.Join(" ", errors);
    }

    public string Protect(Guid accountId, string purpose, string plaintext)
    {
        ValidateContext(accountId, purpose);
        if (_activeKeyId is null || !_keys.TryGetValue(_activeKeyId, out var key))
            throw new CredentialProtectionException(_configurationError ?? "Credential encryption is not configured.");
        var nonce = RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[Encoding.UTF8.GetByteCount(plaintext)];
        var tag = new byte[16];
        using (var aes = new AesGcm(key, tag.Length))
            aes.Encrypt(nonce, Encoding.UTF8.GetBytes(plaintext), ciphertext, tag, AssociatedData(accountId, purpose));
        return string.Join('.', EnvelopeVersion, _activeKeyId, Convert.ToBase64String(nonce), Convert.ToBase64String(ciphertext), Convert.ToBase64String(tag));
    }

    public string Unprotect(Guid accountId, string purpose, string envelope)
    {
        ValidateContext(accountId, purpose);
        var parts = envelope.Split('.');
        if (parts.Length != 5 || parts[0] != EnvelopeVersion || !Regex.IsMatch(parts[1], "^[A-Za-z0-9_-]{1,64}$"))
            throw new CredentialProtectionException("The stored credential has an unsupported format.");
        if (!_keys.TryGetValue(parts[1], out var key))
            throw new CredentialProtectionException("A key required to decrypt this credential is unavailable.");
        try
        {
            var nonce = Convert.FromBase64String(parts[2]);
            var ciphertext = Convert.FromBase64String(parts[3]);
            var tag = Convert.FromBase64String(parts[4]);
            if (nonce.Length != 12 || tag.Length != 16) throw new CredentialProtectionException("The stored credential has invalid encryption parameters.");
            var plaintext = new byte[ciphertext.Length];
            using (var aes = new AesGcm(key, tag.Length))
                aes.Decrypt(nonce, ciphertext, tag, plaintext, AssociatedData(accountId, purpose));
            return Encoding.UTF8.GetString(plaintext);
        }
        catch (FormatException exception)
        {
            throw new CredentialProtectionException("The stored credential is malformed.", exception);
        }
        catch (CryptographicException exception)
        {
            throw new CredentialProtectionException("The stored credential could not be authenticated.", exception);
        }
    }

    public string ProtectSystemCredential(string purpose, string plaintext)
    {
        ValidateSystemPurpose(purpose);
        if (_activeKeyId is null || !_keys.TryGetValue(_activeKeyId, out var key))
            throw new CredentialProtectionException(_configurationError ?? "Credential encryption is not configured.");
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plainBytes = Encoding.UTF8.GetBytes(plaintext);
        var ciphertext = new byte[plainBytes.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(key, tag.Length))
            aes.Encrypt(nonce, plainBytes, ciphertext, tag, SystemAssociatedData(purpose));
        return string.Join('.', EnvelopeVersion, _activeKeyId, Convert.ToBase64String(nonce), Convert.ToBase64String(ciphertext), Convert.ToBase64String(tag));
    }

    public string UnprotectSystemCredential(string purpose, string envelope)
    {
        ValidateSystemPurpose(purpose);
        var parts = envelope.Split('.');
        if (parts.Length != 5 || parts[0] != EnvelopeVersion || !Regex.IsMatch(parts[1], "^[A-Za-z0-9_-]{1,64}$"))
            throw new CredentialProtectionException("The stored credential has an unsupported format.");
        if (!_keys.TryGetValue(parts[1], out var key))
            throw new CredentialProtectionException("A key required to decrypt this credential is unavailable.");
        try
        {
            var nonce = Convert.FromBase64String(parts[2]);
            var ciphertext = Convert.FromBase64String(parts[3]);
            var tag = Convert.FromBase64String(parts[4]);
            if (nonce.Length != 12 || tag.Length != 16) throw new CredentialProtectionException("The stored credential has invalid encryption parameters.");
            var plaintext = new byte[ciphertext.Length];
            using (var aes = new AesGcm(key, tag.Length))
                aes.Decrypt(nonce, ciphertext, tag, plaintext, SystemAssociatedData(purpose));
            return Encoding.UTF8.GetString(plaintext);
        }
        catch (FormatException exception)
        {
            throw new CredentialProtectionException("The stored credential is malformed.", exception);
        }
        catch (CryptographicException exception)
        {
            throw new CredentialProtectionException("The stored credential could not be authenticated.", exception);
        }
    }

    private static byte[] SystemAssociatedData(string purpose) =>
        Encoding.UTF8.GetBytes($"vehicle-app:system-credential:{EnvelopeVersion}:{purpose}");

    private static void ValidateSystemPurpose(string purpose)
    {
        if (string.IsNullOrWhiteSpace(purpose) || purpose.Length > 100 || purpose.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '_' or '-')))
            throw new ArgumentException("A valid system credential purpose is required.", nameof(purpose));
    }

    public bool CanProtect => _activeKeyId is not null && _keys.ContainsKey(_activeKeyId);
    public string? ActiveKeyId => _activeKeyId;
    public bool IsProtectedByActiveKey(string envelope) =>
        _activeKeyId is not null && envelope.StartsWith($"{EnvelopeVersion}.{_activeKeyId}.", StringComparison.Ordinal);
    public bool HasConfiguration { get; }
    public string? ConfigurationError => _configurationError;

    private static byte[] AssociatedData(Guid accountId, string purpose) =>
        Encoding.UTF8.GetBytes($"vehicle-app:provider-credential:{EnvelopeVersion}:{accountId:D}:{purpose}");

    private static void ValidateContext(Guid accountId, string purpose)
    {
        if (accountId == Guid.Empty) throw new ArgumentException("A provider account ID is required.", nameof(accountId));
        if (string.IsNullOrWhiteSpace(purpose) || purpose.Length > 100 || purpose.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '_' or '-')))
            throw new ArgumentException("A valid credential purpose is required.", nameof(purpose));
    }
}

public sealed class CredentialProtectionException(string message, Exception? innerException = null) : Exception(message, innerException);

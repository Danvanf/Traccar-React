using System.Security.Cryptography;
using System.Text;

/// <summary>
/// Creates and verifies public telemetry-share capabilities.
/// The raw token is returned only at creation time; PostgreSQL stores HashToken.
/// </summary>
public sealed class TelemetryShareTokenService
{
    public (string RawToken, byte[] Hash) Create()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        var rawToken = Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
        return (rawToken, HashToken(rawToken));
    }

    public byte[] HashToken(string rawToken)
    {
        if (!IsValidToken(rawToken))
            throw new ArgumentException("Invalid telemetry share token.", nameof(rawToken));

        return SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
    }

    public bool Matches(string rawToken, ReadOnlySpan<byte> expectedHash)
    {
        if (!IsValidToken(rawToken) || expectedHash.Length != SHA256.HashSizeInBytes)
            return false;

        Span<byte> suppliedHash = stackalloc byte[SHA256.HashSizeInBytes];
        SHA256.HashData(Encoding.UTF8.GetBytes(rawToken), suppliedHash);
        return CryptographicOperations.FixedTimeEquals(suppliedHash, expectedHash);
    }

    public static bool IsValidToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length != 43)
            return false;

        foreach (var character in token)
        {
            if (!(character is >= 'A' and <= 'Z')
                && !(character is >= 'a' and <= 'z')
                && !(character is >= '0' and <= '9')
                && character is not '-' and not '_')
                return false;
        }

        return true;
    }
}

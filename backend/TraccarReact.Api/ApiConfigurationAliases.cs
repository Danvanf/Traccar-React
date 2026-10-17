using Microsoft.Extensions.Configuration;

// Existing environment files can keep working while deployments adopt the new name.
public static class ApiConfigurationAliases
{
    public static void Apply(ConfigurationManager configuration)
    {
        var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        var hasLegacy = false;
        foreach (var provider in ((IConfigurationRoot)configuration).Providers.ToArray())
        {
            CopySection(provider, "VehicleApp", "TraccarReactApi", values, ref hasLegacy);
            CopySection(provider, "TraccarReactApi", "TraccarReactApi", values, ref hasLegacy);
            if (provider.TryGet("ConnectionStrings:VehicleApp", out var legacy))
            {
                values["ConnectionStrings:TraccarReactApi"] = legacy;
                hasLegacy = true;
            }
            if (provider.TryGet("ConnectionStrings:TraccarReactApi", out var current))
                values["ConnectionStrings:TraccarReactApi"] = current;
        }
        if (hasLegacy) configuration.AddInMemoryCollection(values);
    }

    private static void CopySection(IConfigurationProvider provider, string source, string target,
        Dictionary<string, string?> values, ref bool hasLegacy)
    {
        if (provider.TryGet(source, out var value))
        {
            values[target] = value;
            if (source.StartsWith("VehicleApp", StringComparison.OrdinalIgnoreCase)) hasLegacy = true;
        }
        foreach (var child in provider.GetChildKeys(Array.Empty<string>(), source).Distinct(StringComparer.OrdinalIgnoreCase))
            CopySection(provider, source + ":" + child, target + ":" + child, values, ref hasLegacy);
    }
}

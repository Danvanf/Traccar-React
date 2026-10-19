using System.Text.Json.Nodes;

public static class ApiNamingMigration
{
    public static string UpgradeGeneralSettingsJson(string json)
    {
        var settings = JsonNode.Parse(json)?.AsObject();
        if (settings is null) return json;
        if (!settings.ContainsKey("traccarScopeApiBaseUrl") && settings.TryGetPropertyValue("vehicleApiBaseUrl", out var legacy))
            settings["traccarScopeApiBaseUrl"] = legacy?.DeepClone();
        settings.Remove("vehicleApiBaseUrl");
        var url = settings["traccarScopeApiBaseUrl"]?.GetValue<string>();
        settings["traccarScopeApiBaseUrl"] = string.IsNullOrWhiteSpace(url)
            ? "/traccar-scope-api"
            : System.Text.RegularExpressions.Regex.Replace(url.Trim(), @"/vehicle-api/?$", "/traccar-scope-api", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return settings.ToJsonString();
    }
}

using System.Text.Json.Nodes;

public static class ApiNamingMigration
{
    public static string UpgradeGeneralSettingsJson(string json)
    {
        var settings = JsonNode.Parse(json)?.AsObject();
        if (settings is null) return json;
        if (!settings.ContainsKey("traccarReactApiBaseUrl") && settings.TryGetPropertyValue("vehicleApiBaseUrl", out var legacy))
            settings["traccarReactApiBaseUrl"] = legacy?.DeepClone();
        settings.Remove("vehicleApiBaseUrl");
        var url = settings["traccarReactApiBaseUrl"]?.GetValue<string>();
        settings["traccarReactApiBaseUrl"] = string.IsNullOrWhiteSpace(url)
            ? "/traccar-react-api"
            : System.Text.RegularExpressions.Regex.Replace(url.Trim(), @"/vehicle-api/?$", "/traccar-react-api", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return settings.ToJsonString();
    }
}

param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int] $DeviceId,

    [Parameter(Mandatory = $true)]
    [DateTimeOffset] $FromUtc,

    [Parameter(Mandatory = $true)]
    [DateTimeOffset] $ThroughUtc,

    [string] $ApiBaseUrl = $(if ($env:TRACCAR_SCOPE_API_BASE_URL) { $env:TRACCAR_SCOPE_API_BASE_URL } else { 'http://localhost:5124' }),

    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'

$apiUri = [Uri] $ApiBaseUrl
if ($apiUri.Scheme -ne 'https' -and $apiUri.Host -notin @('localhost', '127.0.0.1', '::1')) {
    throw 'Refusing to call a remote API over HTTP. Use HTTPS or run the diagnostic script on the API host against localhost.'
}

if ($ThroughUtc -le $FromUtc) {
    throw 'ThroughUtc must be later than FromUtc.'
}
if (($ThroughUtc - $FromUtc) -gt [TimeSpan]::FromDays(1)) {
    throw 'The diagnostic capture is limited to a 24-hour window.'
}

$headers = @{ Accept = 'application/json' }

$from = [Uri]::EscapeDataString($FromUtc.ToUniversalTime().ToString('o'))
$through = [Uri]::EscapeDataString($ThroughUtc.ToUniversalTime().ToString('o'))
$base = $ApiBaseUrl.TrimEnd('/')
$url = "$base/api/device-protocol-diagnostics/$DeviceId`?fromUtc=$from&throughUtc=$through"

try {
    $capture = Invoke-RestMethod -Method Get -Uri $url -Headers $headers -TimeoutSec 45
    $json = $capture | ConvertTo-Json -Depth 50
    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        Write-Output $json
    } else {
        $resolvedOutputPath = [IO.Path]::GetFullPath($OutputPath)
        [IO.File]::WriteAllText($resolvedOutputPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
        Write-Output "Diagnostic capture saved to $resolvedOutputPath"
    }
}
catch {
    $status = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $status = [int] $_.Exception.Response.StatusCode
    }
    if ($status -in @(401, 403)) {
        throw 'The diagnostic API rejected this request. Run the script on the API host and call its localhost URL.'
    }
    throw "Device protocol diagnostic capture failed: $($_.Exception.Message)"
}

param(
    [string]$TraccarBaseUrl = "http://192.168.16.16:8082",
    [string]$TraccarUsername,
    [string]$TraccarPassword,
    [int]$TraccarDeviceId = 5,
    [datetimeoffset]$FromUtc = ([DateTimeOffset]::UtcNow.AddDays(-7)),
    [datetimeoffset]$ToUtc = ([DateTimeOffset]::UtcNow),
    [ValidateSet("positions", "events", "both")][string]$Source = "both",
    [int]$MaxSamples = 50,
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function New-BasicAuthHeaderValue {
    param(
        [string]$Username,
        [string]$Password
    )

    $bytes = [System.Text.Encoding]::UTF8.GetBytes("${Username}:${Password}")
    return "Basic " + [Convert]::ToBase64String($bytes)
}

function Invoke-JsonApi {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [hashtable]$Headers
    )

    $response = Invoke-WebRequest -Method Get -Uri $Uri -Headers $Headers -SkipHttpErrorCheck

    $raw = ""
    if ($response.RawContentStream) {
        $raw = [System.Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
    }

    if ([string]::IsNullOrWhiteSpace($raw)) {
        $raw = [string]$response.Content
    }

    $parsed = $null
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        try {
            $parsed = $raw | ConvertFrom-Json
        }
        catch {
            $parsed = $null
        }
    }

    [PSCustomObject]@{
        StatusCode = [int]$response.StatusCode
        Body = $raw
        Json = $parsed
    }
}

function Get-TraccarArray {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][hashtable]$Headers,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $result = Invoke-JsonApi -Method GET -Uri $Uri -Headers $Headers
    if ($result.StatusCode -lt 200 -or $result.StatusCode -ge 300) {
        throw "Traccar $Label request failed: HTTP $($result.StatusCode) $($result.Body)"
    }

    $items = @($result.Json)
    if ($items.Count -eq 1 -and $items[0] -is [System.Array]) {
        $items = @($items[0])
    }

    return $items
}

function Test-ContainsDtcPattern {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }

    return [System.Text.RegularExpressions.Regex]::IsMatch($Text, "\\b[A-Za-z][0-9A-Fa-f]{4}\\b")
}

function Get-RecordTimeIso {
    param([object]$Record)

    foreach ($key in @("fixTime", "eventTime", "deviceTime", "serverTime")) {
        $value = $Record.$key
        if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) {
            return [string]$value
        }
    }

    return ""
}

function Add-KeyCount {
    param(
        [hashtable]$Map,
        [string]$Key
    )

    if ([string]::IsNullOrWhiteSpace($Key)) {
        return
    }

    if ($Map.ContainsKey($Key)) {
        $Map[$Key] += 1
    }
    else {
        $Map[$Key] = 1
    }
}

Write-Host "Phase 5 DTC Traccar probe" -ForegroundColor Green
Write-Host "Traccar API: $TraccarBaseUrl"
Write-Host "Traccar device ID: $TraccarDeviceId"
Write-Host ("Source: {0}, Window UTC: {1} -> {2}" -f $Source, $FromUtc.ToString("o"), $ToUtc.ToString("o"))

if ([string]::IsNullOrWhiteSpace($TraccarUsername)) {
    $TraccarUsername = [Environment]::GetEnvironmentVariable("TRACCAR_USERNAME")
}

if ([string]::IsNullOrWhiteSpace($TraccarPassword)) {
    $TraccarPassword = [Environment]::GetEnvironmentVariable("TRACCAR_PASSWORD")
}

if ([string]::IsNullOrWhiteSpace($TraccarUsername) -or [string]::IsNullOrWhiteSpace($TraccarPassword)) {
    throw "Traccar credentials are required. Pass -TraccarUsername/-TraccarPassword or set TRACCAR_USERNAME/TRACCAR_PASSWORD environment variables."
}

if ($FromUtc -gt $ToUtc) {
    throw "FromUtc must be earlier than or equal to ToUtc."
}

if ($MaxSamples -le 0) {
    throw "MaxSamples must be greater than zero."
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $PSScriptRoot "artifacts"
}

if (-not (Test-Path $OutputDirectory)) {
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
}

$headers = @{
    Accept = "application/json"
    Authorization = New-BasicAuthHeaderValue -Username $TraccarUsername -Password $TraccarPassword
}

Write-Step "Traccar connectivity preflight"
$serverProbe = Invoke-JsonApi -Method GET -Uri "$TraccarBaseUrl/api/server" -Headers $headers
if ($serverProbe.StatusCode -lt 200 -or $serverProbe.StatusCode -ge 300) {
    throw "Traccar preflight failed: HTTP $($serverProbe.StatusCode) $($serverProbe.Body)"
}
Write-Host ("Traccar preflight status: HTTP {0}" -f $serverProbe.StatusCode)

Write-Step "Traccar device access preflight"
$devices = Get-TraccarArray -Uri "$TraccarBaseUrl/api/devices" -Headers $headers -Label "devices"
$visibleDevice = $devices | Where-Object { $_.id -eq $TraccarDeviceId } | Select-Object -First 1
if (-not $visibleDevice) {
    $visibleIds = ($devices | Select-Object -ExpandProperty id | Sort-Object) -join ", "
    throw "Requested deviceId $TraccarDeviceId is not visible to this account. Visible device ids: $visibleIds"
}
Write-Host ("Traccar device access confirmed for id {0} ({1})." -f $visibleDevice.id, $visibleDevice.name)

$fromEncoded = [Uri]::EscapeDataString($FromUtc.ToString("o"))
$toEncoded = [Uri]::EscapeDataString($ToUtc.ToString("o"))

$positions = @()
$events = @()

if ($Source -eq "positions" -or $Source -eq "both") {
    Write-Step "Fetch Traccar positions"
    $positionsUri = "$TraccarBaseUrl/api/positions?deviceId=$TraccarDeviceId&from=$fromEncoded&to=$toEncoded"
    $positions = Get-TraccarArray -Uri $positionsUri -Headers $headers -Label "positions"
    Write-Host ("Fetched {0} position record(s)." -f $positions.Count)
}

if ($Source -eq "events" -or $Source -eq "both") {
    Write-Step "Fetch Traccar events"
    $eventsUri = "$TraccarBaseUrl/api/reports/events?deviceId=$TraccarDeviceId&from=$fromEncoded&to=$toEncoded"
    $events = Get-TraccarArray -Uri $eventsUri -Headers $headers -Label "events"
    Write-Host ("Fetched {0} event record(s)." -f $events.Count)
}

Write-Step "Analyze attributes for OBD/DTC signals"
$keyCounts = @{}
$codePatternMatches = New-Object System.Collections.Generic.List[object]
$obdWordMatches = New-Object System.Collections.Generic.List[object]
$dtcWordMatches = New-Object System.Collections.Generic.List[object]
$faultWordMatches = New-Object System.Collections.Generic.List[object]

function Analyze-RecordCollection {
    param(
        [object[]]$Records,
        [string]$Kind
    )

    foreach ($record in $Records) {
        $attributes = $record.attributes
        if ($null -eq $attributes) {
            continue
        }

        $props = $attributes.PSObject.Properties
        foreach ($prop in $props) {
            Add-KeyCount -Map $keyCounts -Key $prop.Name
        }

        $json = $attributes | ConvertTo-Json -Depth 25 -Compress
        $stamp = Get-RecordTimeIso -Record $record

        if (Test-ContainsDtcPattern -Text $json) {
            $codePatternMatches.Add([PSCustomObject]@{
                kind = $Kind
                id = $record.id
                time = $stamp
                excerpt = $json.Substring(0, [Math]::Min($json.Length, 240))
            })
        }

        if ($json -match "obd") {
            $obdWordMatches.Add([PSCustomObject]@{
                kind = $Kind
                id = $record.id
                time = $stamp
            })
        }

        if ($json -match "dtc") {
            $dtcWordMatches.Add([PSCustomObject]@{
                kind = $Kind
                id = $record.id
                time = $stamp
            })
        }

        if ($json -match "fault") {
            $faultWordMatches.Add([PSCustomObject]@{
                kind = $Kind
                id = $record.id
                time = $stamp
            })
        }
    }
}

Analyze-RecordCollection -Records $positions -Kind "position"
Analyze-RecordCollection -Records $events -Kind "event"

$topKeys = $keyCounts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 40 | ForEach-Object {
    [PSCustomObject]@{ key = $_.Key; count = $_.Value }
}

Write-Host ("Top attribute keys (up to 40): {0}" -f (($topKeys | ForEach-Object { "{0}:{1}" -f $_.key, $_.count }) -join ", "))
Write-Host ("Signal matches: codePattern={0}, obdWord={1}, dtcWord={2}, faultWord={3}" -f $codePatternMatches.Count, $obdWordMatches.Count, $dtcWordMatches.Count, $faultWordMatches.Count)

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile = Join-Path $OutputDirectory ("dtc_traccar_probe_" + $timestamp + ".json")

$sampleRecords = New-Object System.Collections.Generic.List[object]

foreach ($record in $positions | Select-Object -First $MaxSamples) {
    $sampleRecords.Add([PSCustomObject]@{
        kind = "position"
        id = $record.id
        time = Get-RecordTimeIso -Record $record
        type = $record.type
        attributes = $record.attributes
    })
}

foreach ($record in $events | Select-Object -First $MaxSamples) {
    $sampleRecords.Add([PSCustomObject]@{
        kind = "event"
        id = $record.id
        time = Get-RecordTimeIso -Record $record
        type = $record.type
        attributes = $record.attributes
    })
}

$payload = [PSCustomObject]@{
    generatedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
    traccarBaseUrl = $TraccarBaseUrl
    traccarDeviceId = $TraccarDeviceId
    fromUtc = $FromUtc.ToString("o")
    toUtc = $ToUtc.ToString("o")
    source = $Source
    fetched = [PSCustomObject]@{
        positions = $positions.Count
        events = $events.Count
    }
    signalMatches = [PSCustomObject]@{
        codePattern = $codePatternMatches.Count
        obdWord = $obdWordMatches.Count
        dtcWord = $dtcWordMatches.Count
        faultWord = $faultWordMatches.Count
    }
    topAttributeKeys = $topKeys
    sampleRecords = $sampleRecords
}

$payload | ConvertTo-Json -Depth 30 | Out-File -FilePath $outFile -Encoding utf8

Write-Host ("PROBE SUMMARY: PASS positions={0} events={1} codePattern={2} output={3}" -f $positions.Count, $events.Count, $codePatternMatches.Count, $outFile) -ForegroundColor Green
Write-Host "`nPhase 5 DTC Traccar probe complete." -ForegroundColor Green

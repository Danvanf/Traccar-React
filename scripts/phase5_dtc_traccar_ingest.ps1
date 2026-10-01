param(
    [string]$ApiBaseUrl = "http://localhost:5124",
    [string]$TraccarBaseUrl = "http://192.168.16.16:8082",
    [string]$TraccarUsername,
    [string]$TraccarPassword,
    [int]$TraccarDeviceId = 141880,
    [datetimeoffset]$FromUtc = ([DateTimeOffset]::UtcNow.AddHours(-24)),
    [datetimeoffset]$ToUtc = ([DateTimeOffset]::UtcNow),
    [ValidateSet("positions", "events", "both")][string]$Source = "both",
    [int]$Limit = 5000,
    [switch]$IncludeIo30Fallback,
    [switch]$IncludeIo30ZeroBaseline,
    [string[]]$Io30FallbackAllowedStatuses = @(),
    [switch]$SkipBackendHealthCheck
)

$ErrorActionPreference = "Stop"

$script:Io30AllowlistEvaluatedCount = 0
$script:Io30AllowlistFilteredCount = 0
$script:Io30AllowlistEvaluatedByKind = @{}
$script:Io30AllowlistFilteredByKind = @{}
$script:Io30AllowlistFilteredStatusCounts = @{}

function Get-NormalizedStatusAllowlist {
    param([string[]]$RawStatuses)

    $normalized = New-Object System.Collections.Generic.List[string]
    foreach ($raw in @($RawStatuses)) {
        if ([string]::IsNullOrWhiteSpace($raw)) {
            continue
        }

        foreach ($token in ($raw -split ',')) {
            if ([string]::IsNullOrWhiteSpace($token)) {
                continue
            }

            $trimmed = $token.Trim()
            $trimmed = $trimmed.Trim("'").Trim('"')

            if ([string]::IsNullOrWhiteSpace($trimmed)) {
                continue
            }

            if (-not $normalized.Contains($trimmed)) {
                $normalized.Add($trimmed)
            }
        }
    }

    return @($normalized)
}

$normalizedIo30FallbackAllowedStatuses = Get-NormalizedStatusAllowlist -RawStatuses $Io30FallbackAllowedStatuses

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
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [hashtable]$Headers,
        [object]$Body
    )

    if ($Method -eq "POST") {
        $jsonBody = $Body | ConvertTo-Json -Depth 25
        $response = Invoke-WebRequest -Method Post -Uri $Uri -Headers $Headers -ContentType "application/json" -Body $jsonBody -SkipHttpErrorCheck
    }
    else {
        $response = Invoke-WebRequest -Method Get -Uri $Uri -Headers $Headers -SkipHttpErrorCheck
    }

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
        RequestId = ($response.Headers["X-Request-Id"] -join ",")
    }
}

function Test-TcpPortOpen {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [Parameter(Mandatory = $true)][int]$Port
    )

    try {
        $probe = Test-NetConnection -ComputerName $HostName -Port $Port -WarningAction SilentlyContinue
        return [bool]$probe.TcpTestSucceeded
    }
    catch {
        return $false
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
        if ($result.Body -match "Device access denied") {
            throw "Traccar $Label request denied for this account/device (HTTP $($result.StatusCode): Device access denied). Confirm user-device permissions in Traccar."
        }

        throw "Traccar $Label request failed: HTTP $($result.StatusCode) $($result.Body)"
    }

    $items = @($result.Json)
    if ($items.Count -eq 1 -and $items[0] -is [System.Array]) {
        $items = @($items[0])
    }

    return $items
}

function Try-GetRecordTimeIso {
    param([object]$Record)

    foreach ($key in @("fixTime", "eventTime", "deviceTime", "serverTime")) {
        $value = $Record.$key
        if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) {
            if ($value -is [DateTimeOffset]) {
                return $value.ToString("o")
            }

            if ($value -is [DateTime]) {
                return ([DateTimeOffset]$value).ToString("o")
            }

            $text = [string]$value
            $parsedOffset = [DateTimeOffset]::MinValue
            if ([DateTimeOffset]::TryParse($text, [ref]$parsedOffset)) {
                return $parsedOffset.ToString("o")
            }

            return $text
        }
    }

    return [DateTimeOffset]::UtcNow.ToString("o")
}

function Test-ContainsDtcPattern {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }

    return [System.Text.RegularExpressions.Regex]::IsMatch($Text, "\\b[A-Za-z][0-9A-Fa-f]{4}\\b")
}

function Try-GetIo30CountFromRecord {
    param([object]$Record)

    $attributes = $Record.attributes
    if ($null -eq $attributes) {
        return $null
    }

    $candidate = $attributes.io30
    if ($null -eq $candidate) {
        return $null
    }

    if ($candidate -is [int]) {
        return [int]$candidate
    }

    if ($candidate -is [double]) {
        return [int][Math]::Round([double]$candidate)
    }

    $parsed = 0
    if ([int]::TryParse([string]$candidate, [ref]$parsed)) {
        return $parsed
    }

    return $null
}

function Test-Io30FallbackStatusAllowed {
    param(
        [AllowNull()][string]$Status,
        [string[]]$AllowedStatuses
    )

    if ($null -eq $AllowedStatuses -or $AllowedStatuses.Count -eq 0) {
        return $true
    }

    if ([string]::IsNullOrWhiteSpace($Status)) {
        foreach ($allowed in $AllowedStatuses) {
            if ([string]::IsNullOrWhiteSpace($allowed)) {
                continue
            }

            $normalized = $allowed.Trim()
            if ([string]::Equals($normalized, "(empty)", [System.StringComparison]::OrdinalIgnoreCase) -or
                [string]::Equals($normalized, "empty", [System.StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }
        }

        return $false
    }

    foreach ($allowed in $AllowedStatuses) {
        if ([string]::IsNullOrWhiteSpace($allowed)) {
            continue
        }

        if ([string]::Equals($Status.Trim(), $allowed.Trim(), [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }

    return $false
}

function Test-HasDtcHint {
    param(
        [object]$Record,
        [string]$RecordKind = "unknown"
    )

    $attributes = $Record.attributes
    if ($null -eq $attributes) {
        return $false
    }

    $json = $attributes | ConvertTo-Json -Depth 25 -Compress

    if ($json -match '"dtc"|"dtcs"|"dtcCode"|"dtcCodes"|"obdDtc"|"obdDtcs"|"faultCode"|"faultCodes"|"diagnosticTroubleCode"|"diagnosticTroubleCodes"') {
        return $true
    }

    if ($IncludeIo30Fallback -and $json -match '"io30"\s*:') {
        $io30 = Try-GetIo30CountFromRecord -Record $Record
        if ($null -eq $io30) {
            return $false
        }

        $script:Io30AllowlistEvaluatedCount += 1
        if (-not $script:Io30AllowlistEvaluatedByKind.ContainsKey($RecordKind)) {
            $script:Io30AllowlistEvaluatedByKind[$RecordKind] = 0
        }
        $script:Io30AllowlistEvaluatedByKind[$RecordKind] += 1

        $statusValue = $null
        if ($null -ne $Record.type) {
            $statusValue = [string]$Record.type
        }
        elseif ($null -ne $Record.attributes -and $null -ne $Record.attributes.status) {
            $statusValue = [string]$Record.attributes.status
        }

        if (-not (Test-Io30FallbackStatusAllowed -Status $statusValue -AllowedStatuses $normalizedIo30FallbackAllowedStatuses)) {
            $script:Io30AllowlistFilteredCount += 1
            if (-not $script:Io30AllowlistFilteredByKind.ContainsKey($RecordKind)) {
                $script:Io30AllowlistFilteredByKind[$RecordKind] = 0
            }
            $script:Io30AllowlistFilteredByKind[$RecordKind] += 1

            $statusKey = if ([string]::IsNullOrWhiteSpace($statusValue)) { "(empty)" } else { $statusValue.Trim() }
            if (-not $script:Io30AllowlistFilteredStatusCounts.ContainsKey($statusKey)) {
                $script:Io30AllowlistFilteredStatusCounts[$statusKey] = 0
            }
            $script:Io30AllowlistFilteredStatusCounts[$statusKey] += 1
            return $false
        }

        if ($IncludeIo30ZeroBaseline) {
            return $true
        }

        return ($io30 -gt 0)
    }

    return (Test-ContainsDtcPattern -Text $json)
}

function Get-ObdHintStats {
    param([object[]]$Records)

    $stats = [ordered]@{
        total = 0
        withAttributes = 0
        hasIo30 = 0
        hasMil = 0
        hasObdWord = 0
        hasDtcWord = 0
        hasFaultWord = 0
        hasCodePattern = 0
    }

    foreach ($record in $Records) {
        $stats.total += 1
        $attributes = $record.attributes
        if ($null -eq $attributes) {
            continue
        }

        $stats.withAttributes += 1
        $json = $attributes | ConvertTo-Json -Depth 25 -Compress

        if ($json -match '"io30"') { $stats.hasIo30 += 1 }
        if ($json -match '"mil"') { $stats.hasMil += 1 }
        if ($json -match 'obd') { $stats.hasObdWord += 1 }
        if ($json -match 'dtc') { $stats.hasDtcWord += 1 }
        if ($json -match 'fault') { $stats.hasFaultWord += 1 }
        if (Test-ContainsDtcPattern -Text $json) { $stats.hasCodePattern += 1 }
    }

    return $stats
}

Write-Host "Phase 5 DTC Traccar ingest" -ForegroundColor Green
Write-Host "Vehicle API: $ApiBaseUrl"
Write-Host "Traccar API: $TraccarBaseUrl"
Write-Host "Traccar device ID: $TraccarDeviceId"
Write-Host ("Source: {0}, Window UTC: {1} -> {2}" -f $Source, $FromUtc.ToString("o"), $ToUtc.ToString("o"))
Write-Host ("Include io30 fallback: {0}" -f [bool]$IncludeIo30Fallback)
Write-Host ("Include io30 zero baseline: {0}" -f [bool]$IncludeIo30ZeroBaseline)
if ($normalizedIo30FallbackAllowedStatuses.Count -gt 0) {
    Write-Host ("io30 fallback allowed statuses: {0}" -f ($normalizedIo30FallbackAllowedStatuses -join ", "))
}

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

$backendHeaders = @{ Accept = "application/json" }
$traccarHeaders = @{
    Accept = "application/json"
    Authorization = New-BasicAuthHeaderValue -Username $TraccarUsername -Password $TraccarPassword
}

Write-Step "Traccar connectivity preflight"
$traccarApiProbeUri = "$TraccarBaseUrl/api/server"
try {
    $traccarProbe = Invoke-JsonApi -Method GET -Uri $traccarApiProbeUri -Headers $traccarHeaders
}
catch {
    $hint = ""
    try {
        $traccarUri = [Uri]$TraccarBaseUrl
        $hostName = $traccarUri.Host
        $port = if ($traccarUri.IsDefaultPort) { if ($traccarUri.Scheme -eq "https") { 443 } else { 80 } } else { $traccarUri.Port }
        $isTargetPortOpen = Test-TcpPortOpen -HostName $hostName -Port $port
        $is8080Open = Test-TcpPortOpen -HostName $hostName -Port 8080

        $hint = " (tcp " + $hostName + ":" + $port + " open=" + $isTargetPortOpen + "; tcp " + $hostName + ":8080 open=" + $is8080Open + ")"

        if (-not $isTargetPortOpen -and $is8080Open) {
            $hint += " try -TraccarBaseUrl http://" + $hostName + ":8080"
        }
    }
    catch {
        $hint = ""
    }

    throw "Unable to reach Traccar API at $traccarApiProbeUri.$hint Error: $($_.Exception.Message)"
}

if ($traccarProbe.StatusCode -eq 401 -or $traccarProbe.StatusCode -eq 403) {
    throw "Traccar preflight reached $traccarApiProbeUri but authentication failed (HTTP $($traccarProbe.StatusCode)). Confirm Traccar credentials and user permissions."
}

if ($traccarProbe.StatusCode -ge 500) {
    throw "Traccar preflight reached $traccarApiProbeUri but server returned HTTP $($traccarProbe.StatusCode). Confirm Traccar is healthy and ready before ingest."
}

Write-Host ("Traccar preflight status: HTTP {0}" -f $traccarProbe.StatusCode)

Write-Step "Traccar device-access preflight"
$devicesResult = Invoke-JsonApi -Method GET -Uri "$TraccarBaseUrl/api/devices" -Headers $traccarHeaders
if ($devicesResult.StatusCode -lt 200 -or $devicesResult.StatusCode -ge 300) {
    throw "Traccar device list failed: HTTP $($devicesResult.StatusCode) $($devicesResult.Body)"
}

$visibleDevices = @($devicesResult.Json)
if ($visibleDevices.Count -eq 1 -and $visibleDevices[0] -is [System.Array]) {
    $visibleDevices = @($visibleDevices[0])
}

if ($visibleDevices.Count -eq 0) {
    throw "Traccar account can authenticate but has no visible devices. Assign this user read access to device id $TraccarDeviceId (or another target device), then rerun."
}

$visibleDevice = $visibleDevices | Where-Object { $_.id -eq $TraccarDeviceId } | Select-Object -First 1
if (-not $visibleDevice) {
    $visibleIds = ($visibleDevices | Select-Object -ExpandProperty id | Sort-Object) -join ", "
    throw "Traccar account is authenticated but cannot access requested deviceId $TraccarDeviceId. Visible device ids: $visibleIds"
}

Write-Host ("Traccar device access confirmed for id {0} ({1})." -f $visibleDevice.id, $visibleDevice.name)

if (-not $SkipBackendHealthCheck) {
    Write-Step "Backend health check"
    $health = Invoke-JsonApi -Method GET -Uri "$ApiBaseUrl/health" -Headers $backendHeaders
    if ($health.StatusCode -ne 200) {
        throw "Backend health failed: HTTP $($health.StatusCode) $($health.Body)"
    }

    Write-Host ("Health status: {0} (requestId={1})" -f $health.Json.status, $health.RequestId)
}

$fromEncoded = [Uri]::EscapeDataString($FromUtc.ToString("o"))
$toEncoded = [Uri]::EscapeDataString($ToUtc.ToString("o"))

$positionRecords = @()
$eventRecords = @()

if ($Source -eq "positions" -or $Source -eq "both") {
    Write-Step "Fetch Traccar positions"
    $positionsUri = "$TraccarBaseUrl/api/positions?deviceId=$TraccarDeviceId&from=$fromEncoded&to=$toEncoded"
    $positionRecords = Get-TraccarArray -Uri $positionsUri -Headers $traccarHeaders -Label "positions"
    Write-Host ("Fetched {0} position record(s)." -f $positionRecords.Count)
}

if ($Source -eq "events" -or $Source -eq "both") {
    Write-Step "Fetch Traccar events"
    $eventsUri = "$TraccarBaseUrl/api/reports/events?deviceId=$TraccarDeviceId&from=$fromEncoded&to=$toEncoded"
    $eventRecords = Get-TraccarArray -Uri $eventsUri -Headers $traccarHeaders -Label "events"
    Write-Host ("Fetched {0} event record(s)." -f $eventRecords.Count)
}

Write-Step "Select candidate records that look DTC-related"
$candidates = New-Object System.Collections.Generic.List[hashtable]

$script:Io30AllowlistEvaluatedCount = 0
$script:Io30AllowlistFilteredCount = 0
$script:Io30AllowlistEvaluatedByKind = @{}
$script:Io30AllowlistFilteredByKind = @{}
$script:Io30AllowlistFilteredStatusCounts = @{}

foreach ($record in $positionRecords) {
    if (Test-HasDtcHint -Record $record -RecordKind "position") {
        $candidates.Add(@{ Kind = "position"; Record = $record })
    }
}

foreach ($record in $eventRecords) {
    if (Test-HasDtcHint -Record $record -RecordKind "event") {
        $candidates.Add(@{ Kind = "event"; Record = $record })
    }
}

if ($IncludeIo30Fallback -and $normalizedIo30FallbackAllowedStatuses.Count -gt 0) {
    Write-Host ("io30 allowlist filter: evaluated={0}, filteredOut={1}, passed={2}" -f
        $script:Io30AllowlistEvaluatedCount,
        $script:Io30AllowlistFilteredCount,
        ($script:Io30AllowlistEvaluatedCount - $script:Io30AllowlistFilteredCount))

    $positionEvaluated = if ($script:Io30AllowlistEvaluatedByKind.ContainsKey("position")) { [int]$script:Io30AllowlistEvaluatedByKind["position"] } else { 0 }
    $positionFiltered = if ($script:Io30AllowlistFilteredByKind.ContainsKey("position")) { [int]$script:Io30AllowlistFilteredByKind["position"] } else { 0 }
    $eventEvaluated = if ($script:Io30AllowlistEvaluatedByKind.ContainsKey("event")) { [int]$script:Io30AllowlistEvaluatedByKind["event"] } else { 0 }
    $eventFiltered = if ($script:Io30AllowlistFilteredByKind.ContainsKey("event")) { [int]$script:Io30AllowlistFilteredByKind["event"] } else { 0 }

    Write-Host ("io30 allowlist by source: positions evaluated={0}, filteredOut={1}, passed={2}; events evaluated={3}, filteredOut={4}, passed={5}" -f
        $positionEvaluated,
        $positionFiltered,
        ($positionEvaluated - $positionFiltered),
        $eventEvaluated,
        $eventFiltered,
        ($eventEvaluated - $eventFiltered))

    if ($script:Io30AllowlistFilteredStatusCounts.Count -gt 0) {
        $statusBreakdown = $script:Io30AllowlistFilteredStatusCounts.GetEnumerator() |
            Sort-Object -Property Value -Descending |
            ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }

        Write-Host ("io30 allowlist filtered statuses: {0}" -f ($statusBreakdown -join "; "))

        if ($script:Io30AllowlistFilteredStatusCounts.Count -eq 1 -and
            $script:Io30AllowlistFilteredStatusCounts.ContainsKey("(empty)") -and
            $script:Io30AllowlistFilteredStatusCounts["(empty)"] -eq $script:Io30AllowlistFilteredCount) {
            Write-Host "Hint: all filtered io30 candidates had empty status. To allow this data, include '(empty)' in -Io30FallbackAllowedStatuses (example: alarm,obd,'(empty)')." -ForegroundColor Yellow

            $normalizedAllowedStatuses = @($normalizedIo30FallbackAllowedStatuses)
            $hasEmptyToken = $normalizedAllowedStatuses | Where-Object {
                [string]::Equals($_.Trim(), "(empty)", [System.StringComparison]::OrdinalIgnoreCase) -or
                [string]::Equals($_.Trim(), "empty", [System.StringComparison]::OrdinalIgnoreCase)
            }

            if (-not $hasEmptyToken) {
                $rerunStatuses = @($normalizedAllowedStatuses + "'(empty)'") -join ","
                $rerunCommand = "pwsh -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -ApiBaseUrl `"$ApiBaseUrl`" -TraccarBaseUrl `"$TraccarBaseUrl`" -TraccarDeviceId $TraccarDeviceId -Source $Source -FromUtc $($FromUtc.ToString('o')) -ToUtc $($ToUtc.ToString('o')) -IncludeIo30Fallback -IncludeIo30ZeroBaseline -Io30FallbackAllowedStatuses $rerunStatuses"
                Write-Host "Rerun command: $rerunCommand" -ForegroundColor Yellow
            }
        }
    }
}

if ($candidates.Count -eq 0) {
    $positionStats = Get-ObdHintStats -Records $positionRecords
    $eventStats = Get-ObdHintStats -Records $eventRecords

    Write-Host ("Hint stats positions: total={0}, attrs={1}, io30={2}, mil={3}, obdWord={4}, dtcWord={5}, faultWord={6}, codePattern={7}" -f
        $positionStats.total,
        $positionStats.withAttributes,
        $positionStats.hasIo30,
        $positionStats.hasMil,
        $positionStats.hasObdWord,
        $positionStats.hasDtcWord,
        $positionStats.hasFaultWord,
        $positionStats.hasCodePattern)

    Write-Host ("Hint stats events: total={0}, attrs={1}, io30={2}, mil={3}, obdWord={4}, dtcWord={5}, faultWord={6}, codePattern={7}" -f
        $eventStats.total,
        $eventStats.withAttributes,
        $eventStats.hasIo30,
        $eventStats.hasMil,
        $eventStats.hasObdWord,
        $eventStats.hasDtcWord,
        $eventStats.hasFaultWord,
        $eventStats.hasCodePattern)

    if (($positionStats.hasIo30 -gt 0 -or $eventStats.hasIo30 -gt 0) -and ($positionStats.hasCodePattern + $eventStats.hasCodePattern -eq 0)) {
        if ($IncludeIo30Fallback) {
            if ($IncludeIo30ZeroBaseline) {
                Write-Host "Guidance: io30 fallback and zero baseline were enabled but no candidate payloads were selected. Check source/window and rerun with a wider range if needed." -ForegroundColor Yellow
            }
            else {
                Write-Host "Guidance: io30 fallback was enabled but no candidate payloads were selected. Check source/window and rerun with a wider range if needed." -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "Guidance: Traccar payloads include io30 (DTC count) but no DTC code strings. Rerun with -IncludeIo30Fallback to persist synthetic IO30_COUNT diagnostics, or configure Traccar/device payloads to include explicit codes like P0420/P0300 (for example under dtcCodes/faultCodes/dtc fields)." -ForegroundColor Yellow
        }
    }

    Write-Host "INGEST SUMMARY: SKIP no DTC-like records found in selected Traccar window/source." -ForegroundColor Yellow
    Write-Host "`nPhase 5 DTC Traccar ingest complete." -ForegroundColor Yellow
    return
}

if ($candidates.Count -gt $Limit) {
    $candidates = [System.Collections.Generic.List[hashtable]]($candidates | Select-Object -First $Limit)
}

Write-Host ("Selected {0} DTC-like candidate record(s)." -f $candidates.Count)

Write-Step "Import candidates through decode endpoint"
$recordsPayload = @()

foreach ($candidate in $candidates) {
    $record = $candidate.Record

    $statusValue = $null
    if ($null -ne $record.type) {
        $statusValue = [string]$record.type
    }
    elseif ($null -ne $record.attributes -and $null -ne $record.attributes.status) {
        $statusValue = [string]$record.attributes.status
    }

    $sourcePositionId = $null
    $sourceEventId = $null
    if ($candidate.Kind -eq "position") {
        $sourcePositionId = $record.id
    }
    else {
        $sourceEventId = $record.id
    }

    $recordObject = @{
        detectedAt = Try-GetRecordTimeIso -Record $record
        status = $statusValue
        sourcePositionId = $sourcePositionId
        sourceEventId = $sourceEventId
        attributes = $record.attributes
        rawPayload = $record
        notes = "phase5 traccar ingest"
    }

    $recordsPayload += $recordObject
}

$decodeBody = @{
    traccarDeviceId = $TraccarDeviceId
    records = $recordsPayload
    includeIo30Fallback = [bool]$IncludeIo30Fallback
    includeIo30ZeroBaseline = [bool]$IncludeIo30ZeroBaseline
    io30FallbackAllowedStatuses = @($normalizedIo30FallbackAllowedStatuses)
}

$importResult = Invoke-JsonApi -Method POST -Uri "$ApiBaseUrl/api/dtc/events/import-from-traccar" -Headers $backendHeaders -Body $decodeBody
if ($importResult.StatusCode -lt 200 -or $importResult.StatusCode -ge 300) {
    throw "Decode import failed: HTTP $($importResult.StatusCode) $($importResult.Body)"
}

Write-Host ("Decode import result: vehicleId={0}, imported={1}, skipped={2}" -f $importResult.Json.vehicleId, $importResult.Json.imported, $importResult.Json.skipped)
Write-Host ("INGEST SUMMARY: PASS pulled={0} candidates={1} imported={2} skipped={3}" -f ($positionRecords.Count + $eventRecords.Count), $candidates.Count, $importResult.Json.imported, $importResult.Json.skipped) -ForegroundColor Green
Write-Host "`nPhase 5 DTC Traccar ingest complete." -ForegroundColor Green

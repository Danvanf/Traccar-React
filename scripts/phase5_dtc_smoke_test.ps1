param(
    [string]$ApiBaseUrl = "http://localhost:5124",
    [int]$TraccarDeviceId = 141880,
    [switch]$RequireSchema
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-Api {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [object]$Body
    )

    $headers = @{
        Accept = "application/json"
    }

    if ($Method -eq "POST") {
        $jsonBody = $Body | ConvertTo-Json -Depth 10
        $response = Invoke-WebRequest -Method Post -Uri $Uri -Headers $headers -ContentType "application/json" -Body $jsonBody -SkipHttpErrorCheck
    }
    else {
        $response = Invoke-WebRequest -Method Get -Uri $Uri -Headers $headers -SkipHttpErrorCheck
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
        } catch {
            $parsed = $null
        }
    }

    return [PSCustomObject]@{
        StatusCode = [int]$response.StatusCode
        Body = $raw
        Json = $parsed
        RequestId = ($response.Headers["X-Request-Id"] -join ",")
    }
}

Write-Host "Phase 5 DTC smoke test" -ForegroundColor Green
Write-Host "API: $ApiBaseUrl"
Write-Host "Preferred Traccar device ID: $TraccarDeviceId"

Write-Step "Health check"
$health = Invoke-Api -Method GET -Uri "$ApiBaseUrl/health"
if ($health.StatusCode -ne 200) {
    throw "Health check failed: HTTP $($health.StatusCode) $($health.Body)"
}
Write-Host ("Health status: {0} (requestId={1})" -f $health.Json.status, $health.RequestId)

Write-Step "DTC schema availability check"
$catalogProbe = Invoke-Api -Method GET -Uri "$ApiBaseUrl/api/dtc/catalog"
if ($catalogProbe.StatusCode -eq 503 -and $catalogProbe.Body -match "phase5_dtc_enrichment_schema.sql") {
    $summary = "DTC SUMMARY: SKIP schema missing. Apply scripts/phase5_dtc_enrichment_schema.sql first."
    if ($RequireSchema) {
        throw $summary
    }

    Write-Host $summary -ForegroundColor Yellow
    Write-Host "`nPhase 5 DTC smoke test complete." -ForegroundColor Yellow
    return
}

if ($catalogProbe.StatusCode -lt 200 -or $catalogProbe.StatusCode -ge 300) {
    throw "DTC catalog probe failed: HTTP $($catalogProbe.StatusCode) $($catalogProbe.Body)"
}

Write-Step "Resolve mapped device and vehicle"
$vehiclesResult = Invoke-Api -Method GET -Uri "$ApiBaseUrl/api/vehicles"
if ($vehiclesResult.StatusCode -ne 200) {
    throw "Vehicle lookup failed: HTTP $($vehiclesResult.StatusCode) $($vehiclesResult.Body)"
}

$vehicles = @($vehiclesResult.Json)
if ($vehicles.Count -eq 1 -and $vehicles[0] -is [System.Array]) {
    $vehicles = @($vehicles[0])
}

$mapped = $vehicles | Where-Object { $_.traccarDeviceId -eq $TraccarDeviceId } | Select-Object -First 1
if (-not $mapped) {
    $mapped = $vehicles | Where-Object { $null -ne $_.traccarDeviceId } | Select-Object -First 1
}

if (-not $mapped) {
    throw "No mapped vehicle found in /api/vehicles for DTC import test."
}

$effectiveDeviceId = [int]$mapped.traccarDeviceId
$vehicleId = [string]$mapped.id
Write-Host ("Using vehicle {0} ({1}), device {2}" -f $mapped.displayName, $vehicleId, $effectiveDeviceId)

Write-Step "Upsert DTC catalog item"
$catalogCode = "P0300"
$catalogPayload = @{
    code = $catalogCode
    description = "Random/Multiple Cylinder Misfire Detected"
    severity = "medium"
    category = "powertrain"
    source = "obdii"
}

$catalogUpsert = Invoke-Api -Method POST -Uri "$ApiBaseUrl/api/dtc/catalog/upsert" -Body $catalogPayload
if ($catalogUpsert.StatusCode -lt 200 -or $catalogUpsert.StatusCode -ge 300) {
    throw "Catalog upsert failed: HTTP $($catalogUpsert.StatusCode) $($catalogUpsert.Body)"
}

Write-Host ("Catalog upserted code {0}." -f $catalogCode)

Write-Step "Import one DTC event by device"
$detectedAt = [DateTimeOffset]::UtcNow.ToString("o")
$eventPayload = @{
    traccarDeviceId = $effectiveDeviceId
    events = @(
        @{
            code = $catalogCode
            detectedAt = $detectedAt
            status = "active"
            sourcePositionId = 987654321
            sourceEventId = 123456789
            rawPayload = @{
                mil = $true
                freezeFrame = $false
            }
            notes = "phase5 dtc smoke test"
        }
    )
}

$importResult = Invoke-Api -Method POST -Uri "$ApiBaseUrl/api/dtc/events/import-by-device" -Body $eventPayload
if ($importResult.StatusCode -lt 200 -or $importResult.StatusCode -ge 300) {
    throw "DTC import failed: HTTP $($importResult.StatusCode) $($importResult.Body)"
}

Write-Host ("DTC import result: vehicleId={0}, imported={1}, skipped={2}" -f $importResult.Json.vehicleId, $importResult.Json.imported, $importResult.Json.skipped)

Write-Step "Import one decoded DTC event from raw Traccar payload"
$decodedDetectedAt = [DateTimeOffset]::UtcNow.ToString("o")
$decodePayload = @{
    traccarDeviceId = $effectiveDeviceId
    records = @(
        @{
            detectedAt = $decodedDetectedAt
            status = "active"
            sourcePositionId = 987654322
            sourceEventId = 22334455
            attributes = @{
                dtcCodes = @("P0420")
                mil = $true
            }
            rawPayload = @{
                type = "obd"
                attributes = @{
                    faultCodes = "P0420"
                }
            }
            notes = "phase5 dtc decode smoke test"
        }
    )
}

$decodeImportResult = Invoke-Api -Method POST -Uri "$ApiBaseUrl/api/dtc/events/import-from-traccar" -Body $decodePayload
if ($decodeImportResult.StatusCode -lt 200 -or $decodeImportResult.StatusCode -ge 300) {
    throw "DTC decode import failed: HTTP $($decodeImportResult.StatusCode) $($decodeImportResult.Body)"
}

Write-Host ("DTC decode import result: vehicleId={0}, imported={1}, skipped={2}" -f $decodeImportResult.Json.vehicleId, $decodeImportResult.Json.imported, $decodeImportResult.Json.skipped)

Write-Step "Re-import same decoded payload to assert idempotent skip"
$decodeRepeatResult = Invoke-Api -Method POST -Uri "$ApiBaseUrl/api/dtc/events/import-from-traccar" -Body $decodePayload
if ($decodeRepeatResult.StatusCode -lt 200 -or $decodeRepeatResult.StatusCode -ge 300) {
    throw "DTC decode repeat import failed: HTTP $($decodeRepeatResult.StatusCode) $($decodeRepeatResult.Body)"
}

if ($decodeRepeatResult.Json.skipped -lt 1) {
    throw "Expected duplicate decoded import to be skipped, but skipped=$($decodeRepeatResult.Json.skipped)."
}

Write-Host ("DTC decode repeat result: vehicleId={0}, imported={1}, skipped={2}" -f $decodeRepeatResult.Json.vehicleId, $decodeRepeatResult.Json.imported, $decodeRepeatResult.Json.skipped)

Write-Step "Query DTC events"
$fromUtc = [Uri]::EscapeDataString([DateTimeOffset]::UtcNow.AddDays(-7).ToString("o"))
$toUtc = [Uri]::EscapeDataString([DateTimeOffset]::UtcNow.ToString("o"))
$eventsUri = "$ApiBaseUrl/api/dtc/events?vehicleId=$vehicleId&from=$fromUtc&to=$toUtc&limit=50"
$eventsResult = Invoke-Api -Method GET -Uri $eventsUri
if ($eventsResult.StatusCode -lt 200 -or $eventsResult.StatusCode -ge 300) {
    throw "DTC query failed: HTTP $($eventsResult.StatusCode) $($eventsResult.Body)"
}

$events = @($eventsResult.Json)
if ($events.Count -eq 1 -and $events[0] -is [System.Array]) {
    $events = @($events[0])
}

$matching = @($events | Where-Object { $_.code -eq $catalogCode })
if ($matching.Count -lt 1) {
    throw "Expected at least one $catalogCode event in query results."
}

$decodedMatching = @($events | Where-Object { $_.code -eq "P0420" })
if ($decodedMatching.Count -lt 1) {
    throw "Expected at least one P0420 event from decode endpoint in query results."
}

Write-Host ("Queried {0} event(s) in range; found {1} with code {2}." -f $events.Count, $matching.Count, $catalogCode)
Write-Host ("Decoded code check: found {0} event(s) with code P0420." -f $decodedMatching.Count)
Write-Host "DTC SUMMARY: PASS catalog upsert/import/decode/query flow verified with idempotent duplicate skip." -ForegroundColor Green
Write-Host "`nPhase 5 DTC smoke test complete." -ForegroundColor Green

param(
    [string]$ApiBaseUrl = "http://localhost:5124",
    [int]$TraccarDeviceId = 141880,
    [bool]$UseDeterministicTripWindow = $true,
    [string]$DeterministicTripStartUtc = "2026-01-15T12:00:00Z"
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-Json {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [object]$Body
    )

    if ($Method -eq "POST") {
        $jsonBody = $Body | ConvertTo-Json -Depth 8
        return Invoke-RestMethod -Method Post -Uri $Uri -ContentType "application/json" -Body $jsonBody
    }

    return Invoke-RestMethod -Method Get -Uri $Uri
}

Write-Host "Phase 5 smoke test" -ForegroundColor Green
Write-Host "API: $ApiBaseUrl"
Write-Host "Traccar device ID: $TraccarDeviceId"
Write-Host "Deterministic trip window: $UseDeterministicTripWindow"

Write-Step "Health check"
try {
    $health = Invoke-Json -Method GET -Uri "$ApiBaseUrl/health"
    Write-Host ("Health: {0} at {1}" -f $health.status, $health.checkedAtUtc)
}
catch {
    Write-Host "Health request failed (expected if DB is unreachable):" -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    throw
}

Write-Step "Vehicles lookup"
$vehicles = Invoke-Json -Method GET -Uri "$ApiBaseUrl/api/vehicles"
$targetVehicle = $vehicles | Where-Object { $_.traccarDeviceId -eq $TraccarDeviceId } | Select-Object -First 1

if (-not $targetVehicle) {
    Write-Host "No vehicle mapped to this traccarDeviceId via active vehicle_device_bindings." -ForegroundColor Yellow
    Write-Host "Available mappings:" -ForegroundColor Yellow
    $vehicles | Select-Object id, displayName, traccarDeviceId, active | Format-Table
    throw "Missing active vehicle binding for traccarDeviceId $TraccarDeviceId"
}

Write-Host ("Vehicle match: {0} ({1})" -f $targetVehicle.displayName, $targetVehicle.id)

Write-Step "Import one synthetic trip (safe dedupe key on exact start/end timestamps)"
if ($UseDeterministicTripWindow) {
    $start = [DateTimeOffset]::Parse($DeterministicTripStartUtc).ToUniversalTime()
    $end = $start.AddMinutes(30)
}
else {
    $start = [DateTimeOffset]::UtcNow.AddMinutes(-40)
    $end = [DateTimeOffset]::UtcNow.AddMinutes(-10)
}

$duration = [int]([Math]::Round(($end - $start).TotalSeconds))
Write-Host ("Trip window UTC: {0} -> {1}" -f $start.ToString("o"), $end.ToString("o"))

$importBody = @{
    traccarDeviceId = $TraccarDeviceId
    trips = @(
        @{
            startedAt = $start.ToString("o")
            endedAt = $end.ToString("o")
            durationSeconds = $duration
            distanceMeters = 8123.4
            avgSpeedMph = 22.8
            maxSpeedMph = 47.1
            notes = "phase5 smoke test"
        }
    )
}

$importResult = Invoke-Json -Method POST -Uri "$ApiBaseUrl/api/trips/import-by-device" -Body $importBody
Write-Host ("Import result: vehicleId={0}, imported={1}, skipped={2}" -f $importResult.vehicleId, $importResult.imported, $importResult.skipped)

if (($importResult.imported + $importResult.skipped) -lt 1) {
    throw "Import did not process any trip entries."
}

Write-Step "Day summaries for returned vehicleId"
$fromUtc = [Uri]::EscapeDataString([DateTimeOffset]::UtcNow.AddDays(-7).ToString("o"))
$toUtc = [Uri]::EscapeDataString([DateTimeOffset]::UtcNow.ToString("o"))
$summaryUri = "$ApiBaseUrl/api/trips/day-summaries?vehicleId=$($importResult.vehicleId)&from=$fromUtc&to=$toUtc"
$summaries = Invoke-Json -Method GET -Uri $summaryUri

if (-not $summaries -or $summaries.Count -eq 0) {
    Write-Host "No day summaries returned." -ForegroundColor Yellow
}
else {
    $summaries | Select-Object dayUtc, tripCount, distanceMeters | Format-Table
}

$finalSummary = if ($UseDeterministicTripWindow -and $importResult.imported -eq 0 -and $importResult.skipped -ge 1) {
    "PASS deterministic dedupe confirmed (imported=$($importResult.imported), skipped=$($importResult.skipped))"
}
elseif ($UseDeterministicTripWindow -and $importResult.imported -ge 1 -and $importResult.skipped -eq 0) {
    "INFO deterministic seed inserted on this run (imported=$($importResult.imported), skipped=$($importResult.skipped)); rerun should skip"
}
else {
    "INFO import result imported=$($importResult.imported), skipped=$($importResult.skipped)"
}

Write-Host ("SMOKE SUMMARY: {0}" -f $finalSummary) -ForegroundColor Green

Write-Host "`nPhase 5 smoke test complete." -ForegroundColor Green

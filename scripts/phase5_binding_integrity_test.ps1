param(
    [string]$ApiBaseUrl = "http://localhost:5124",
    [int]$TraccarDeviceId = 1999999999,
    [string]$VehicleAId,
    [string]$VehicleBId
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

function As-FlatArray {
    param([object]$Value)

    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [System.Array] -and $Value.Length -eq 1 -and $Value[0] -is [System.Array]) {
        return @($Value[0])
    }

    return @($Value)
}

Write-Host "Phase 5 binding integrity test" -ForegroundColor Green
Write-Host "API: $ApiBaseUrl"
Write-Host "Traccar test device ID: $TraccarDeviceId"

Write-Step "Health check"
$health = Invoke-Json -Method GET -Uri "$ApiBaseUrl/health"
Write-Host ("Health: {0} at {1}" -f $health.status, $health.checkedAtUtc)

Write-Step "Load vehicles"
$vehicles = As-FlatArray (Invoke-Json -Method GET -Uri "$ApiBaseUrl/api/vehicles")
if ($vehicles.Count -lt 2) {
    throw "Need at least two vehicles to validate competing bindings."
}

$resolvedVehicleAId = $VehicleAId
$resolvedVehicleBId = $VehicleBId

if ([string]::IsNullOrWhiteSpace($resolvedVehicleAId) -or [string]::IsNullOrWhiteSpace($resolvedVehicleBId)) {
    $resolvedVehicleAId = [string]$vehicles[0].id
    $resolvedVehicleBId = [string]$vehicles[1].id
}

if ($resolvedVehicleAId -eq $resolvedVehicleBId) {
    throw "VehicleAId and VehicleBId must be different."
}

$vehicleA = $vehicles | Where-Object { [string]$_.id -eq $resolvedVehicleAId } | Select-Object -First 1
$vehicleB = $vehicles | Where-Object { [string]$_.id -eq $resolvedVehicleBId } | Select-Object -First 1

if (-not $vehicleA) {
    throw "VehicleAId $resolvedVehicleAId was not found in /api/vehicles."
}

if (-not $vehicleB) {
    throw "VehicleBId $resolvedVehicleBId was not found in /api/vehicles."
}

Write-Host ("Vehicle A: {0} ({1})" -f $vehicleA.displayName, $resolvedVehicleAId)
Write-Host ("Vehicle B: {0} ({1})" -f $vehicleB.displayName, $resolvedVehicleBId)

Write-Step "Apply competing upserts for one device"
$beforeBindings = As-FlatArray (Invoke-Json -Method GET -Uri "$ApiBaseUrl/api/device-bindings")
$beforeRows = @($beforeBindings | Where-Object { $_.traccarDeviceId -eq $TraccarDeviceId })
Write-Host ("Before active rows for test device: {0}" -f $beforeRows.Count)

$bodyA = @{
    vehicleId = $resolvedVehicleAId
    traccarDeviceId = $TraccarDeviceId
    isPrimary = $true
}

$bodyB = @{
    vehicleId = $resolvedVehicleBId
    traccarDeviceId = $TraccarDeviceId
    isPrimary = $true
}

Invoke-Json -Method POST -Uri "$ApiBaseUrl/api/device-bindings/upsert" -Body $bodyA | Out-Null
Invoke-Json -Method POST -Uri "$ApiBaseUrl/api/device-bindings/upsert" -Body $bodyB | Out-Null

Write-Step "Validate active binding invariants"
$afterBindings = As-FlatArray (Invoke-Json -Method GET -Uri "$ApiBaseUrl/api/device-bindings")
$afterRows = @($afterBindings | Where-Object { $_.traccarDeviceId -eq $TraccarDeviceId })
Write-Host ("After active rows for test device: {0}" -f $afterRows.Count)

if ($afterRows.Count -gt 0) {
    $afterRows | Select-Object id, vehicleId, vehicleDisplayName, traccarDeviceId, isPrimary, startsAt, endsAt | Format-Table
}

if ($afterRows.Count -ne 1) {
    throw "Expected exactly one active binding row for device $TraccarDeviceId but found $($afterRows.Count)."
}

$survivor = $afterRows[0]
if (-not $survivor.isPrimary) {
    throw "Expected active row to be primary, but isPrimary was false."
}

if ([string]$survivor.vehicleId -ne $resolvedVehicleBId) {
    throw "Expected survivor to match latest upsert vehicle ($resolvedVehicleBId), got $($survivor.vehicleId)."
}

Write-Host "BINDING SUMMARY: PASS one active primary binding remains and latest upsert wins." -ForegroundColor Green
Write-Host "`nPhase 5 binding integrity test complete." -ForegroundColor Green

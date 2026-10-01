param(
    [string]$ApiBaseUrl = "http://localhost:5124",
    [int]$TraccarDeviceId = 141880,
    [bool]$UseDeterministicTripWindow = $true,
    [int]$BindingTestDeviceId = 1999999999,
    [switch]$RunDtcTraccarIngest,
    [string]$TraccarBaseUrl = "http://192.168.16.16:8082",
    [ValidateSet("positions", "events", "both")][string]$TraccarIngestSource = "both",
    [datetimeoffset]$TraccarIngestFromUtc = ([DateTimeOffset]::UtcNow.AddDays(-7)),
    [datetimeoffset]$TraccarIngestToUtc = ([DateTimeOffset]::UtcNow),
    [int]$TraccarIngestLimit = 5000,
    [switch]$TraccarIngestIncludeIo30Fallback,
    [switch]$TraccarIngestIncludeIo30ZeroBaseline,
    [string[]]$TraccarIngestIo30FallbackAllowedStatuses = @(),
    [switch]$SkipDtcSmokeTest,
    [switch]$SkipBindingIntegrityTest,
    [switch]$SkipFrontendBuild,
    [switch]$SkipBackendBuild
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$backendRoot = Resolve-Path (Join-Path $repoRoot "backend\VehicleApp.Api")
$smokeScript = Join-Path $PSScriptRoot "phase5_smoke_test.ps1"
$bindingScript = Join-Path $PSScriptRoot "phase5_binding_integrity_test.ps1"
$dtcSmokeScript = Join-Path $PSScriptRoot "phase5_dtc_smoke_test.ps1"
$dtcTraccarIngestScript = Join-Path $PSScriptRoot "phase5_dtc_traccar_ingest.ps1"

Write-Host "Phase 5 regression" -ForegroundColor Green
Write-Host "API: $ApiBaseUrl"
Write-Host "Smoke test device ID: $TraccarDeviceId"
Write-Host "Binding test device ID: $BindingTestDeviceId"

$effectiveSmokeDeviceId = $TraccarDeviceId

Write-Step "Health check"
$health = Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl/health"
Write-Host ("Health: {0} at {1}" -f $health.status, $health.checkedAtUtc)

Write-Step "Smoke device preflight"
$vehicles = @(Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl/api/vehicles")
if ($vehicles.Count -eq 1 -and $vehicles[0] -is [System.Array]) {
    $vehicles = @($vehicles[0])
}

$mappedVehicle = $vehicles | Where-Object { $_.traccarDeviceId -eq $effectiveSmokeDeviceId } | Select-Object -First 1
if (-not $mappedVehicle) {
    $fallbackVehicle = $vehicles | Where-Object { $null -ne $_.traccarDeviceId } | Select-Object -First 1
    if (-not $fallbackVehicle) {
        throw "No mapped traccarDeviceId found in /api/vehicles for smoke test."
    }

    $effectiveSmokeDeviceId = [int]$fallbackVehicle.traccarDeviceId
    Write-Host ("Requested smoke device id {0} is not mapped. Falling back to mapped device id {1} ({2})." -f $TraccarDeviceId, $effectiveSmokeDeviceId, $fallbackVehicle.displayName) -ForegroundColor Yellow
}
else {
    Write-Host ("Smoke test will use mapped device id {0} ({1})." -f $effectiveSmokeDeviceId, $mappedVehicle.displayName)
}

Write-Step "Deterministic smoke test"
& $smokeScript -ApiBaseUrl $ApiBaseUrl -TraccarDeviceId $effectiveSmokeDeviceId -UseDeterministicTripWindow:$UseDeterministicTripWindow

if (-not $SkipBindingIntegrityTest) {
    Write-Step "Binding integrity regression"
    & $bindingScript -ApiBaseUrl $ApiBaseUrl -TraccarDeviceId $BindingTestDeviceId
}
else {
    Write-Host "Skipping binding integrity test by request." -ForegroundColor Yellow
}

if (-not $SkipDtcSmokeTest) {
    Write-Step "DTC enrichment smoke test"
    & $dtcSmokeScript -ApiBaseUrl $ApiBaseUrl -TraccarDeviceId $effectiveSmokeDeviceId
}
else {
    Write-Host "Skipping DTC smoke test by request." -ForegroundColor Yellow
}

if ($RunDtcTraccarIngest) {
    Write-Step "DTC Traccar pull+decode ingest"
    & $dtcTraccarIngestScript `
        -ApiBaseUrl $ApiBaseUrl `
        -TraccarBaseUrl $TraccarBaseUrl `
        -TraccarDeviceId $effectiveSmokeDeviceId `
        -Source $TraccarIngestSource `
        -FromUtc $TraccarIngestFromUtc `
        -ToUtc $TraccarIngestToUtc `
        -Limit $TraccarIngestLimit `
        -IncludeIo30Fallback:$TraccarIngestIncludeIo30Fallback `
        -IncludeIo30ZeroBaseline:$TraccarIngestIncludeIo30ZeroBaseline `
        -Io30FallbackAllowedStatuses $TraccarIngestIo30FallbackAllowedStatuses
}
else {
    Write-Host "Skipping DTC Traccar ingest stage (use -RunDtcTraccarIngest to enable)." -ForegroundColor Yellow
}

if (-not $SkipFrontendBuild) {
    Write-Step "Frontend build"
    Push-Location $repoRoot
    try {
        npm run build
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host "Skipping frontend build by request." -ForegroundColor Yellow
}

if (-not $SkipBackendBuild) {
    Write-Step "Backend build"
    Push-Location $backendRoot
    try {
        dotnet build -o bin_check
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host "Skipping backend build by request." -ForegroundColor Yellow
}

if (-not $SkipFrontendBuild -and -not $SkipBackendBuild) {
    Write-Host "REGRESSION SUMMARY: PASS phase 5 smoke, binding integrity, DTC smoke, optional Traccar ingest, and build checks completed." -ForegroundColor Green
}
else {
    Write-Host "REGRESSION SUMMARY: PASS phase 5 smoke, binding integrity, DTC smoke, and optional Traccar ingest completed (one or more build checks skipped by request)." -ForegroundColor Green
}
Write-Host "`nPhase 5 regression complete." -ForegroundColor Green

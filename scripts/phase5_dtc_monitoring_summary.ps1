param(
    [string]$ApiBaseUrl = "http://localhost:5124",
    [Guid]$VehicleId,
    [int]$LookbackDays = 35,
    [int]$LimitPerVehicle = 5000,
    [switch]$IncludeCodeBreakdown
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Get-WindowMetrics {
    param(
        [object[]]$Events,
        [datetimeoffset]$WindowStartUtc,
        [datetimeoffset]$WindowEndUtc
    )

    $inWindow = @($Events | Where-Object {
        $detected = [datetimeoffset]$_.detectedAt
        $detected -ge $WindowStartUtc -and $detected -le $WindowEndUtc
    })

    $io30Count = @($inWindow | Where-Object { $_.code -eq "IO30_COUNT" }).Count
    $explicitCodes = @($inWindow | Where-Object { $_.code -ne "IO30_COUNT" })

    [PSCustomObject]@{
        Total = $inWindow.Count
        Io30Count = $io30Count
        ExplicitCount = $explicitCodes.Count
        ExplicitTop = @($explicitCodes | Group-Object -Property code | Sort-Object Count -Descending | Select-Object -First 5)
    }
}

Write-Host "Phase 5 DTC monitoring summary" -ForegroundColor Green
Write-Host "Vehicle API: $ApiBaseUrl"
Write-Host "Lookback days: $LookbackDays"
Write-Host "Limit per vehicle: $LimitPerVehicle"

Write-Step "Health check"
$health = Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl/health"
Write-Host ("Health: {0} at {1}" -f $health.status, $health.checkedAtUtc)

Write-Step "Load vehicles"
$vehicles = @(Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl/api/vehicles")
if ($vehicles.Count -eq 1 -and $vehicles[0] -is [System.Array]) {
    $vehicles = @($vehicles[0])
}

if ($VehicleId) {
    $vehicles = @($vehicles | Where-Object { $_.id -eq $VehicleId.Guid })
}

if ($vehicles.Count -eq 0) {
    throw "No vehicles found for monitoring summary."
}

$fromUtc = [DateTimeOffset]::UtcNow.AddDays(-1 * [Math]::Abs($LookbackDays))
$toUtc = [DateTimeOffset]::UtcNow

$summaryRows = New-Object System.Collections.Generic.List[object]
$codeRows = New-Object System.Collections.Generic.List[object]

foreach ($vehicle in $vehicles) {
    $vehicleName = if ([string]::IsNullOrWhiteSpace($vehicle.displayName)) { $vehicle.id } else { $vehicle.displayName }

    Write-Step ("Fetch DTC events for {0}" -f $vehicleName)
    $eventsUri = "$ApiBaseUrl/api/dtc/events?vehicleId=$($vehicle.id)&from=$([Uri]::EscapeDataString($fromUtc.ToString('o')))&to=$([Uri]::EscapeDataString($toUtc.ToString('o')))&limit=$LimitPerVehicle"
    $events = @(Invoke-RestMethod -Method Get -Uri $eventsUri)
    if ($events.Count -eq 1 -and $events[0] -is [System.Array]) {
        $events = @($events[0])
    }

    $daily = Get-WindowMetrics -Events $events -WindowStartUtc ([DateTimeOffset]::UtcNow.AddDays(-1)) -WindowEndUtc $toUtc
    $weekly = Get-WindowMetrics -Events $events -WindowStartUtc ([DateTimeOffset]::UtcNow.AddDays(-7)) -WindowEndUtc $toUtc
    $monthly = Get-WindowMetrics -Events $events -WindowStartUtc ([DateTimeOffset]::UtcNow.AddDays(-30)) -WindowEndUtc $toUtc

    foreach ($pair in @(
        @{ Label = "daily"; Data = $daily },
        @{ Label = "weekly"; Data = $weekly },
        @{ Label = "monthly"; Data = $monthly }
    )) {
        $topCodesText = ""
        if ($pair.Data.ExplicitTop.Count -gt 0) {
            $topCodesText = ($pair.Data.ExplicitTop | ForEach-Object { "{0}={1}" -f $_.Name, $_.Count }) -join "; "
        }

        $summaryRows.Add([PSCustomObject]@{
            vehicle = $vehicleName
            vehicleId = $vehicle.id
            window = $pair.Label
            totalEvents = $pair.Data.Total
            io30CountEvents = $pair.Data.Io30Count
            explicitCodeEvents = $pair.Data.ExplicitCount
            topExplicitCodes = $topCodesText
        })

        if ($IncludeCodeBreakdown -and $pair.Data.ExplicitTop.Count -gt 0) {
            foreach ($top in $pair.Data.ExplicitTop) {
                $codeRows.Add([PSCustomObject]@{
                    vehicle = $vehicleName
                    window = $pair.Label
                    code = $top.Name
                    count = $top.Count
                })
            }
        }
    }
}

Write-Step "Monitoring summary"
$summaryRows |
    Sort-Object vehicle, @{ Expression = {
        switch ($_.window) {
            "daily" { 1 }
            "weekly" { 2 }
            "monthly" { 3 }
            default { 4 }
        }
    }} |
    Format-Table -AutoSize

if ($IncludeCodeBreakdown -and $codeRows.Count -gt 0) {
    Write-Step "Top explicit code breakdown"
    $codeRows | Sort-Object vehicle, window, count -Descending | Format-Table -AutoSize
}

Write-Host "`nMONITOR SUMMARY: PASS generated daily/weekly/monthly DTC metrics." -ForegroundColor Green

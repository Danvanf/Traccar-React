$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$testRunId = [Guid]::NewGuid().ToString('N')
$containerName = "scope-access-test-$testRunId"
$testBuildOutput = Join-Path ([IO.Path]::GetTempPath()) $containerName
$previousConnection = [Environment]::GetEnvironmentVariable('VEHICLE_ACCESS_TEST_CONNECTION')
$containerId = $null
try {
    & docker image inspect postgres:17-alpine *> $null
    if ($LASTEXITCODE -ne 0) {
        & docker pull postgres:17-alpine
        if ($LASTEXITCODE -ne 0) { throw 'Unable to obtain official PostgreSQL test image.' }
    }
    & dotnet build (Join-Path $PSScriptRoot 'VehicleAccess.IntegrationTests.csproj') --output $testBuildOutput -p:UseAppHost=false -v:q
    if ($LASTEXITCODE -ne 0) { throw 'Test build failed.' }
    $containerId = (& docker run --rm --detach --name $containerName --label "traccar-scope.test-run=$testRunId" --publish '127.0.0.1::5432' --env 'POSTGRES_PASSWORD=access-fixture-only' --env 'POSTGRES_DB=access_fixture' postgres:17-alpine)
    if ($LASTEXITCODE -ne 0 -or $containerId -notmatch '^[0-9a-f]{64}$') { throw 'Test database did not start.' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        & docker exec $containerId pg_isready --host 127.0.0.1 --username postgres --dbname access_fixture *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (!$ready) { throw 'Disposable test database did not become ready.' }
    $binding = (& docker port $containerId 5432/tcp)
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Unexpected test database port binding.' }
    $testPort = [int]$Matches[1]
    $env:VEHICLE_ACCESS_TEST_CONNECTION = "Host=127.0.0.1;Port=$testPort;Database=access_fixture;Username=postgres;Password=access-fixture-only;Timeout=10"
    Push-Location -LiteralPath $repoRoot
    try {
        & dotnet (Join-Path $testBuildOutput 'VehicleAccess.IntegrationTests.dll')
        if ($LASTEXITCODE -ne 0) { throw "Authorization tests failed (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
} finally {
    [Environment]::SetEnvironmentVariable('VEHICLE_ACCESS_TEST_CONNECTION', $previousConnection)
    if ($containerId -match '^[0-9a-f]{64}$') {
        & docker stop $containerId | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not stop disposable test container $containerName." }
        else { Write-Host 'Disposable PostgreSQL test container removed.' }
    }
}
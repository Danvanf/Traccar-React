# Uses Twilio test Account SID/Auth Token saved on the default Twilio provider
# account in Settings > SMS Test. It calls a Development-only API route and never uses the live Twilio credentials.
param(
    [string] $ApiBaseUrl = $(if ($env:TRACCAR_REACT_API_BASE_URL) { $env:TRACCAR_REACT_API_BASE_URL } else { 'http://localhost:5124' })
)

$endpoint = "$($ApiBaseUrl.TrimEnd('/'))/api/admin/sms/twilio-magic-test"
$validTo = '+5571981265131'
$cases = @(
    @{ Name = 'valid From'; From = '+15005550006'; To = $validTo; ExpectedHttp = 201; ExpectedError = $null },
    @{ Name = 'invalid From'; From = '+15005550001'; To = $validTo; ExpectedHttp = 400; ExpectedError = 21212 },
    @{ Name = 'From not owned / not SMS capable'; From = '+15005550007'; To = $validTo; ExpectedHttp = 400; ExpectedError = 21606 },
    @{ Name = 'From queue full'; From = '+15005550008'; To = $validTo; ExpectedHttp = 400; ExpectedError = 21611 },
    @{ Name = 'invalid To'; From = '+15005550006'; To = '+15005550001'; ExpectedHttp = 400; ExpectedError = 21211 },
    @{ Name = 'unroutable To'; From = '+15005550006'; To = '+15005550002'; ExpectedHttp = 400; ExpectedError = 21612 },
    @{ Name = 'international permission To'; From = '+15005550006'; To = '+15005550003'; ExpectedHttp = 400; ExpectedError = 21408 },
    @{ Name = 'blocked To'; From = '+15005550006'; To = '+15005550004'; ExpectedHttp = 400; ExpectedError = 21610 },
    @{ Name = 'To cannot receive SMS'; From = '+15005550006'; To = '+15005550009'; ExpectedHttp = 400; ExpectedError = 21614 }
)

$failed = 0
foreach ($case in $cases) {
    try {
        $body = @{ from = $case.From; to = $case.To } | ConvertTo-Json -Compress
        $result = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
        $passed = [bool]$result.accepted -eq ($case.ExpectedHttp -eq 201) -and
            $result.httpStatusCode -eq $case.ExpectedHttp -and
            $result.twilioErrorCode -eq $case.ExpectedError
        if ($passed) {
            "PASS $($case.Name): Twilio HTTP $($result.httpStatusCode), error $($result.twilioErrorCode)"
        } else {
            $failed++
            "FAIL $($case.Name): expected HTTP $($case.ExpectedHttp), error $($case.ExpectedError); got HTTP $($result.httpStatusCode), error $($result.twilioErrorCode)"
        }
    } catch {
        $failed++
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode) {
            "FAIL $($case.Name): app endpoint returned HTTP $statusCode"
        } else {
            "FAIL $($case.Name): $($_.Exception.Message.Split([Environment]::NewLine)[0])"
        }
    }
}

if ($failed -gt 0) {
    throw "$failed Twilio magic-number API test(s) failed."
}
"All $($cases.Count) Twilio magic-number API tests passed."

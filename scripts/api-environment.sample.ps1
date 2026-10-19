# SAMPLE ONLY: PowerShell environment template for the Traccar Scope API.
# Replace the example connection values before use. Never commit real secrets.
# Dot-source this file in the PowerShell session that starts the API:
#   . .\scripts\api-environment.sample.ps1

# MINIMUM API STARTUP CONFIGURATION
# The API requires a reachable PostgreSQL database and this connection string.
$env:ConnectionStrings__TraccarScopeApi = 'Host=localhost;Port=5432;Database=traccar_scope_api;Username=REPLACE_ME;Password=REPLACE_ME'

# Hosting overrides: adjust these for the way the API is launched. They are not
# Traccar Scope application credentials. The defaults depend on the host/runtime.
$env:ASPNETCORE_ENVIRONMENT = 'Production'
$env:ASPNETCORE_URLS = 'http://+:5124'
# Optional host filtering and logging overrides:
# $env:AllowedHosts = 'localhost;your-api-hostname'
# $env:Logging__LogLevel__Default = 'Information'
# $env:Logging__LogLevel__Microsoft = 'Warning'

# FIRST-ADMIN BOOTSTRAP (only when app_users has no matching administrator)
# Set these before the first API start against a new Traccar Scope database.
# On startup, the API ensures this username exists and has the admin role, but it
# does not replace an existing non-empty password hash. Remove these after setup
# so a deleted bootstrap account is not recreated later.
# $env:TraccarScopeApi__Auth__Username = 'REPLACE_ME'
# $env:TraccarScopeApi__Auth__Password = 'REPLACE_WITH_A_STRONG_PASSWORD'

# PERSISTENT CREDENTIAL ENCRYPTION KEY RING
# Required to save/read encrypted credentials managed from Settings, such as
# Traccar passwords and email/SMS provider secrets. Generate one random 32-byte
# key once, keep it stable, and back it up securely. Do not regenerate on restart.
# Generate a value in PowerShell with:
#   $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
#   $bytes = New-Object byte[] 32
#   $rng.GetBytes($bytes)
#   [Convert]::ToBase64String($bytes)
#   $rng.Dispose()
$env:TraccarScopeApi__CredentialEncryption__ActiveKeyId = 'primary'
$env:TraccarScopeApi__CredentialEncryption__Keys__primary = 'REPLACE_WITH_BASE64_32_BYTE_KEY'

# APPLICATION SETTINGS — configure these in the application
# Settings > General stores the Traccar API path, Traccar login/password, and app
# preferences in the Traccar Scope database. The upstream Traccar host used by
# the API proxy is a separate optional server setting shown below. Connect or
# update Bouncie from its Settings view. Email/SMS provider accounts are created
# in Settings and their secrets are encrypted with the key ring above; database
# account edits apply without an API restart. There are no environment overrides
# for provider accounts, provider webhook secrets, or Bouncie credentials.

# These per-instance alert limits remain environment settings; the API supplies
# defaults when omitted. They are not provider credentials or account records.
# $env:TraccarScopeApi__Email__DailyLimit = '75'
# $env:TraccarScopeApi__Sms__DailyLimit = '1'
# $env:TraccarScopeApi__Sms__AlertDailyLimit = '25'

# Optional server-side Traccar overrides:
#   Traccar:BaseUrl defaults to http://localhost:8082 in Development and
#   http://traccar:8082 otherwise. Set it when the API cannot reach Traccar at
#   the default host (for example, when running the API outside Docker).
# These read-only credentials are for the optional developer device-protocol
# diagnostics endpoint. They are not the normal Traccar login configured in
# Settings > General.
# $env:Traccar__BaseUrl = 'http://traccar:8082'
# $env:Traccar__Username = 'READ_ONLY_DIAGNOSTICS_USER'
# $env:Traccar__Password = 'REPLACE_ME'

# Development-only loopback authentication bypass. Never enable in production.
# It is honored only when ASPNETCORE_ENVIRONMENT is Development and the request
# originates from the API host itself.
# $env:TraccarScopeApi__Auth__AllowUnauthenticatedDevelopment = 'true'

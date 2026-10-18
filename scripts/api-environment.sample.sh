#!/usr/bin/env bash
# SAMPLE ONLY: Bash environment template for the Traccar React API.
# Replace the example connection values before use. Never commit real secrets.
# Source this file in the shell session that starts the API:
#   source ./scripts/api-environment.sample.sh

# MINIMUM API STARTUP CONFIGURATION
# The API requires a reachable PostgreSQL database and this connection string.
export ConnectionStrings__TraccarReactApi='Host=localhost;Port=5432;Database=traccar_react_api;Username=REPLACE_ME;Password=REPLACE_ME'

# Hosting overrides: adjust these for the way the API is launched. They are not
# Traccar React application credentials. The defaults depend on the host/runtime.
export ASPNETCORE_ENVIRONMENT='Production'
export ASPNETCORE_URLS='http://+:5124'
# Optional host filtering and logging overrides:
# export AllowedHosts='localhost;your-api-hostname'
# export Logging__LogLevel__Default='Information'
# export Logging__LogLevel__Microsoft='Warning'

# FIRST-ADMIN BOOTSTRAP (only when app_users has no matching administrator)
# Set these before the first API start against a new Traccar React database.
# On startup, the API ensures this username exists and has the admin role, but it
# does not replace an existing non-empty password hash. Remove these after setup
# so a deleted bootstrap account is not recreated later.
# export TraccarReactApi__Auth__Username='REPLACE_ME'
# export TraccarReactApi__Auth__Password='REPLACE_WITH_A_STRONG_PASSWORD'

# PERSISTENT CREDENTIAL ENCRYPTION KEY RING
# Required to save/read encrypted credentials managed from Settings, such as
# Traccar passwords and email/SMS provider secrets. Generate one random 32-byte
# key once, keep it stable, and back it up securely. Do not regenerate on restart.
# Generate a value with: openssl rand -base64 32
export TraccarReactApi__CredentialEncryption__ActiveKeyId='primary'
export TraccarReactApi__CredentialEncryption__Keys__primary='REPLACE_WITH_BASE64_32_BYTE_KEY'

# APPLICATION SETTINGS — configure these in the application
# Settings > General stores the Traccar API path, Traccar login/password, and app
# preferences in the Traccar React database. The upstream Traccar host used by
# the API proxy is a separate optional server setting shown below. Connect or
# update Bouncie from its Settings view. Email/SMS provider accounts are created
# in Settings and their secrets are encrypted with the key ring above; database
# account edits apply without an API restart. There are no environment overrides
# for provider accounts, provider webhook secrets, or Bouncie credentials.

# These per-instance alert limits remain environment settings; the API supplies
# defaults when omitted. They are not provider credentials or account records.
# export TraccarReactApi__Email__DailyLimit='75'
# export TraccarReactApi__Sms__DailyLimit='1'
# export TraccarReactApi__Sms__AlertDailyLimit='25'

# Optional server-side Traccar overrides:
#   Traccar:BaseUrl defaults to http://localhost:8082 in Development and
#   http://traccar:8082 otherwise. Set it when the API cannot reach Traccar at
#   the default host (for example, when running the API outside Docker).
# These read-only credentials are for the optional developer device-protocol
# diagnostics endpoint. They are not the normal Traccar login configured in
# Settings > General.
# export Traccar__BaseUrl='http://traccar:8082'
# export Traccar__Username='READ_ONLY_DIAGNOSTICS_USER'
# export Traccar__Password='REPLACE_ME'

# Development-only loopback authentication bypass. Never enable in production.
# It is honored only when ASPNETCORE_ENVIRONMENT is Development and the request
# originates from the API host itself.
# export TraccarReactApi__Auth__AllowUnauthenticatedDevelopment='true'

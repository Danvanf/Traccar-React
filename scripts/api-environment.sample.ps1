# SAMPLE ONLY: This is a template listing the API environment variables.
# Replace example values and add secrets before use. Do not commit real secrets.
# Dot-source in the PowerShell session that will start the API:
#   . .\scripts\api-environment.sample.ps1

# API hosting
$env:ASPNETCORE_ENVIRONMENT = 'Production'
$env:ASPNETCORE_URLS = 'http://+:5124'
$env:AllowedHosts = '*'
$env:Logging__LogLevel__Default = 'Information'
$env:Logging__LogLevel__Microsoft = 'Warning'

# PostgreSQL connection used by the Vehicle App API
$env:ConnectionStrings__VehicleApp = 'Host=localhost;Port=5432;Database=vehicle_app;Username=REPLACE_ME;Password=REPLACE_ME'

# API authentication
$env:VehicleApp__Auth__Username = 'REPLACE_ME'
$env:VehicleApp__Auth__Password = 'REPLACE_ME'
$env:VehicleApp__Auth__AllowUnauthenticatedDevelopment = 'false'
# Legacy fallback names. Use these only if the corresponding VehicleApp__Auth__ value above is unset.
# $env:VEHICLE_APP_AUTH_USERNAME = 'REPLACE_ME'
# $env:VEHICLE_APP_AUTH_PASSWORD = 'REPLACE_ME'

# Optional read-only Traccar account used for device protocol diagnostics during development
$env:Traccar__BaseUrl = ''
$env:Traccar__Username = ''
$env:Traccar__Password = ''
# Legacy fallback names. Use these only if the corresponding Traccar__ value above is unset.
# $env:TRACCAR_BASE_URL = 'https://traccar.example.com'
# $env:TRACCAR_USERNAME = 'REPLACE_ME'
# $env:TRACCAR_PASSWORD = 'REPLACE_ME'

# Optional Bouncie credential encryption key (Base64-encoded 32-byte key; keep stable for stored credentials)
$env:VehicleApp__Bouncie__EncryptionKey = ''
# Legacy fallback, only if VehicleApp__Bouncie__EncryptionKey is unset.
# $env:VEHICLE_APP_BOUNCIE_ENCRYPTION_KEY = 'REPLACE_WITH_BASE64_32_BYTE_KEY'

# Email delivery: Disabled, Graph, Resend, or Brevo
$env:VehicleApp__Email__Provider = 'Disabled'
$env:VehicleApp__Email__DailyLimit = '75'
# Microsoft Graph (required when Provider=Graph)
$env:VehicleApp__Email__Graph__TenantId = ''
$env:VehicleApp__Email__Graph__ClientId = ''
$env:VehicleApp__Email__Graph__ClientSecret = ''
# Resend (required when Provider=Resend)
$env:VehicleApp__Email__Resend__ApiKey = ''
$env:VehicleApp__Email__Resend__From = ''
$env:VehicleApp__Email__Resend__WebhookSecret = ''
# Brevo (required when Provider=Brevo)
$env:VehicleApp__Email__Brevo__ApiKey = ''
$env:VehicleApp__Email__Brevo__FromEmail = ''
$env:VehicleApp__Email__Brevo__FromName = ''
$env:VehicleApp__Email__Brevo__WebhookToken = ''

# SMS delivery: Disabled, Textbelt, or Twilio
$env:VehicleApp__Sms__Provider = 'Disabled'
$env:VehicleApp__Sms__DailyLimit = '1'
$env:VehicleApp__Sms__AlertDailyLimit = '25'
# Textbelt (required when Provider=Textbelt)
$env:VehicleApp__Sms__Textbelt__ApiKey = ''
# Twilio live sending and automatic alert webhooks (required when Provider=Twilio)
$env:VehicleApp__Sms__Twilio__AccountSid = ''
$env:VehicleApp__Sms__Twilio__ApiKeySid = ''
$env:VehicleApp__Sms__Twilio__ApiKeySecret = ''
$env:VehicleApp__Sms__Twilio__FromNumber = ''
$env:VehicleApp__Sms__Twilio__WebhookBaseUrl = ''
$env:VehicleApp__Sms__Twilio__WebhookUsername = ''
$env:VehicleApp__Sms__Twilio__WebhookPassword = ''
# Development-only magic-number tests; use Twilio test-account credentials, never live credentials.
$env:VehicleApp__Sms__Twilio__TestAccountSid = ''
$env:VehicleApp__Sms__Twilio__TestAuthToken = ''

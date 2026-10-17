#!/usr/bin/env bash
# SAMPLE ONLY: This is a template listing the API environment variables.
# Replace example values and add secrets before use. Do not commit real secrets.
# Source in the shell session that will start the API:
#   source ./scripts/api-environment.sample.sh

# API hosting
export ASPNETCORE_ENVIRONMENT='Production'
export ASPNETCORE_URLS='http://+:5124'
export AllowedHosts='*'
export Logging__LogLevel__Default='Information'
export Logging__LogLevel__Microsoft='Warning'

# PostgreSQL connection used by the Traccar React API
export ConnectionStrings__TraccarReactApi='Host=localhost;Port=5432;Database=traccar_react_api;Username=REPLACE_ME;Password=REPLACE_ME'

# Optional bootstrap administrator. Ordinary user accounts and passwords are
# managed in Settings > Users and Groups and stored in app_users.
# Set these only when provisioning the initial administrator for a new database.
# export TraccarReactApi__Auth__Username='REPLACE_ME'
# export TraccarReactApi__Auth__Password='REPLACE_ME'
export TraccarReactApi__Auth__AllowUnauthenticatedDevelopment='false'

# Optional read-only Traccar account used for device protocol diagnostics
export Traccar__BaseUrl=''
export Traccar__Username=''
export Traccar__Password=''
# Legacy fallback names. Use these only if the corresponding Traccar__ value above is unset.
# export TRACCAR_BASE_URL='https://traccar.example.com'
# export TRACCAR_USERNAME='REPLACE_ME'
# export TRACCAR_PASSWORD='REPLACE_ME'

# Legacy Bouncie key (Base64-encoded 32-byte key). Keep this while any existing Bouncie
# credentials or backups still use it; after the shared key ring is configured, startup
# migrates stored Bouncie credentials to the shared format without removing this key.
export TraccarReactApi__Bouncie__EncryptionKey=''
# Legacy alias, only if TraccarReactApi__Bouncie__EncryptionKey is unset.
# export TRACCAR_REACT_API_BOUNCIE_ENCRYPTION_KEY='REPLACE_WITH_BASE64_32_BYTE_KEY'

# Provider credential encryption key ring. Generate and back up a random 32-byte key outside PostgreSQL.
# Keep old key IDs configured while encrypted records or backups may still depend on them.
# Generate a key with: openssl rand -base64 32
export TraccarReactApi__CredentialEncryption__ActiveKeyId='primary'
export TraccarReactApi__CredentialEncryption__Keys__primary=''

# Legacy email provider fallback. A database default account in Settings takes priority over these values.
# Email delivery: Disabled, Graph, Resend, or Brevo
export TraccarReactApi__Email__Provider='Disabled'
export TraccarReactApi__Email__DailyLimit='75'
# Microsoft Graph fallback (used only when Provider=Graph and there is no database default)
export TraccarReactApi__Email__Graph__TenantId=''
export TraccarReactApi__Email__Graph__ClientId=''
export TraccarReactApi__Email__Graph__ClientSecret=''
# Resend fallback (used only when Provider=Resend and there is no database default)
export TraccarReactApi__Email__Resend__ApiKey=''
export TraccarReactApi__Email__Resend__From=''
export TraccarReactApi__Email__Resend__WebhookSecret=''
# Brevo fallback (used only when Provider=Brevo and there is no database default)
export TraccarReactApi__Email__Brevo__ApiKey=''
export TraccarReactApi__Email__Brevo__FromEmail=''
export TraccarReactApi__Email__Brevo__FromName=''
export TraccarReactApi__Email__Brevo__WebhookToken=''

# Legacy SMS provider fallback. A database default account in Settings takes priority over these values.
# SMS delivery: Disabled, Textbelt, or Twilio
export TraccarReactApi__Sms__Provider='Disabled'
export TraccarReactApi__Sms__DailyLimit='1'
export TraccarReactApi__Sms__AlertDailyLimit='25'
# Textbelt fallback (used only when Provider=Textbelt and there is no database default)
export TraccarReactApi__Sms__Textbelt__ApiKey=''
# Twilio fallback for live sending and automatic alert webhooks
export TraccarReactApi__Sms__Twilio__AccountSid=''
export TraccarReactApi__Sms__Twilio__ApiKeySid=''
export TraccarReactApi__Sms__Twilio__ApiKeySecret=''
export TraccarReactApi__Sms__Twilio__FromNumber=''
export TraccarReactApi__Sms__Twilio__WebhookBaseUrl=''
export TraccarReactApi__Sms__Twilio__WebhookUsername=''
export TraccarReactApi__Sms__Twilio__WebhookPassword=''
# Development-only magic-number tests; use Twilio test-account credentials, never live credentials.
export TraccarReactApi__Sms__Twilio__TestAccountSid=''
export TraccarReactApi__Sms__Twilio__TestAuthToken=''

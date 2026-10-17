function normalizeVehicleApiBase(baseUrl) {
  const raw = String(baseUrl || '/vehicle-api').trim()
  let normalized = raw.replace(/\/+$/, '')

  if (!normalized) {
    return '/vehicle-api'
  }

  // Guard against using Traccar API path by mistake.
  if (normalized === '/api') {
    return '/vehicle-api'
  }

  // Support users entering backend URL including /api suffix.
  if (/\/api$/i.test(normalized) && !/\/vehicle-api$/i.test(normalized)) {
    normalized = normalized.slice(0, -4)
  }

  return normalized
}

function vehicleFetch(url, options = {}) {
  return fetch(url, { credentials: 'include', ...options })
}

async function toResponseError(response, context, url) {
  const body = await response.text()
  let parsedMessage = ''
  let problemCode = null
  let problem = null

  if (body) {
    try {
      const payload = JSON.parse(body)
      if (payload && typeof payload === 'object') {
        problemCode = payload.code || null
        const title = typeof payload.title === 'string' ? payload.title.trim() : ''
        const detail = typeof payload.detail === 'string' ? payload.detail.trim() : ''
        const errors = payload.errors && typeof payload.errors === 'object'
          ? Object.entries(payload.errors)
            .flatMap(([, values]) => (Array.isArray(values) ? values : []))
            .filter((value) => typeof value === 'string')
            .join('; ')
          : ''

        parsedMessage = [title, detail, errors]
          .filter(Boolean)
          .join(' - ')

        problem = {
          ...payload,
          title: title || null,
          detail: detail || null,
          code: problemCode,
        }
      }
    } catch {
      parsedMessage = ''
    }
  }

  const fallbackSnippet = body ? body.replace(/\s+/g, ' ').trim().slice(0, 240) : ''
  const snippet = parsedMessage
    ? ` - ${parsedMessage}`
    : (fallbackSnippet ? ` - ${fallbackSnippet}` : '')
  const endpoint = url ? ` [${url}]` : ''
  const error = new Error(`${context}${endpoint}: HTTP ${response.status} ${response.statusText}${snippet}`)
  error.status = response.status
  error.code = problemCode
  error.problem = problem
  return error
}

export async function fetchGlobalGeneralSettings(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/system-settings/general`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Global settings load failed', url)
  return response.json()
}

export async function saveGlobalGeneralSettings(baseUrl, settings) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/system-settings/general`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.ok) throw await toResponseError(response, 'Global settings save failed', url)
}

export async function fetchVehicleAuthStatus(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/auth/status`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API authentication status failed', url)
  return response.json()
}

export async function loginVehicleApi(baseUrl, username, password) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/auth/login`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API login failed', url)
  return response.json()
}

export async function logoutVehicleApi(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/auth/logout`
  const response = await vehicleFetch(url, { method: 'POST' })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API logout failed', url)
}

export async function fetchUserProfile(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/profile`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'User profile lookup failed', url)
  return response.json()
}

export async function saveUserProfile(baseUrl, profile) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/profile`
  const response = await vehicleFetch(url, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: profile.firstName, lastName: profile.lastName, email: profile.email }),
  })
  if (!response.ok) throw await toResponseError(response, 'User profile save failed', url)
}

export async function fetchUserPreference(baseUrl, preferenceKey) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/user/preferences/${encodeURIComponent(preferenceKey)}`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) throw await toResponseError(response, 'User preference lookup failed', url)
  const payload = await response.json()
  return payload?.value ?? null
}

export async function saveUserPreference(baseUrl, preferenceKey, value) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/user/preferences/${encodeURIComponent(preferenceKey)}`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!response.ok) throw await toResponseError(response, 'User preference save failed', url)
  return response.json()
}

export async function fetchTelemetryFieldInventory(baseUrl, traccarDeviceId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/telemetry-field-inventory/${encodeURIComponent(traccarDeviceId)}`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Telemetry field inventory lookup failed', url)
  return normalizeTelemetryFieldInventory(await response.json(), traccarDeviceId)
}

export async function retryTelemetryFieldInventoryScan(baseUrl, traccarDeviceId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/telemetry-field-inventory/${encodeURIComponent(traccarDeviceId)}/retry`
  const response = await vehicleFetch(url, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Telemetry field inventory retry failed', url)
  return normalizeTelemetryFieldInventory(await response.json(), traccarDeviceId)
}

function normalizeTelemetryFieldInventory(payload, traccarDeviceId) {
  return {
    traccarDeviceId: Number(payload?.traccarDeviceId) || Number(traccarDeviceId),
    status: String(payload?.status || 'notStarted'),
    generatedAt: payload?.generatedAt || null,
    scanStartUtc: payload?.scanStartUtc || null,
    scanEndUtc: payload?.scanEndUtc || null,
    scannedThroughUtc: payload?.scannedThroughUtc || null,
    progressPercent: typeof payload?.progressPercent === 'number' && Number.isFinite(payload.progressPercent) ? payload.progressPercent : null,
    error: payload?.error || null,
    fields: Array.isArray(payload?.fields) ? payload.fields.map((field) => ({
      key: String(field?.key || ''),
      positionCount: Number(field?.positionCount) || 0,
      firstSeenAt: field?.firstSeenAt || null,
      lastSeenAt: field?.lastSeenAt || null,
      valueTypes: Array.isArray(field?.valueTypes) ? field.valueTypes : [],
    })).filter((field) => field.key) : [],
  }
}
export async function fetchEmailAlertPreferences(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/email-alerts/preferences`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Email alert preferences failed', url)
  return response.json()
}

export async function fetchEmailProviderStatus(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/email/status`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Email provider status failed', url)
  return response.json()
}

export async function fetchProviderAccounts(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/provider-accounts`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Provider accounts failed', url)
  return response.json()
}

export async function saveProviderAccount(baseUrl, account, accountId = null) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/provider-accounts${accountId ? `/${encodeURIComponent(accountId)}` : ''}`
  const response = await vehicleFetch(url, {
    method: accountId ? 'PUT' : 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  })
  if (!response.ok) throw await toResponseError(response, 'Saving provider account failed', url)
  return response.json()
}

export async function importLegacyProviderAccount(baseUrl, channel) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/provider-accounts/import-legacy/${encodeURIComponent(channel)}`
  const response = await vehicleFetch(url, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Importing legacy provider configuration failed', url)
  return response.json()
}

export async function checkEmailProviderAccount(baseUrl, accountId) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/email/provider-accounts/${encodeURIComponent(accountId)}/check`
  const response = await vehicleFetch(url, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Checking email provider account failed', url)
  return response.json()
}

export async function fetchVehicleEmailProviderAssignments(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/provider-accounts/vehicle-assignments/email`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Loading vehicle email provider assignments failed', url)
  return response.json()
}

export async function saveVehicleEmailProviderAssignment(baseUrl, vehicleId, accountId) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/provider-accounts/vehicles/${encodeURIComponent(vehicleId)}/email`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: accountId || null }),
  })
  if (!response.ok) throw await toResponseError(response, 'Saving vehicle email provider assignment failed', url)
  return response.json()
}

export async function fetchVehicleSmsProviderAssignments(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/provider-accounts/vehicle-assignments/sms`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Loading vehicle SMS provider assignments failed', url)
  return response.json()
}

export async function saveVehicleSmsProviderAssignment(baseUrl, vehicleId, accountId) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/provider-accounts/vehicles/${encodeURIComponent(vehicleId)}/sms`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: accountId || null }),
  })
  if (!response.ok) throw await toResponseError(response, 'Saving vehicle SMS provider assignment failed', url)
  return response.json()
}

export async function fetchEmailSenderSettings(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/email/settings`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Email sender settings failed', url)
  return response.json()
}

export async function saveEmailSenderSettings(baseUrl, senderUserId) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/email/settings`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderUserId }),
  })
  if (!response.ok) throw await toResponseError(response, 'Saving email sender settings failed', url)
  return response.json()
}

export async function fetchVehicleEmailSender(baseUrl, vehicleId) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/email/vehicles/${encodeURIComponent(vehicleId)}/sender`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle email sender settings failed', url)
  return response.json()
}

export async function saveVehicleEmailSender(baseUrl, vehicleId, senderUserId) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/email/vehicles/${encodeURIComponent(vehicleId)}/sender`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderUserId }),
  })
  if (!response.ok) throw await toResponseError(response, 'Saving vehicle email sender failed', url)
  return response.json()
}

export async function sendEmailTest(baseUrl, to) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/email/test-send`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, confirmSend: true }),
  })
  if (!response.ok) throw await toResponseError(response, 'Email test send failed', url)
  return response.json()
}

export async function saveEmailAlertPreferences(baseUrl, preferences) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/email-alerts/preferences`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  })
  if (!response.ok) throw await toResponseError(response, 'Saving email alert preferences failed', url)
  return response.json()
}

export async function requestEmailAlertVerification(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/email-alerts/request-verification`
  const response = await vehicleFetch(url, { method: 'POST' })
  if (!response.ok) throw await toResponseError(response, 'Email verification request failed', url)
  return response.json()
}

export async function verifyEmailAlertCode(baseUrl, code) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/email-alerts/verify`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) throw await toResponseError(response, 'Email verification failed', url)
  return response.json()
}

export async function fetchEmailAlertHistory(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/email-alerts/history`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Email alert history failed', url)
  return response.json()
}

export async function retryUncertainEmailAlert(baseUrl, outboxId) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/email/history/${encodeURIComponent(outboxId)}/retry-uncertain`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmSentItemsChecked: true }),
  })
  if (!response.ok) throw await toResponseError(response, 'Email retry request failed', url)
  return response.json()
}

export async function fetchSmsProviderStatus(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/sms/status`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'SMS provider status failed', url)
  return response.json()
}

export async function checkTwilioProviderAccount(baseUrl, accountId) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/sms/accounts/${encodeURIComponent(accountId)}/check-connection`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Checking Twilio account failed', url)
  return response.json()
}

export async function fetchSmsAlertPreferences(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/sms-alerts/preferences`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'SMS alert preferences failed', url)
  return response.json()
}

export async function saveSmsAlertPreferences(baseUrl, preferences) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/sms-alerts/preferences`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  })
  if (!response.ok) throw await toResponseError(response, 'Saving SMS alert preferences failed', url)
  return response.json()
}

export async function requestSmsAlertVerification(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/sms-alerts/request-verification`
  const response = await vehicleFetch(url, { method: 'POST' })
  if (!response.ok) throw await toResponseError(response, 'SMS verification request failed', url)
  return response.json()
}

export async function verifySmsAlertCode(baseUrl, code) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/sms-alerts/verify`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) throw await toResponseError(response, 'SMS verification failed', url)
  return response.json()
}

export async function fetchSmsAlertHistory(baseUrl) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/user/sms-alerts/history`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'SMS alert history failed', url)
  return response.json()
}

export async function sendSmsTest(baseUrl, to, recipientConsentConfirmed) {
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/admin/sms/test-send`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, confirmSend: true, recipientConsentConfirmed }),
  })
  if (!response.ok) throw await toResponseError(response, 'SMS test send failed', url)
  return response.json()
}

export async function fetchVehicleCatalog(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/vehicles`
  const response = await vehicleFetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/vehicles', url)
  }

  const payload = await response.json()
  if (!Array.isArray(payload)) {
    return []
  }

  return payload
}

export async function upsertVehicle(baseUrl, vehicle) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/vehicles/upsert`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(vehicle),
  })
  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/vehicles/upsert', url)
  }
  return response.json()
}

export async function fetchTelemetryProfileSubmissionStatus(baseUrl) {
  const url = normalizeVehicleApiBase(baseUrl) + '/api/telemetry-profile-submissions/status'
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Telemetry profile submission status failed', url)
  return response.json()
}

export async function submitTelemetryProfileProposal(baseUrl, submission) {
  const url = normalizeVehicleApiBase(baseUrl) + '/api/telemetry-profile-submissions'
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(submission),
  })
  if (!response.ok) throw await toResponseError(response, 'Sending telemetry profile suggestion failed', url)
  return response.json()
}

export async function downloadTelemetryProfileProposalArchive(baseUrl, submission) {
  const url = normalizeVehicleApiBase(baseUrl) + '/api/telemetry-profile-submissions/archive'
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/zip', 'Content-Type': 'application/json' },
    body: JSON.stringify(submission),
  })
  if (!response.ok) throw await toResponseError(response, 'Preparing telemetry profile ZIP failed', url)
  const disposition = response.headers.get('Content-Disposition') || ''
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const quotedName = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  let fileName = encodedName || quotedName || 'telemetry-profile-submission.zip'
  try { fileName = decodeURIComponent(fileName) } catch { /* Keep the provider filename if it is not URI encoded. */ }
  return { blob: await response.blob(), fileName }
}

export async function fetchTelemetryProfiles(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/telemetry-profiles`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API call failed for /api/telemetry-profiles', url)
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function fetchTelemetryProfileHistory(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/telemetry-profiles/history`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API profile history load failed', url)
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function fetchTelemetrySourceMappings(baseUrl, deviceId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const id = encodeURIComponent(deviceId)
  const url = `${base}/api/telemetry-source-mappings/${id}`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Tracker mapping history load failed', url)
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function saveTelemetrySourceMapping(baseUrl, deviceId, fieldKey, mapping, expectedRevision, changeKind = 'manual') {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/telemetry-source-mappings/${encodeURIComponent(deviceId)}/${encodeURIComponent(fieldKey)}`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision, mapping, changeKind }),
  })
  if (!response.ok) throw await toResponseError(response, 'Tracker mapping save failed', url)
  return response.json()
}

export async function upsertTelemetryProfile(baseUrl, profile, expectedRevision, changeKind = 'manual') {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('A current shared profile revision is required before saving.')
  }
  const base = normalizeVehicleApiBase(baseUrl)
  const key = encodeURIComponent(profile.id)
  const url = `${base}/api/telemetry-profiles/${key}`
  const response = await vehicleFetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'If-Match': `"${expectedRevision}"` },
    body: JSON.stringify({ ...profile, changeKind }),
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API profile save failed', url)
  return response.json()
}

export async function fetchTelemetryProfileRevisions(baseUrl, profileId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const key = encodeURIComponent(profileId)
  const url = `${base}/api/telemetry-profiles/${key}/revisions`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API profile history lookup failed', url)
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function deleteTelemetryProfile(baseUrl, profileId, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('A current shared profile revision is required before deleting.')
  }
  const base = normalizeVehicleApiBase(baseUrl)
  const key = encodeURIComponent(profileId)
  const url = `${base}/api/telemetry-profiles/${key}`
  const response = await vehicleFetch(url, { method: 'DELETE', headers: { Accept: 'application/json', 'If-Match': `"${expectedRevision}"` } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API profile delete failed', url)
}

export async function fetchVehicleSpeedBands(baseUrl, vehicleId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/vehicles/${vehicleId}/speed-bands`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) throw await toResponseError(response, 'Vehicle API call failed for vehicle speed bands', url)
  return response.json()
}

export async function saveVehicleSpeedBands(baseUrl, vehicleId, bands, inheritedFromVehicleId = null) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/vehicles/${vehicleId}/speed-bands`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ bands, inheritedFromVehicleId }),
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API call failed saving vehicle speed bands', url)
  return response.json()
}

export async function fetchStatusCardFields(baseUrl, vehicleId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/vehicles/${vehicleId}/status-card`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) throw await toResponseError(response, 'Vehicle API call failed for status card fields', url)
  return response.json()
}

export async function saveStatusCardFields(baseUrl, vehicleId, fields, popupFields = []) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/vehicles/${vehicleId}/status-card`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, popupFields }),
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API call failed saving status card fields', url)
  return response.json()
}

export async function importTripsByDevice(baseUrl, request) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/import-by-device`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trips/import-by-device', url)
  }

  return response.json()
}

export async function importBouncieTrips(baseUrl, rows) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/import-bouncie`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API call failed for /api/trips/import-bouncie', url)
  return response.json()
}

export async function fetchBouncieStatus(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/integrations/bouncie/status`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API call failed for Bouncie status', url)
  return response.json()
}

export async function connectBouncie(baseUrl, request) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/integrations/bouncie/connect`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API Bouncie connection failed', url)
  return response.json()
}

export async function beginBouncieAuthorization(baseUrl, request) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/integrations/bouncie/authorize`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API Bouncie authorization could not start', url)
  return response.json()
}

export async function beginStoredBouncieAuthorization(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/integrations/bouncie/reauthorize`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API Bouncie reauthorization could not start', url)
  return response.json()
}

export async function startBouncieImport(baseUrl, { from, through }) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/integrations/bouncie/import`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: new Date(from).toISOString(), through: new Date(through).toISOString() }),
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API Bouncie import failed to start', url)
  return response.json()
}

export async function fetchBouncieBackfillCoverage(baseUrl, { from, through } = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (through) params.set('through', new Date(through).toISOString())
  const url = `${base}/api/integrations/bouncie/backfill-coverage${params.toString() ? `?${params}` : ''}`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API Bouncie backfill coverage failed', url)
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function cancelBouncieImport(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/integrations/bouncie/import-cancel`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API Bouncie import cancellation failed', url)
  return response.json()
}

export async function continueBouncieImport(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/integrations/bouncie/import-continue`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API Bouncie import could not continue', url)
  return response.json()
}

export async function restoreBouncieConnection(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/integrations/bouncie/restore`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API Bouncie connection restore failed', url)
  return response.json()
}

export async function forgetBouncieCredentials(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/integrations/bouncie/forget`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API Bouncie credential removal failed', url)
  return response.json()
}

// Resolve a persisted identity, never a nearby trip or the device's current vehicle.
export async function resolveTrip(baseUrl, trip) {
  const params = new URLSearchParams({
    traccarDeviceId: String(trip.deviceId),
    startedAt: trip.start.toISOString(),
    endedAt: trip.end.toISOString(),
  })
  for (const key of ['startTraccarPositionId', 'endTraccarPositionId']) {
    if (trip[key] != null) params.set(key, String(trip[key]))
  }
  const url = `${normalizeVehicleApiBase(baseUrl)}/api/trips/resolve?${params}`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Could not identify saved trip', url)
  return response.json()
}

export async function fetchTrips(baseUrl, { vehicleId, from, to, limit = 500 } = {}) {
  if (!vehicleId) {
    return []
  }

  const base = normalizeVehicleApiBase(baseUrl)
  const params = new URLSearchParams({
    vehicleId: String(vehicleId),
    limit: String(limit),
  })

  if (from) {
    params.set('from', new Date(from).toISOString())
  }

  if (to) {
    params.set('to', new Date(to).toISOString())
  }

  const url = `${base}/api/trips?${params.toString()}`
  const response = await vehicleFetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trips', url)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function fetchTripDaySummaries(baseUrl, { from, to } = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  // Date inputs represent calendar days. Treat the end date as inclusive so
  // a From/Through range of Sep 25 through Sep 26 includes both days.
  if (to) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to
    params.set('to', new Date(end).toISOString())
  }
  const url = `${base}/api/trips/day-summaries-all${params.toString() ? `?${params}` : ''}`
  let response
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
    if (response.ok) break
    const transient = response.status === 502 || response.status === 503 || response.status === 504
    if (!transient || attempt === 2) {
      throw await toResponseError(response, 'Vehicle API call failed for /api/trips/day-summaries-all', url)
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
  }
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function fetchTripHistorySpan(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/history-span`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trips/history-span', url)
  }
  const payload = await response.json()
  return {
    earliestStartedAt: payload?.earliestStartedAt || null,
    latestEndedAt: payload?.latestEndedAt || null,
    tripCount: Number(payload?.tripCount) || 0,
  }
}

export async function fetchTripHistoryMonthSummaries(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/history-month-summaries`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trips/history-month-summaries', url)
  }
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function fetchActiveDeviceBindings(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/device-bindings`
  const response = await vehicleFetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/device-bindings', url)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function fetchDeviceBindingHistory(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/device-bindings/history`
  const response = await vehicleFetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/device-bindings/history', url)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function fetchVehicleProfileAssignmentHistory(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/vehicle-profile-assignments/history`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/vehicle-profile-assignments/history', url)
  }
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function fetchNearestDeviceBinding(baseUrl, { traccarDeviceId, startedAt, endedAt }) {
  const base = normalizeVehicleApiBase(baseUrl)
  const query = new URLSearchParams({
    traccarDeviceId: String(traccarDeviceId),
    startedAt,
    endedAt,
  })
  const url = `${base}/api/device-bindings/nearest?${query}`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/device-bindings/nearest', url)
  }
  return response.json()
}

export async function repairMissingDeviceBinding(baseUrl, request) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/device-bindings/repair-missing`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/device-bindings/repair-missing', url)
  }
  return response.json()
}

export async function upsertDeviceBinding(baseUrl, request) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/device-bindings/upsert`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/device-bindings/upsert', url)
  }

  return response.json()
}

export async function deleteDeviceBinding(baseUrl, bindingId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/device-bindings/${encodeURIComponent(bindingId)}`
  const response = await vehicleFetch(url, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/device-bindings/{bindingId}', url)
  }
}

export async function fetchNamedPlaces(baseUrl, vehicleId = null) {
  const base = normalizeVehicleApiBase(baseUrl)
  const query = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : ''
  const url = `${base}/api/named-places${query}`
  const response = await vehicleFetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/named-places', url)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function upsertNamedPlace(baseUrl, request) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/named-places/upsert`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/named-places/upsert', url)
  }

  return response.json()
}

export async function deleteNamedPlace(baseUrl, placeId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/named-places/${encodeURIComponent(placeId)}`
  const response = await vehicleFetch(url, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok && response.status !== 404) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/named-places/{placeId}', url)
  }
}

export async function fetchTripTags(baseUrl, vehicleId = null) {
  const base = normalizeVehicleApiBase(baseUrl)
  const query = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : ''
  const url = `${base}/api/trip-tags${query}`
  const response = await vehicleFetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trip-tags', url)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function upsertTripTag(baseUrl, request) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trip-tags/upsert`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trip-tags/upsert', url)
  }

  return response.json()
}

export async function deleteTripTag(baseUrl, tagId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trip-tags/${encodeURIComponent(tagId)}`
  const response = await vehicleFetch(url, { method: 'DELETE', headers: { Accept: 'application/json' } })
  if (!response.ok && response.status !== 404) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trip-tags/{tagId}', url)
  }
}

export async function fetchTripTagsForTrip(baseUrl, tripId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/${encodeURIComponent(tripId)}/tags`
  const response = await vehicleFetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trips/{tripId}/tags', url)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function addTagToTrip(baseUrl, tripId, tagId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/${encodeURIComponent(tripId)}/tags/${encodeURIComponent(tagId)}`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trips/{tripId}/tags/{tagId}', url)
  }
}

export async function removeTagFromTrip(baseUrl, tripId, tagId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/${encodeURIComponent(tripId)}/tags/${encodeURIComponent(tagId)}`
  const response = await vehicleFetch(url, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok && response.status !== 404) {
    throw await toResponseError(response, 'Vehicle API call failed for delete /api/trips/{tripId}/tags/{tagId}', url)
  }
}

export async function updateTripNotes(baseUrl, tripId, notes) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/${encodeURIComponent(tripId)}/notes`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ notes }),
  })

  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trips/{tripId}/notes', url)
  }

  return response.json()
}

export async function recalculateTrip(baseUrl, tripId, request) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/${encodeURIComponent(tripId)}/recalculate`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw await toResponseError(response, 'Vehicle API call failed for /api/trips/{tripId}/recalculate', url)
  }
  return response.json()
}

export async function fetchOperationsReport(baseUrl, report) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/reports/${encodeURIComponent(report)}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API report failed', url)
  return response.json()
}

export async function saveTripEvents(baseUrl, tripId, events) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/${encodeURIComponent(tripId)}/events`
  const response = await vehicleFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API event import failed', url)
  return response.json()
}

export async function deleteCalculatedTripEvents(baseUrl, tripId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/${encodeURIComponent(tripId)}/events`
  const response = await vehicleFetch(url, { method: 'DELETE', headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API event cleanup failed', url)
  return response.json()
}

export async function fetchTripEvents(baseUrl, tripId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/${encodeURIComponent(tripId)}/events`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API event lookup failed', url)
  return response.json()
}

export async function fetchTripRoutePoints(baseUrl, tripId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/trips/${encodeURIComponent(tripId)}/route-points`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API call failed for trip route points', url)
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export async function fetchTripEventNotifications(baseUrl, { from, to, vehicleId } = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) params.set('to', new Date(to).toISOString())
  if (vehicleId) params.set('vehicleId', vehicleId)
  const query = params.toString()
  const url = `${base}/api/trip-events/notifications${query ? `?${query}` : ''}`
  const response = await vehicleFetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API notification lookup failed', url)
  return response.json()
}

export async function saveEventThreshold(baseUrl, threshold) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/event-thresholds`
  const response = await vehicleFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(threshold) })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API threshold update failed', url)
  return response.json()
}

export async function fetchEventThresholds(baseUrl, vehicleId = null) {
  const base = normalizeVehicleApiBase(baseUrl)
  const params = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : ''
  const url = `${base}/api/event-thresholds${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API threshold lookup failed', url)
  return response.json()
}

export async function fetchVehicleStats(baseUrl, vehicleId, { from, to, groupBy = 'trip', tagId } = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const params = new URLSearchParams({ groupBy })
  if (from) params.set('from', new Date(from).toISOString())
  if (to) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to
    params.set('to', new Date(end).toISOString())
  }
  if (tagId) params.set('tagId', tagId)
  const url = `${base}/api/vehicles/${encodeURIComponent(vehicleId)}/stats?${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API statistics lookup failed', url)
  return response.json()
}

export async function fetchUsageSummaryReport(baseUrl, { from, to, groupBy = 'trip', vehicleId, tagId, format, timeZone, units = 'imperial' } = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const params = new URLSearchParams({ groupBy })
  if (from) params.set('from', new Date(from).toISOString())
  if (to) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to
    params.set('to', new Date(end).toISOString())
  }
  if (vehicleId) params.set('vehicleId', vehicleId)
  if (tagId) params.set('tagId', tagId)
  if (format) params.set('format', format)
  if (timeZone) params.set('timeZone', timeZone)
  if (units) params.set('units', units)
  const url = `${base}/api/reports/usage-summary?${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API usage report failed', url)
  return format === 'csv' ? response.blob() : response.json()
}

export async function fetchTripLogReport(baseUrl, options = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const { from, to, vehicleId, tagId, format, timeZone, units = 'imperial' } = options
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to
    params.set('to', new Date(end).toISOString())
  }
  if (vehicleId) params.set('vehicleId', vehicleId)
  if (tagId) params.set('tagId', tagId)
  if (format) params.set('format', format)
  if (timeZone) params.set('timeZone', timeZone)
  if (units) params.set('units', units)
  const url = `${base}/api/reports/trip-log?${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API trip log failed', url)
  return format === 'csv' ? response.blob() : response.json()
}

export async function fetchMonthlySummaryReport(baseUrl, options = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const { from, to, vehicleId, tagId, format, timeZone, units = 'imperial' } = options
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to
    params.set('to', new Date(end).toISOString())
  }
  if (vehicleId) params.set('vehicleId', vehicleId)
  if (tagId) params.set('tagId', tagId)
  if (format) params.set('format', format)
  if (timeZone) params.set('timeZone', timeZone)
  if (units) params.set('units', units)
  const url = `${base}/api/reports/monthly-summary?${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API monthly summary failed', url)
  return format === 'csv' ? response.blob() : response.json()
}

export async function fetchPlaceReport(baseUrl, options = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const { from, to, vehicleId, tagId, format, units = 'imperial' } = options
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to
    params.set('to', new Date(end).toISOString())
  }
  if (vehicleId) params.set('vehicleId', vehicleId)
  if (tagId) params.set('tagId', tagId)
  if (format) params.set('format', format)
  if (units) params.set('units', units)
  const url = `${base}/api/reports/places?${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API place report failed', url)
  return format === 'csv' ? response.blob() : response.json()
}

export async function fetchDataCompletenessReport(baseUrl, options = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const { from, to, vehicleId, tagId, format } = options
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to
    params.set('to', new Date(end).toISOString())
  }
  if (vehicleId) params.set('vehicleId', vehicleId)
  if (tagId) params.set('tagId', tagId)
  if (format) params.set('format', format)
  const url = `${base}/api/reports/data-completeness?${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API data completeness report failed', url)
  return format === 'csv' ? response.blob() : response.json()
}

export async function fetchEventReport(baseUrl, options = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const { from, to, vehicleId, tagId, format } = options
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) { const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to; params.set('to', new Date(end).toISOString()) }
  if (vehicleId) params.set('vehicleId', vehicleId)
  if (tagId) params.set('tagId', tagId)
  if (format) params.set('format', format)
  const url = `${base}/api/reports/events?${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API events report failed', url)
  return format === 'csv' ? response.blob() : response.json()
}

export async function fetchUtilizationReport(baseUrl, options = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const { from, to, vehicleId, tagId, format, timeZone, groupBy = 'day', units = 'imperial' } = options
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) { const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to; params.set('to', new Date(end).toISOString()) }
  if (vehicleId) params.set('vehicleId', vehicleId)
  if (tagId) params.set('tagId', tagId)
  if (format) params.set('format', format)
  if (timeZone) params.set('timeZone', timeZone)
  if (groupBy) params.set('groupBy', groupBy)
  if (units) params.set('units', units)
  const url = `${base}/api/reports/utilization?${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API utilization report failed', url)
  return format === 'csv' ? response.blob() : response.json()
}

export async function fetchBusinessMileageReport(baseUrl, options = {}) {
  const base = normalizeVehicleApiBase(baseUrl)
  const { from, to, vehicleId, tagId, format, units = 'imperial' } = options
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) { const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to; params.set('to', new Date(end).toISOString()) }
  if (vehicleId) params.set('vehicleId', vehicleId)
  if (tagId) params.set('tagId', tagId)
  if (format) params.set('format', format)
  if (units) params.set('units', units)
  const url = `${base}/api/reports/business-mileage?${params}`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API business mileage report failed', url)
  return format === 'csv' ? response.blob() : response.json()
}

export async function fetchSpeedBandReport(baseUrl, { from, to, vehicleId, tagId } = {}) {
  const base = normalizeVehicleApiBase(baseUrl); const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) { const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to; params.set('to', new Date(end).toISOString()) }
  if (vehicleId) params.set('vehicleId', vehicleId); if (tagId) params.set('tagId', tagId)
  const url = `${base}/api/reports/speed-bands?${params}`; const response = await vehicleFetch(url, { cache: 'no-store' })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API speed bands report failed', url)
  return response.json()
}

export async function fetchAdminUsers(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/users`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API user lookup failed', url)
  return response.json()
}

export async function createAdminUser(baseUrl, user) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/users`
  const response = await vehicleFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API user creation failed', url)
  return response.json()
}

export async function updateAdminUser(baseUrl, userId, user) {
  const base = normalizeVehicleApiBase(baseUrl); const url = `${base}/api/admin/users/${encodeURIComponent(userId)}`
  const response = await vehicleFetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API user update failed', url)
}

export async function fetchAdminGroups(baseUrl) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/groups`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API group lookup failed', url)
  return response.json()
}

export async function createAdminGroup(baseUrl, group) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/groups`
  const response = await vehicleFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(group) })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API group creation failed', url)
  return response.json()
}

export async function deleteAdminUser(baseUrl, userId) {
  const base = normalizeVehicleApiBase(baseUrl); const url = `${base}/api/admin/users/${encodeURIComponent(userId)}`; const response = await vehicleFetch(url, { method: 'DELETE' }); if (!response.ok) throw await toResponseError(response, 'Vehicle API user deletion failed', url)
}
export async function deleteAdminGroup(baseUrl, groupId) {
  const base = normalizeVehicleApiBase(baseUrl); const url = `${base}/api/admin/groups/${encodeURIComponent(groupId)}`; const response = await vehicleFetch(url, { method: 'DELETE' }); if (!response.ok) throw await toResponseError(response, 'Vehicle API group deletion failed', url)
}

export async function setAdminGroupMembership(baseUrl, groupId, userId, enabled) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}`
  const response = await vehicleFetch(url, { method: enabled ? 'PUT' : 'DELETE' })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API group membership update failed', url)
}
export async function fetchAdminGroupUsers(baseUrl, groupId) { const base = normalizeVehicleApiBase(baseUrl); const url = `${base}/api/admin/groups/${encodeURIComponent(groupId)}/users`; const response = await vehicleFetch(url); if (!response.ok) throw await toResponseError(response, 'Vehicle API group members lookup failed', url); return response.json() }
export async function fetchAdminUserGroups(baseUrl, userId) { const base = normalizeVehicleApiBase(baseUrl); const url = `${base}/api/admin/users/${encodeURIComponent(userId)}/groups`; const response = await vehicleFetch(url); if (!response.ok) throw await toResponseError(response, 'Vehicle API user groups lookup failed', url); return response.json() }

export async function setAdminUserVehicleAccess(baseUrl, userId, vehicleId, enabled) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/users/${encodeURIComponent(userId)}/vehicles/${encodeURIComponent(vehicleId)}`
  const response = await vehicleFetch(url, { method: enabled ? 'PUT' : 'DELETE' })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API user vehicle access update failed', url)
}

export async function fetchAdminUserVehicles(baseUrl, userId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/users/${encodeURIComponent(userId)}/vehicles`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API user access lookup failed', url)
  return response.json()
}

export async function setAdminGroupVehicleAccess(baseUrl, groupId, vehicleId, enabled) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/groups/${encodeURIComponent(groupId)}/vehicles/${encodeURIComponent(vehicleId)}`
  const response = await vehicleFetch(url, { method: enabled ? 'PUT' : 'DELETE' })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API group vehicle access update failed', url)
}

export async function fetchAdminGroupVehicles(baseUrl, groupId) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/groups/${encodeURIComponent(groupId)}/vehicles`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API group access lookup failed', url)
  return response.json()
}

export async function setAdminUserAutoAccess(baseUrl, userId, enabled) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/users/${encodeURIComponent(userId)}/auto-access`
  const response = await vehicleFetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API user auto-access update failed', url)
}

export async function setAdminGroupAutoAccess(baseUrl, groupId, enabled) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/groups/${encodeURIComponent(groupId)}/auto-access`
  const response = await vehicleFetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
  if (!response.ok) throw await toResponseError(response, 'Vehicle API group auto-access update failed', url)
}

async function setAdminDeviceAccess(baseUrl, kind, id, deviceId, enabled) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/${kind}/${encodeURIComponent(id)}/devices/${encodeURIComponent(deviceId)}`
  const response = await vehicleFetch(url, { method: enabled ? 'PUT' : 'DELETE' })
  if (!response.ok) throw await toResponseError(response, `Vehicle API ${kind} device access update failed`, url)
}

export const setAdminUserDeviceAccess = (baseUrl, userId, deviceId, enabled) => setAdminDeviceAccess(baseUrl, 'users', userId, deviceId, enabled)
export const setAdminGroupDeviceAccess = (baseUrl, groupId, deviceId, enabled) => setAdminDeviceAccess(baseUrl, 'groups', groupId, deviceId, enabled)

async function fetchAdminDeviceAccess(baseUrl, kind, id) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/admin/${kind}/${encodeURIComponent(id)}/devices`
  const response = await vehicleFetch(url)
  if (!response.ok) throw await toResponseError(response, 'Vehicle API device access lookup failed', url)
  return response.json()
}
export const fetchAdminUserDevices = (baseUrl, userId) => fetchAdminDeviceAccess(baseUrl, 'users', userId)
export const fetchAdminGroupDevices = (baseUrl, groupId) => fetchAdminDeviceAccess(baseUrl, 'groups', groupId)

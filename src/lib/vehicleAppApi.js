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

export async function saveStatusCardFields(baseUrl, vehicleId, fields) {
  const base = normalizeVehicleApiBase(baseUrl)
  const url = `${base}/api/vehicles/${vehicleId}/status-card`
  const response = await vehicleFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
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

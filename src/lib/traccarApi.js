export async function toResponseError(response, context) {
  const body = await response.text()
  const snippet = body ? ' - ' + body.slice(0, 240) : ''
  return new Error(context + ': HTTP ' + response.status + ' ' + response.statusText + snippet)
}

function vehicleApiBase(settings) {
  let base = String(settings.vehicleApiBaseUrl || '/vehicle-api').trim().replace(/\/+$/, '')
  if (!base) base = '/vehicle-api'
  if (/\/api$/i.test(base) && !/\/vehicle-api$/i.test(base)) base = base.slice(0, -4)
  return base + '/api/traccar'
}

export function createTraccarApi({ settings, onSessionStateChange }) {
  return async function apiFetch(path, options = {}) {
    const base = vehicleApiBase(settings)
    const headers = { ...(options.headers || {}) }
    if (!headers['Content-Type'] && options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(base + path, {
      ...options,
      headers,
      credentials: 'include',
    })

    if (response.status === 401) onSessionStateChange('failed')
    else if (response.ok) onSessionStateChange('ok')

    if (!response.ok) throw await toResponseError(response, 'API call failed for ' + path)
    if (response.status === 204) return null
    return response.json()
  }
}

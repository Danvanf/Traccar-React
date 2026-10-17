export async function toResponseError(response, context) {
  const body = await response.text()
  const snippet = body ? ' - ' + body.slice(0, 240) : ''
  return new Error(context + ': HTTP ' + response.status + ' ' + response.statusText + snippet)
}

function traccarReactApiBase(settings) {
  let base = String(settings.traccarReactApiBaseUrl || '/traccar-react-api').trim().replace(/\/+$/, '')
  if (!base) base = '/traccar-react-api'
  if (/\/api$/i.test(base) && !/\/traccar-react-api$/i.test(base)) base = base.slice(0, -4)
  return base + '/api/traccar'
}

export function createTraccarApi({ settings, onSessionStateChange }) {
  return async function apiFetch(path, options = {}) {
    const base = traccarReactApiBase(settings)
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

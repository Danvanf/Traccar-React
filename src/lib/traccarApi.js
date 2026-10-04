export async function toResponseError(response, context) {
  const body = await response.text()
  const snippet = body ? ` - ${body.slice(0, 240)}` : ''
  return new Error(`${context}: HTTP ${response.status} ${response.statusText}${snippet}`)
}

export function createTraccarApi({ settings, onSessionStateChange, sessionAttemptedRef }) {
  return async function apiFetch(path, options = {}) {
    const base = settings.apiBaseUrl.replace(/\/+$/, '')
    const headers = {
      ...(options.headers || {}),
    }

    if (!headers['Content-Type'] && options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    if (settings.username && settings.password) {
      headers.Authorization = `Basic ${btoa(`${settings.username}:${settings.password}`)}`
    }

    const requestInit = {
      ...options,
      headers,
      credentials: 'include',
    }

    let response = await fetch(`${base}${path}`, requestInit)

    if (response.status === 401 && settings.username && settings.password && !sessionAttemptedRef.current) {
      sessionAttemptedRef.current = true

      const loginBody = new URLSearchParams({
        email: settings.username,
        password: settings.password,
      }).toString()

      const loginResponse = await fetch(`${base}/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: loginBody,
        credentials: 'include',
      })

      if (loginResponse.ok) {
        onSessionStateChange('ok')
        response = await fetch(`${base}${path}`, requestInit)
      } else {
        onSessionStateChange('failed')
      }
    }

    if (!response.ok) {
      throw await toResponseError(response, `API call failed for ${path}`)
    }

    if (settings.username && settings.password) {
      onSessionStateChange('ok')
    }

    if (response.status === 204) {
      return null
    }

    return response.json()
  }
}

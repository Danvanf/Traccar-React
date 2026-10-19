// One-time migration for the current browser's saved Traccar React settings.
// Run in that app origin's DevTools console before using the renamed app.
// It preserves all settings, including credentials, and does not print them.
(() => {
  const oldKey = 'traccarReactSettings'
  const newKey = 'traccarScopeSettings'
  const oldRaw = localStorage.getItem(oldKey)

  if (!oldRaw) {
    console.info('No old Traccar React settings were found; nothing to migrate.')
    return
  }

  const oldSettings = JSON.parse(oldRaw)
  const currentSettings = localStorage.getItem(newKey)
  const settings = currentSettings ? JSON.parse(currentSettings) : oldSettings
  const oldApiBase = settings.traccarReactApiBaseUrl ?? oldSettings.traccarReactApiBaseUrl
  delete settings.traccarReactApiBaseUrl
  delete settings.vehicleApiBaseUrl

  if (!settings.traccarScopeApiBaseUrl && oldApiBase) {
    settings.traccarScopeApiBaseUrl = oldApiBase
  }
  settings.traccarScopeApiBaseUrl = String(
    settings.traccarScopeApiBaseUrl || '/traccar-scope-api',
  ).replace(/\/(traccar-react-api|vehicle-api)\/?$/i, '/traccar-scope-api')

  localStorage.setItem(newKey, JSON.stringify(settings))
  localStorage.removeItem(oldKey)
  console.info('Saved settings moved to Traccar Scope. Reload the page.')
})()

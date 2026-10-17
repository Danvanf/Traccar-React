export const SETTINGS_KEY = 'traccarReactSettings'

export const DEFAULT_SETTINGS = {
  apiBaseUrl: '/api',
  traccarReactApiBaseUrl: '/traccar-react-api',
  useBackendVehicleCatalog: false,
  username: '',
  password: '',
  pollIntervalMs: 5000,
  realtimeHours: 3,
  movementThresholdM: 20,
  displayUnits: 'imperial',
  theme: 'auto',
}

export const PALETTE = [
  '#2A9D8F',
  '#E63946',
  '#F77F00',
  '#4CC9F0',
  '#06D6A0',
  '#FF006E',
  '#118AB2',
  '#F4A261',
  '#8D99AE',
  '#457B9D',
]

export function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }

    const saved = JSON.parse(raw)
    // Migrate the old property without losing a custom API host.
    const legacyBase = saved.vehicleApiBaseUrl
    delete saved.vehicleApiBaseUrl
    const traccarReactApiBaseUrl = saved.traccarReactApiBaseUrl ?? legacyBase ?? DEFAULT_SETTINGS.traccarReactApiBaseUrl
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      traccarReactApiBaseUrl: String(traccarReactApiBaseUrl).replace(/\/vehicle-api\/?$/i, '/traccar-react-api'),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

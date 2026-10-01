export const SETTINGS_KEY = 'traccarReactSettings'

export const DEFAULT_SETTINGS = {
  apiBaseUrl: '/api',
  vehicleApiBaseUrl: '/vehicle-api',
  useBackendVehicleCatalog: false,
  username: '',
  password: '',
  pollIntervalMs: 5000,
  realtimeHours: 3,
  movementThresholdM: 20,
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

    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(raw),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

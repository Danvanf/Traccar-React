export const DEFAULT_SPEED_BANDS = [
  { upperMph: 20, color: '#2a9d8f', label: '0–20 mph' },
  { upperMph: 40, color: '#78c346', label: '20–40 mph' },
  { upperMph: 60, color: '#7c3aed', label: '40–60 mph' },
  { upperMph: 80, color: '#f4a261', label: '60–80 mph' },
  { upperMph: null, color: '#000000', label: '80+ mph' },
]

export function speedBandFor(speedMph, bands = DEFAULT_SPEED_BANDS) {
  const speed = Number(speedMph)
  return bands.find((band) => band.upperMph == null || speed < band.upperMph) || bands.at(-1)
}

export function getSpeedBandsForVehicle(vehicleId) {
  if (!vehicleId) return DEFAULT_SPEED_BANDS
  try {
    const stored = JSON.parse(localStorage.getItem('traccarVehicleSpeedBands') || '{}')
    return Array.isArray(stored[vehicleId]) && stored[vehicleId].length ? stored[vehicleId] : DEFAULT_SPEED_BANDS
  } catch {
    return DEFAULT_SPEED_BANDS
  }
}

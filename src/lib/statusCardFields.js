// Stable UI preference keys only. Field labels and source attributes come from
// the vehicle's assigned device protocol profile.
export const STATUS_CARD_FIELDS = [
  'fuelLevel', 'engineRpm', 'power', 'coolant', 'engineRuntime', 'maf', 'intakeAir',
  'throttle', 'ignition', 'obdSpeed', 'gnssSpeed', 'controlVoltage', 'satellites',
  'gnssStatus', 'signalStrength', 'trackerBatteryLevel', 'batteryVoltage',
  'batteryCurrent', 'avl12', 'avl13', 'barometricPressure', 'absoluteLoad',
  'timingAdvance', 'ambientAir', 'motion', 'pdop', 'hdop', 'operator',
  'fuelRailPressure', 'accelerometerX', 'accelerometerY', 'accelerometerZ',
  'segmentDistance', 'shortFuelTrim', 'fuelPressure',
]

export const DEFAULT_STATUS_CARD_FIELDS = [...STATUS_CARD_FIELDS]

// Keep map point popups concise by default while retaining the common fields
// shown in existing telemetry popups.
export const DEFAULT_MAP_POPUP_FIELDS = [
  'engineRpm', 'obdSpeed', 'gnssSpeed', 'satellites', 'gnssStatus',
  'signalStrength', 'ignition', 'motion',
]

export function normalizeStatusCardFields(fields) {
  if (!Array.isArray(fields)) return DEFAULT_STATUS_CARD_FIELDS
  return [...new Set(fields.map((field) => ({ fuelUsed: 'avl12', fuelRate: 'avl13' })[field] || field))]
}

const STATUS_FIELD_ATTRIBUTE_ALIASES = {
  engineRpm: ['rpm', 'engineRpm', 'io36'],
}

export function getStatusCardAttributeKeys(profile, field) {
  const mappedKeys = Object.entries(profile?.attributeMap || {})
    .filter(([, info]) => info?.statusCardField === field)
    .map(([key]) => key)
  return [...new Set([...mappedKeys, ...(STATUS_FIELD_ATTRIBUTE_ALIASES[field] || [])])]
}

export function getStatusCardFieldForAttribute(profile, key) {
  const mappedField = profile?.attributeMap?.[key]?.statusCardField
  if (mappedField) return mappedField
  return STATUS_FIELD_ATTRIBUTE_ALIASES.engineRpm.includes(key) ? 'engineRpm' : null
}

export function getStatusCardProfileKey(profile, field, attributeKey) {
  if (profile?.attributeMap?.[attributeKey]?.statusCardField === field) return attributeKey
  return Object.entries(profile?.attributeMap || {})
    .find(([, info]) => info?.statusCardField === field)?.[0] || attributeKey
}

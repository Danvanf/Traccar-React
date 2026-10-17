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

/**
 * Offer every profile field and every field seen in this vehicle's history as
 * a status-card choice. A profile's stable statusCardField remains the
 * preference key where one exists; otherwise the received attribute key is
 * used directly.
 */
export function getStatusCardFieldOptions(profile, observedFields = []) {
  const options = new Map()
  const attributeMap = profile?.attributeMap && typeof profile.attributeMap === 'object'
    ? profile.attributeMap
    : {}

  for (const [key, mapping] of Object.entries(attributeMap)) {
    if (!key.trim()) continue
    const field = String(mapping?.statusCardField || key).trim()
    if (!field) continue
    if (!options.has(field) || !options.get(field).label) {
      options.set(field, { field, label: String(mapping?.label || '').trim() || `Unmapped ${key}`, key })
    }
  }

  for (const entry of Array.isArray(observedFields) ? observedFields : []) {
    const key = String(entry?.key ?? entry?.fieldKey ?? '').trim()
    if (!key) continue
    const mapping = attributeMap[key]
    const field = String(mapping?.statusCardField || key).trim()
    if (!field) continue
    const existing = options.get(field)
    options.set(field, {
      field,
      label: String(mapping?.label || '').trim() || existing?.label || `Unmapped ${key}`,
      key: existing?.key || key,
    })
  }

  const rows = [...options.values()]
  const labelCounts = new Map()
  rows.forEach(({ label }) => {
    const normalized = label.toLocaleLowerCase()
    labelCounts.set(normalized, (labelCounts.get(normalized) || 0) + 1)
  })
  return rows.map((row) => labelCounts.get(row.label.toLocaleLowerCase()) > 1
    ? { ...row, label: `${row.label} (${row.key})` }
    : row)
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' }) || left.field.localeCompare(right.field, undefined, { numeric: true, sensitivity: 'base' }))
}

function profileEntryForReceivedKey(profile, key) {
  const attributeMap = profile?.attributeMap || {}
  return attributeMap[key] ? [key, attributeMap[key]] : null
}

export function getStatusCardAttributeKeys(profile, field) {
  const relevantMappings = Object.entries(profile?.attributeMap || {})
    .filter(([key, info]) => info?.statusCardField === field || info?.statusCardAliases?.includes(field) || (!info?.statusCardField && key === field))
  const mappedKeys = relevantMappings.map(([key]) => key)
  return [...new Set([...mappedKeys, field])]
}

export function getStatusCardFieldForAttribute(profile, key) {
  const mappingEntry = profileEntryForReceivedKey(profile, key)
  const mappedField = mappingEntry?.[1]?.statusCardField || mappingEntry?.[1]?.statusCardAliases?.[0]
  if (mappedField) return mappedField
  return mappingEntry?.[0] || key
}

export function getStatusCardProfileKey(profile, field, attributeKey) {
  // Display grouping must never imply that two incoming keys share a scale.
  return attributeKey
}

/**
 * Build the Settings field list from the saved profile baseline plus fields
 * observed on one vehicle. Observed metadata is informational; this function
 * never writes newly observed keys into the saved profile.
 */
export function mergeTelemetryFieldInventory(attributeMap = {}, observedFields = []) {
  const profile = attributeMap && typeof attributeMap === 'object' && !Array.isArray(attributeMap)
    ? attributeMap
    : {}
  const observed = Array.isArray(observedFields) ? observedFields : []
  const byKey = new Map()

  for (const [key, mapping] of Object.entries(profile)) {
    if (!key.trim()) continue
    byKey.set(key, {
      key,
      mapping: mapping && typeof mapping === 'object' && !Array.isArray(mapping) ? mapping : {},
      origin: 'profile',
      observed: false,
      observation: null,
    })
  }

  for (const entry of observed) {
    const key = String(entry?.key ?? entry?.fieldKey ?? '').trim()
    if (!key) continue
    const existing = byKey.get(key)
    byKey.set(key, {
      key,
      mapping: existing?.mapping || {},
      origin: existing ? 'both' : 'observed',
      observed: true,
      observation: {
        positionCount: Number.isFinite(Number(entry.positionCount)) ? Number(entry.positionCount) : null,
        firstSeenAt: entry.firstSeenAt || null,
        lastSeenAt: entry.lastSeenAt || null,
        valueTypes: Array.isArray(entry.valueTypes) ? entry.valueTypes : [],
      },
    })
  }

  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true, sensitivity: 'base' }))
}

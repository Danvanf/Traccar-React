export function groupsMissingTelemetryAttributes(groups) {
  return groups.filter((group) => group.points?.length > 0
    && !group.points.some((point) => Object.keys(point.attributes || {}).length > 0))
}

export function mergeFetchedTelemetryGroups(groups, batches) {
  const pointsByGroup = new Map(batches.map((batch) => [batch.groupId, batch.points || []]))
  return groups.map((group) => {
    const fetchedPoints = pointsByGroup.get(group.id)
    return fetchedPoints?.length ? { ...group, points: fetchedPoints } : group
  })
}

function telemetryValueType(value) {
  if (value === null) return 'empty'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'object') return 'structured'
  return 'other'
}

export function summarizeUnplottedTelemetryFields(groups, graphableKeys = [], ignoredKeys = []) {
  const graphable = new Set(graphableKeys)
  const ignored = new Set(ignoredKeys)
  const fields = new Map()

  for (const group of groups || []) {
    const deviceId = group.deviceId == null ? null : String(group.deviceId)
    const sourceKey = deviceId == null
      ? `group:${group.id ?? group.profileContext?.profileId ?? 'unknown'}`
      : `device:${deviceId}`
    for (const pointValue of group.points || []) {
      const point = Array.isArray(pointValue) ? pointValue[2] || {} : pointValue || {}
      for (const [key, value] of Object.entries(point.attributes || {})) {
        const sourceScopedKey = JSON.stringify([sourceKey, key])
        if ((graphable.has(sourceScopedKey) || graphable.has(key)) || ignored.has(key)) continue
        const fieldId = `${sourceKey}\u0000${key}`
        const entry = fields.get(fieldId) || {
          key,
          sourceKey,
          deviceId,
          groupId: group.id ?? null,
          valueCount: 0,
          observedTypes: new Set(),
          firstSeen: null,
          lastSeen: null,
        }
        entry.valueCount += 1
        entry.observedTypes.add(telemetryValueType(value))
        const timestamp = point.fixTime ?? point.timestamp ?? point.serverTime ?? point.deviceTime
        const parsedTimestamp = timestamp == null ? NaN : new Date(timestamp).getTime()
        if (Number.isFinite(parsedTimestamp)) {
          const isoTimestamp = new Date(parsedTimestamp).toISOString()
          if (entry.firstSeen == null || isoTimestamp < entry.firstSeen) entry.firstSeen = isoTimestamp
          if (entry.lastSeen == null || isoTimestamp > entry.lastSeen) entry.lastSeen = isoTimestamp
        }
        fields.set(fieldId, entry)
      }
    }
  }

  return [...fields.values()]
    .map(({ observedTypes, ...entry }) => ({ ...entry, observedTypes: [...observedTypes].sort() }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.sourceKey.localeCompare(right.sourceKey))
}

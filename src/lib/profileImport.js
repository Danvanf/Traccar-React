function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

function sameMapping(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
}

export function getProfileMappingDifferences(currentMap = {}, sourceMap = {}) {
  const keys = [...new Set([...Object.keys(currentMap || {}), ...Object.keys(sourceMap || {})])].sort()
  return keys.flatMap((key) => {
    const current = currentMap?.[key]
    const source = sourceMap?.[key]
    if (sameMapping(current, source)) return []
    return [{
      key,
      current,
      source,
      change: current === undefined ? 'added' : source === undefined ? 'removed' : 'changed',
    }]
  })
}

export function getMappingPropertyDifferences(current, source) {
  const currentMapping = current && typeof current === 'object' ? current : {}
  const sourceMapping = source && typeof source === 'object' ? source : {}
  return [...new Set([...Object.keys(currentMapping), ...Object.keys(sourceMapping)])]
    .sort()
    .flatMap((property) => {
      const currentValue = currentMapping[property]
      const sourceValue = sourceMapping[property]
      if (sameMapping(currentValue, sourceValue)) return []
      return [{ property, current: currentValue, source: sourceValue }]
    })
}

export function mergeSelectedProfileMappings(currentMap = {}, sourceMap = {}, selectedKeys = []) {
  const next = { ...(currentMap || {}) }
  for (const key of selectedKeys) {
    if (Object.hasOwn(sourceMap || {}, key)) next[key] = sourceMap[key]
    else delete next[key]
  }
  return next
}

export function mergeSelectedProfileProperties(currentMap = {}, sourceMap = {}, selectedProperties = {}) {
  const next = { ...(currentMap || {}) }
  for (const [key, properties] of Object.entries(selectedProperties || {})) {
    if (!Array.isArray(properties) || properties.length === 0) continue
    const currentMapping = next[key] && typeof next[key] === 'object' ? next[key] : {}
    const sourceMapping = sourceMap?.[key] && typeof sourceMap[key] === 'object' ? sourceMap[key] : {}
    const merged = { ...currentMapping }
    for (const property of properties) {
      if (Object.hasOwn(sourceMapping, property)) merged[property] = sourceMapping[property]
      else delete merged[property]
    }
    if (Object.keys(merged).length) next[key] = merged
    else delete next[key]
  }
  return next
}


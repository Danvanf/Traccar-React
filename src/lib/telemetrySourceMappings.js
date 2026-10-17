import { createCarProfile } from './carProfiles.js'

export function appendSourceMappingRevision(revisions = [], revision) {
  return [...revisions, revision]
}

export function sourceMappingAsOf(revisions = [], timestamp = null) {
  const instant = timestamp == null ? Number.POSITIVE_INFINITY : new Date(timestamp).getTime()
  if (!Number.isFinite(instant) && instant !== Number.POSITIVE_INFINITY) return {}
  const resolved = {}
  const ordered = [...revisions].sort((a, b) => new Date(a.effectiveAt).getTime() - new Date(b.effectiveAt).getTime() || Number(a.revision) - Number(b.revision))
  for (const revision of ordered) {
    const key = revision.fieldKey
    if (!key || new Date(revision.effectiveAt).getTime() > instant) continue
    resolved[key] = revision.mapping ?? null
  }
  return Object.fromEntries(Object.entries(resolved).filter(([, mapping]) => mapping !== null))
}

export function sourceMappingUndoTarget(revisions = []) {
  const current = revisions.at(-1)
  if (!current) return null
  const previous = revisions.at(-2) || null
  return {
    expectedRevision: Number(current.revision),
    mapping: previous?.mapping ?? null,
    restoredRevision: previous,
  }
}

export function profileWithSourceMappings(profile, revisions = [], timestamp = null) {
  if (!profile || !revisions.length) return profile
  const overrides = sourceMappingAsOf(revisions, timestamp)
  if (!Object.keys(overrides).length) return profile
  return createCarProfile({
    id: profile.id,
    name: profile.name,
    attributeMap: { ...profile.attributeMap, ...overrides },
  }, profile.unitSystem)
}

export function createSourceMappingProfileResolver(profile, revisions = []) {
  const ordered = [...revisions].sort((a, b) => new Date(a.effectiveAt).getTime() - new Date(b.effectiveAt).getTime() || Number(a.revision) - Number(b.revision))
  const cache = new Map()
  return (timestamp) => {
    if (!profile || !ordered.length) return profile
    const instant = timestamp == null ? Number.POSITIVE_INFINITY : new Date(timestamp).getTime()
    if (!Number.isFinite(instant) && instant !== Number.POSITIVE_INFINITY) return profile
    const latest = new Map()
    for (const revision of ordered) {
      const effectiveAt = new Date(revision.effectiveAt).getTime()
      if (!Number.isFinite(effectiveAt) || effectiveAt > instant) break
      latest.set(revision.fieldKey, revision)
    }
    const active = [...latest.entries()].filter(([, revision]) => revision.mapping != null).sort(([a], [b]) => a.localeCompare(b))
    if (!active.length) return profile
    const signature = active.map(([key, revision]) => `${key}:${revision.revision}`).join('|')
    if (cache.has(signature)) return cache.get(signature)
    const overrides = Object.fromEntries(active.map(([key, revision]) => [key, revision.mapping]))
    const resolved = createCarProfile({ id: profile.id, name: profile.name, attributeMap: { ...profile.attributeMap, ...overrides } }, profile.unitSystem)
    cache.set(signature, resolved)
    return resolved
  }
}

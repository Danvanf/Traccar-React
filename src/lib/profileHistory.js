/** Restore one field from a saved profile snapshot without reverting other edits. */
export function restoreProfileField(currentAttributeMap, revisionAttributeMap, fieldKey) {
  if (!currentAttributeMap || typeof currentAttributeMap !== 'object' || Array.isArray(currentAttributeMap)) {
    throw new TypeError('The current profile mapping must be an object.')
  }
  if (!revisionAttributeMap || typeof revisionAttributeMap !== 'object' || Array.isArray(revisionAttributeMap)) {
    throw new TypeError('The saved revision mapping must be an object.')
  }
  if (typeof fieldKey !== 'string' || !fieldKey) throw new TypeError('A field key is required.')

  const restored = { ...currentAttributeMap }
  if (Object.hasOwn(revisionAttributeMap, fieldKey)) restored[fieldKey] = revisionAttributeMap[fieldKey]
  else delete restored[fieldKey]
  return restored
}

/** Select the shared profile snapshot that was effective at a telemetry time. */
export function resolveProfileRevision(revisions, at = null) {
  const ordered = (Array.isArray(revisions) ? revisions : [])
    .filter((revision) => revision && Number.isFinite(Number(revision.revision))
      && Number.isFinite(new Date(revision.effectiveAt).getTime()))
    .sort((left, right) => new Date(left.effectiveAt).getTime() - new Date(right.effectiveAt).getTime()
      || Number(left.revision) - Number(right.revision))
  if (!ordered.length) return null
  if (at == null) return ordered.at(-1)
  const timestamp = new Date(at).getTime()
  if (!Number.isFinite(timestamp)) return null
  return ordered.filter((revision) => new Date(revision.effectiveAt).getTime() <= timestamp).at(-1) || null
}

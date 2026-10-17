import test from 'node:test'
import assert from 'node:assert/strict'
import { createCarProfile } from '../src/lib/carProfiles.js'
import { appendSourceMappingRevision, profileWithSourceMappings, sourceMappingAsOf, sourceMappingUndoTarget } from '../src/lib/telemetrySourceMappings.js'

test('appending a tracker mapping revision preserves history and appends exactly once', () => {
  const history = [{ fieldKey: 'io12', revision: 1, mapping: { label: 'Prior' } }]
  const revision = { fieldKey: 'io12', revision: 2, mapping: { label: 'Latest' } }
  const appended = appendSourceMappingRevision(history, revision)
  assert.equal(history.length, 1)
  assert.equal(appended.length, 2)
  assert.equal(appended.at(-1), revision)
  assert.deepEqual(sourceMappingUndoTarget(appended).mapping, { label: 'Prior' })
})

test('tracker mapping history resolves the latest entry at or before a point timestamp', () => {
  const history = [
    { fieldKey: 'io12', revision: 2, effectiveAt: '2026-02-01T00:00:00Z', mapping: { label: 'New name' } },
    { fieldKey: 'io12', revision: 1, effectiveAt: '2026-01-01T00:00:00Z', mapping: { label: 'Old name' } },
  ]
  assert.deepEqual(sourceMappingAsOf(history, '2026-01-15T00:00:00Z'), { io12: { label: 'Old name' } })
  assert.deepEqual(sourceMappingAsOf(history, '2026-02-01T00:00:00Z'), { io12: { label: 'New name' } })
})

test('tracker mappings override the base profile only after their effective time', () => {
  const base = createCarProfile({ id: 'base', name: 'Base', attributeMap: { io12: { label: 'Shared' }, io13: { label: 'Untouched' } } })
  const history = [{ fieldKey: 'io12', revision: 1, effectiveAt: '2026-02-01T00:00:00Z', mapping: { label: 'Tracker-specific' } }]
  assert.equal(profileWithSourceMappings(base, history, '2026-01-31T23:59:59Z').getAttributeInfo('io12').label, 'Shared')
  const resolved = profileWithSourceMappings(base, history, '2026-02-01T00:00:00Z')
  assert.equal(resolved.getAttributeInfo('io12').label, 'Tracker-specific')
  assert.equal(resolved.getAttributeInfo('io13').label, 'Untouched')
  assert.equal(base.getAttributeInfo('io12').label, 'Shared')
})

test('undo creates a new revision that restores the prior tracker mapping', () => {
  const history = [
    { fieldKey: 'io12', revision: 3, effectiveAt: '2026-01-01T00:00:00Z', mapping: { label: 'Prior' } },
    { fieldKey: 'io12', revision: 4, effectiveAt: '2026-02-01T00:00:00Z', mapping: { label: 'Latest' } },
  ]
  assert.deepEqual(sourceMappingUndoTarget(history), { expectedRevision: 4, mapping: { label: 'Prior' }, restoredRevision: history[0] })
})

test('undoing the first tracker override clears it back to the shared profile', () => {
  assert.deepEqual(sourceMappingUndoTarget([{ fieldKey: 'io12', revision: 1, mapping: { label: 'Tracker label' } }]), {
    expectedRevision: 1,
    mapping: null,
    restoredRevision: null,
  })
  assert.equal(sourceMappingUndoTarget([]), null)
})

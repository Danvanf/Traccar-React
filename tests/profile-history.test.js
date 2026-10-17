import assert from 'node:assert/strict'
import test from 'node:test'
import { restoreProfileField, resolveProfileRevision } from '../src/lib/profileHistory.js'

test('restoring one profile field preserves the current profile and its unknown properties', () => {
  const current = {
    keep: { label: 'Current label', vendorExtension: { preserve: true } },
    target: { label: 'Changed label', sourceUnit: 'V' },
  }
  const revision = { target: { label: 'Earlier label', sourceUnit: 'mV', vendorFlag: 7 } }

  const restored = restoreProfileField(current, revision, 'target')

  assert.deepEqual(restored, {
    keep: current.keep,
    target: revision.target,
  })
  assert.notEqual(restored, current)
  assert.equal(current.target.label, 'Changed label')
})

test('restoring a field absent from a prior revision removes only that field', () => {
  const restored = restoreProfileField({ target: { label: 'New' }, other: { label: 'Keep' } }, {}, 'target')
  assert.deepEqual(restored, { other: { label: 'Keep' } })
})

test('historical profile lookup uses the latest snapshot effective at the sample time', () => {
  const revisions = [
    { revision: 3, effectiveAt: '2026-10-16T12:00:00Z' },
    { revision: 1, effectiveAt: '0001-01-01T00:00:00Z' },
    { revision: 2, effectiveAt: '2026-10-15T12:00:00Z' },
  ]

  assert.equal(resolveProfileRevision(revisions, '2026-10-14T12:00:00Z')?.revision, 1)
  assert.equal(resolveProfileRevision(revisions, '2026-10-15T18:00:00Z')?.revision, 2)
  assert.equal(resolveProfileRevision(revisions, '2026-10-16T12:00:00Z')?.revision, 3)
  assert.equal(resolveProfileRevision(revisions)?.revision, 3)
})

test('historical profile lookup returns no snapshot for invalid timestamps or empty history', () => {
  assert.equal(resolveProfileRevision([], '2026-10-16T12:00:00Z'), null)
  assert.equal(resolveProfileRevision([{ revision: 1, effectiveAt: 'not-a-date' }], '2026-10-16T12:00:00Z'), null)
  assert.equal(resolveProfileRevision([{ revision: 1, effectiveAt: '2026-10-15T12:00:00Z' }], 'not-a-date'), null)
})

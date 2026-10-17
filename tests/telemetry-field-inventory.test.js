import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTelemetryFieldInventory } from '../src/lib/telemetryFieldInventory.js'

test('merges profile defaults with observed per-vehicle fields without mutating defaults', () => {
  const profile = { rpm: { label: 'Engine RPM' }, coolantTemp: { label: 'Coolant temperature' } }
  const observed = [
    { key: 'rpm', positionCount: 42, firstSeenAt: '2026-10-01T00:00:00Z', lastSeenAt: '2026-10-15T00:00:00Z', valueTypes: ['number'] },
    { key: 'io31', positionCount: 8, valueTypes: ['number'] },
  ]

  const rows = mergeTelemetryFieldInventory(profile, observed)

  assert.deepEqual(rows.map(({ key, origin, observed: isObserved }) => [key, origin, isObserved]), [
    ['coolantTemp', 'profile', false],
    ['io31', 'observed', true],
    ['rpm', 'both', true],
  ])
  assert.equal(rows.find((row) => row.key === 'rpm').mapping.label, 'Engine RPM')
  assert.equal(rows.find((row) => row.key === 'io31').mapping.label, undefined)
  assert.equal(rows.find((row) => row.key === 'io31').observation.positionCount, 8)
  assert.deepEqual(Object.keys(profile), ['rpm', 'coolantTemp'])
})

test('ignores invalid entries and orders AVL-style numeric suffixes naturally', () => {
  const rows = mergeTelemetryFieldInventory(null, [
    { key: 'io383' },
    { fieldKey: 'io31' },
    { key: '' },
    null,
  ])

  assert.deepEqual(rows.map((row) => row.key), ['io31', 'io383'])
})

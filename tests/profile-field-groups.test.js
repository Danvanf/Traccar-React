import test from 'node:test'
import assert from 'node:assert/strict'
import { getProfileFieldGroup, getProfileFieldGroups } from '../src/lib/profileFieldGroups.js'

test('groups mapped fields from their labels before source metadata', () => {
  assert.equal(getProfileFieldGroup('io32', { label: 'Engine Coolant Temperature', sourceGroup: 'obd' }).id, 'engine-air')
  assert.equal(getProfileFieldGroup('io48', { label: 'Fuel Level', sourceGroup: 'obd' }).id, 'fuel-emissions')
  assert.equal(getProfileFieldGroup('io50', { label: 'Barometric Pressure', sourceGroup: 'obd' }).id, 'engine-air')
})

test('keeps unknown unlabeled fields unclassified instead of guessing from source group or key', () => {
  assert.equal(getProfileFieldGroup('io999', { sourceGroup: 'obd' }).id, 'other')
  assert.equal(getProfileFieldGroup('axisMystery', {}).id, 'other')
})

test('explicit system group overrides label heuristics and supports custom groups', () => {
  assert.equal(getProfileFieldGroup('io50', { label: 'Barometric Pressure', systemGroup: 'fuel-emissions' }).id, 'fuel-emissions')
  assert.deepEqual(getProfileFieldGroup('io999', { systemGroup: 'custom-sensors' }), { id: 'custom-sensors', label: 'Custom Sensors' })
  const grouped = getProfileFieldGroups({ io999: { label: 'Custom Sensor', systemGroup: 'custom-sensors' } })
  assert.equal(grouped.groups.at(-1).id, 'custom-sensors')
  assert.equal(grouped.fields[0].group.id, 'custom-sensors')
})

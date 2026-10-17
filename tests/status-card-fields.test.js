import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getStatusCardAttributeKeys,
  getStatusCardFieldForAttribute,
  getStatusCardFieldOptions,
  getStatusCardProfileKey,
} from '../src/lib/statusCardFields.js'

test('status-card choices include all profile and vehicle-observed fields', () => {
  const attributeMap = Object.fromEntries(Array.from({ length: 117 }, (_, index) => [
    `io${index + 1}`,
    { label: `Field ${index + 1}` },
  ]))
  attributeMap.coolantTemp = { label: 'Coolant temperature', statusCardField: 'coolant' }

  const options = getStatusCardFieldOptions({ attributeMap }, [
    { key: 'io999', positionCount: 8 },
    { key: 'coolantTemp', positionCount: 16 },
  ])

  assert.equal(options.length, 119)
  assert.ok(options.some(({ field, label }) => field === 'io117' && label === 'Field 117'))
  assert.ok(options.some(({ field, label }) => field === 'io999' && label === 'Unmapped io999'))
  assert.ok(options.some(({ field, label }) => field === 'coolant' && label === 'Coolant temperature'))
})

test('status-card and map-popup helpers resolve profile keys and arbitrary received keys', () => {
  const profile = { attributeMap: { coolantTemp: { label: 'Coolant temperature', statusCardField: 'coolant' } } }

  assert.deepEqual(getStatusCardAttributeKeys(profile, 'coolant'), ['coolantTemp', 'coolant'])
  assert.equal(getStatusCardProfileKey(profile, 'coolant', 'coolantTemp'), 'coolantTemp')
  assert.equal(getStatusCardFieldForAttribute(profile, 'io999'), 'io999')
  assert.equal(getStatusCardFieldForAttribute(profile, 'coolantTemp'), 'coolant')
})

test('does not borrow interpretation across keys that share an AVL number', () => {
  const profile = { attributeMap: {
    io32: { label: 'Coolant temperature', avlId: 32 },
    coolantTemp: { label: 'Coolant temperature', avlId: 32, statusCardField: 'coolant' },
  } }

  const options = getStatusCardFieldOptions(profile, [{ key: 'io32' }])
  assert.ok(options.some(({ field, key }) => field === 'io32' && key === 'io32'))
  assert.ok(options.some(({ field, key }) => field === 'coolant' && key === 'coolantTemp'))
  assert.deepEqual(getStatusCardAttributeKeys(profile, 'coolant'), ['coolantTemp', 'coolant'])
  assert.equal(getStatusCardFieldForAttribute(profile, 'io32'), 'io32')
  assert.equal(getStatusCardProfileKey(profile, 'coolant', 'io32'), 'io32')
})

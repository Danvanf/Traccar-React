import test from 'node:test'
import assert from 'node:assert/strict'
import { getAttributeMapValidationIssues, updateProfileAttributeMapping, validateAttributeMap } from '../src/lib/carProfiles.js'

test('visual field updates preserve unknown JSON properties and other mappings', () => {
  const original = {
    io50: { label: 'Barometric Pressure', units: 'inHg', customDecoder: { scale: 7 }, vendorFlag: true },
    futureField: { label: 'Future field', customMetadata: ['keep', 4] },
  }

  const updated = updateProfileAttributeMapping(original, 'io50', 'units', 'kPa')

  assert.equal(updated.io50.units, 'kPa')
  assert.deepEqual(updated.io50.customDecoder, { scale: 7 })
  assert.equal(updated.io50.vendorFlag, true)
  assert.deepEqual(updated.futureField, original.futureField)
  assert.equal(validateAttributeMap(updated), null)
})

test('clearing an optional field removes only that property', () => {
  const updated = updateProfileAttributeMapping({ io50: { label: 'Pressure', units: 'kPa', vendorFlag: 'keep' } }, 'io50', 'units', undefined)

  assert.equal(Object.hasOwn(updated.io50, 'units'), false)
  assert.equal(updated.io50.label, 'Pressure')
  assert.equal(updated.io50.vendorFlag, 'keep')
})

test('validation returns issues attached to every affected field', () => {
  const mappings = {
    io44: { canonicalScale: 0 },
    io45: { conversion: 'not-a-supported-conversion' },
    io50: { statusCardField: 'pressure' },
    io51: { statusCardField: 'pressure' },
  }
  const issues = getAttributeMapValidationIssues(mappings)

  assert.ok(issues.some((issue) => issue.key === 'io44' && /scale/.test(issue.message)))
  assert.ok(issues.some((issue) => issue.key === 'io45' && /conversion/.test(issue.message)))
  assert.ok(issues.some((issue) => issue.key === 'io50' && /assigned to both/.test(issue.message)))
  assert.ok(issues.some((issue) => issue.key === 'io51' && /assigned to both/.test(issue.message)))
  assert.equal(validateAttributeMap(mappings), issues[0].message)
})

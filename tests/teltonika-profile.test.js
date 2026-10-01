import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROFILE_DEFINITIONS, createCarProfile, validateAttributeMap } from '../src/lib/carProfiles.js'

test('FMB003 catalog includes graph-ready OBD and OEM fields with conversions', () => {
  const definition = DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010']
  const profile = createCarProfile(definition)

  assert.equal(validateAttributeMap(definition.attributeMap), null)
  assert.equal(profile.decodeAttributeValue('io40', 469), '4.69')
  assert.equal(profile.decodeAttributeValue('io43', 10), '6.21')
  assert.equal(profile.decodeAttributeValue('io53', 20), '68.00')
  assert.equal(profile.decodeAttributeValue('io56', 10), '100.0')
  assert.equal(profile.getAttributeInfo('io542').label, 'Intake Manifold Absolute Pressure')
})

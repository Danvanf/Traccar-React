import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import catalog from '../device-field-catalog/teltonika/fmx003-mappings.json' with { type: 'json' }
import reference from '../device-field-catalog/teltonika/fmx003-reference.json' with { type: 'json' }
import previous from '../device-profile-migrations/teltonika-v15.json' with { type: 'json' }
import { buildTeltonikaProfileDefinitions } from '../scripts/build_teltonika_profiles.mjs'
import { DEFAULT_PROFILE_DEFINITIONS, createCarProfile, getAttributeMapValidationIssues, migrateProfileDefinition, translateAttribute } from '../src/lib/carProfiles.js'
import { getTelemetryUnit } from '../src/lib/telemetryUnits.js'
import { getStatusCardAttributeKeys, getStatusCardProfileKey } from '../src/lib/statusCardFields.js'
import { classifyTelemetryField, findRelatedProfileSuggestions } from '../src/lib/telemetryDiscovery.js'

const definitions = buildTeltonikaProfileDefinitions(catalog)

test('complete reference retains both model sources, all seven groups and 349 unique AVL definitions', () => {
  assert.equal(reference.fields.length, 349)
  assert.equal(new Set(reference.fields.map((field) => field.id)).size, 349)
  assert.equal(new Set(reference.fields.map((field) => field.section)).size, 7)
  assert.equal(reference.sources.length, 2)
  assert.equal(reference.sources[0].tableFingerprint, reference.sources[1].tableFingerprint)
  assert.deepEqual(reference.reviewedModels, ['FMM003', 'FMM00A'])
  for (const field of reference.fields) {
    assert.ok(field.name && field.bytes && field.type)
    assert.ok(field.hardwareSupport.length)
  }
})

test('portable model profiles match the scoped base dictionary and every raw ID has manufacturer evidence', async () => {
  const rows = new Map(reference.fields.map((field) => [field.id, field]))
  for (const [file, definition] of Object.entries(definitions)) {
    const bundled = JSON.parse(await readFile(new URL('../device-profiles/' + file, import.meta.url), 'utf8'))
    assert.deepEqual(bundled, definition)
    assert.deepEqual(getAttributeMapValidationIssues(bundled.attributeMap), [])
    assert.equal(Object.keys(bundled.attributeMap).length, 348)
    for (const [key, mapping] of Object.entries(bundled.attributeMap)) {
      if (key.startsWith('io')) assert.equal(mapping.avlId, Number(key.slice(2)))
      if (/^io[0-9]+$/.test(key)) {
        const row = rows.get(mapping.avlId)
        assert.ok(row, key + ' exists in the reference')
        assert.match(mapping.sourceReference, /wiki.teltonika-gps.com/)
        if (mapping.sourceSignedBits) assert.equal(mapping.sourceSignedBits, Number(row.bytes) * 8)
      }
      if (mapping.sourceUnit) assert.ok(getTelemetryUnit(mapping.sourceUnit), key + ' source unit has an editor pick-list choice: ' + mapping.sourceUnit)
    }
    assert.equal(bundled.attributeMap.io200.label, 'Sleep Mode')
    assert.equal(bundled.attributeMap.io31.label, 'Engine Load')
  }
  assert.throws(() => buildTeltonikaProfileDefinitions({ ...catalog, manufacturer: 'Other' }), /namespace/)
  assert.throws(() => buildTeltonikaProfileDefinitions({ ...catalog, scope: { ...catalog.scope, models: ['FMM003'] } }), /outside/)
})

test('raw values and decoded aliases are scaled once, including GPS fuel and OEM distance', () => {
  for (const definition of Object.values(definitions)) {
    const profile = createCarProfile(definition, 'metric')
    for (const [rawKey, raw, decodedKey, decoded] of [
      ['io66', 12711, 'power', 12.711], ['io67', 4120, 'battery', 4.12],
      ['io68', 412, 'batteryCurrent', 0.412], ['io181', 16, 'pdop', 1.6],
      ['io12', 4189, 'fuelUsed', 4.189], ['io13', 19, 'fuelConsumption', 0.19],
      ['io25', 2250, 'bleTemp1', 22.5], ['io31', 62, 'engineLoad', 62],
      ['io36', 1800, 'rpm', 1800],
    ]) {
      assert.ok(Math.abs(translateAttribute(profile, rawKey, raw).value - decoded) < 1e-9, rawKey)
      assert.equal(translateAttribute(profile, decodedKey, decoded).value, decoded)
    }
    assert.equal(translateAttribute(profile, 'io389', 1234).value, 1234)
    assert.equal(translateAttribute(profile, 'obdOdometer', 1234000).value, 1234)
    assert.equal(profile.getAttributeInfo('rpm').avlId, undefined)
    assert.deepEqual(profile.getAttributeInfo('rpm').sourceAvlIds, [36, 85])
  }
})

test('signed raw fallback values decode negative temperatures and fuel trim before unit scaling', () => {
  for (const definition of Object.values(definitions)) {
    const metric = createCarProfile(definition, 'metric')
    const imperial = createCarProfile(definition, 'imperial')
    for (const [key, raw, expected] of [
      ['io13201', 65526, -1], ['io13201', -10, -1], ['io32', 255, -1],
      ['io33', 246, -10], ['io59', 65500, -0.36], ['io1386', 65526, -1],
      ['io1188', 65526, -10], ['io544', 65526, -10],
    ]) {
      const translated = translateAttribute(metric, key, raw)
      assert.equal(translated.value, expected, key)
      assert.equal(translated.rawValue, raw)
      assert.equal(metric.decodeAttributeValue(key, raw), expected, key + ' direct translation')
    }
    assert.ok(Math.abs(translateAttribute(imperial, 'io13201', 65526).value - 30.2) < 1e-9)
    assert.equal(translateAttribute(metric, 'coolantTemp', -1).value, -1)
    for (const bad of [65536, -32769, 1.5, 'not a number', true]) assert.equal(translateAttribute(metric, 'io13201', bad).status, 'invalid')
    assert.ok(getAttributeMapValidationIssues({ bad: { label: 'Bad', sourceSignedBits: 64 } }).length)
  }
})

test('modern BLE errors are unavailable and valid zero/older overlapping values stay numeric', () => {
  const profile = createCarProfile(definitions['teltonika-fmm00a.json'], 'metric')
  for (const raw of [32767, 32766, 32765]) {
    assert.equal(translateAttribute(profile, 'io25', raw).status, 'sentinel')
    assert.equal(translateAttribute(profile, 'bleTemp1', raw / 100).status, 'sentinel')
  }
  for (const raw of [65535, 65534, 65533]) assert.equal(translateAttribute(profile, 'io86', raw).status, 'sentinel')
  assert.equal(translateAttribute(profile, 'io25', 2000).value, 20)
  assert.equal(translateAttribute(profile, 'io25', 0).value, 0)
  assert.equal(translateAttribute(profile, 'io86', 0).value, 0)
  assert.equal(translateAttribute(profile, 'io86', 500).value, 50)
})

test('identifiers and composite values remain text while undocumented source units remain unknown', () => {
  const profile = createCarProfile(definitions['teltonika-fmm003.json'])
  for (const key of ['io11', 'io14', 'vin', 'io259', 'io285']) assert.equal(translateAttribute(profile, key, '001234').value, '001234')
  for (const key of ['io10824', 'io10816']) {
    assert.equal(profile.getAttributeUnit(key), '')
    assert.equal(profile.getAttributeInfo(key).canonicalScale, undefined)
    assert.equal(profile.getAttributeInfo(key).sourceUnitStatus, 'unknown')
  }
  for (const key of ['io1390', 'io1391']) assert.equal(translateAttribute(profile, key, 10).value, 10)
})

test('schema 16 updates exact old defaults, retains custom edits, and does not change profile identities', () => {
  for (const old of Object.values(previous)) {
    const original = structuredClone(old)
    const upgraded = migrateProfileDefinition(old)
    assert.equal(upgraded.definition.id, old.id)
    assert.deepEqual(upgraded.definition.attributeMap, DEFAULT_PROFILE_DEFINITIONS[old.id].attributeMap)
    assert.deepEqual(old, original)
    const custom = { label: 'My calibrated coolant', units: 'custom', canonicalUnit: '°C', canonicalScale: 2 }
    const edited = migrateProfileDefinition({ ...old, attributeMap: { ...old.attributeMap, io32: custom, io100: { label: 'My configured identifier' }, myKey: { label: 'My sensor' } } })
    assert.deepEqual(edited.definition.attributeMap.io32, custom)
    assert.equal(edited.definition.attributeMap.io100.label, 'My configured identifier')
    assert.equal(edited.definition.attributeMap.myKey.label, 'My sensor')
    assert.equal(edited.definition.attributeMap.io31.label, 'Engine Load')
    assert.deepEqual(migrateProfileDefinition(edited.definition).changes, [])
  }
  assert.equal(migrateProfileDefinition({ id: 'other-brand', schemaVersion: 15, attributeMap: {} }).definition.attributeMap.io36, undefined)
})

test('status selections accept raw and decoded alternatives without sharing their numeric representation', () => {
  for (const definition of Object.values(definitions)) {
    const profile = createCarProfile(definition)
    assert.ok(getStatusCardAttributeKeys(profile, 'engineRpm').includes('io36'))
    assert.ok(getStatusCardAttributeKeys(profile, 'engineRpm').includes('rpm'))
    assert.ok(getStatusCardAttributeKeys(profile, 'avl12').includes('io12'))
    assert.ok(getStatusCardAttributeKeys(profile, 'avl12').includes('fuelUsed'))
    assert.equal(getStatusCardProfileKey(profile, 'avl12', 'fuelUsed'), 'fuelUsed')
    assert.equal(profile.getAttributeInfo('io12').canonicalScale, 0.001)
    assert.equal(profile.getAttributeInfo('fuelUsed').canonicalScale, 1)
  }
})

test('partial suggestions and unrelated model profiles do not undermine reviewed mappings', () => {
  const mapping = { label: 'Coolant Temperature', avlId: 32, sourceUnit: '°C', canonicalScale: 1, sourceSignedBits: 8 }
  assert.equal(classifyTelemetryField({ mapping, suggestions: [{ mapping: { label: 'Coolant Temperature', avlId: 32 } }] }), 'known')
  assert.equal(classifyTelemetryField({ mapping, suggestions: [{ mapping: { ...mapping, canonicalScale: 10 } }] }), 'conflicting')
  assert.equal(classifyTelemetryField({ mapping, suggestions: [{ mapping: { ...mapping, sourceSignedBits: 16 } }] }), 'conflicting')
  const [other] = findRelatedProfileSuggestions('io32', { id: 'current' }, [{ id: 'other-model', name: 'Other model', attributeMap: { io32: { label: 'Different model meaning' } } }])
  assert.equal(other.relatedProfileSuggestion, true)
  assert.equal(classifyTelemetryField({ mapping, suggestions: [other] }), 'known')
})

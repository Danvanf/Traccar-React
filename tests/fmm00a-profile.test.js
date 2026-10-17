import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createCarProfile, getAttributeMapValidationIssues, migrateProfileDefinition, translateAttribute } from '../src/lib/carProfiles.js'
import { getTelemetryUnit } from '../src/lib/telemetryUnits.js'

const profilePath = fileURLToPath(new URL('../device-profiles/teltonika-fmm00a.json', import.meta.url))

test('FMM00A profile keeps its live assignment ID and validates the observed field map', async () => {
  const definition = JSON.parse(await readFile(profilePath, 'utf8'))

  assert.equal(definition.id, 'teltonika-fmm003')
  assert.equal(definition.name, 'Teltonika FMM00A')
  assert.equal(definition.schemaVersion, 16)
  assert.equal(Object.keys(definition.attributeMap).length, 348)
  assert.deepEqual(getAttributeMapValidationIssues(definition.attributeMap), [])
})

test('FMM00A recognizes normalized Traccar fields while preserving their source units', async () => {
  const definition = JSON.parse(await readFile(profilePath, 'utf8'))
  const profile = createCarProfile(definition, 'metric')
  const cases = [
    ['engineLoad', 42, 'Engine Load', '%', 'percent'],
    ['coolantTemp', 91, 'Coolant Temperature', '°C', 'temperature'],
    ['rpm', 1800, 'Engine RPM', 'rpm', 'engine_speed'],
  ]

  for (const [key, value, label, unit, quantity] of cases) {
    const translated = translateAttribute(profile, key, value)
    assert.equal(translated.label, label)
    assert.equal(translated.value, value)
    assert.equal(translated.unit, unit)
    assert.equal(definition.attributeMap[key].quantity, quantity)
  }
})

test('FMM00A schema migration adds normalized decoder keys without replacing saved edits', async () => {
  const definition = JSON.parse(await readFile(profilePath, 'utf8'))
  const savedRpm = { label: 'My RPM label', units: 'rpm' }
  const migrated = migrateProfileDefinition({
    ...definition,
    schemaVersion: 14,
    attributeMap: { ...definition.attributeMap, engineLoad: undefined, coolantTemp: undefined, rpm: savedRpm },
  })

  assert.equal(migrated.definition.schemaVersion, 16)
  assert.deepEqual(migrated.definition.attributeMap.rpm, savedRpm)
  assert.equal(migrated.definition.attributeMap.engineLoad.avlId, 31)
  assert.equal(migrated.definition.attributeMap.coolantTemp.avlId, 32)
  assert.ok(migrated.changes.some((change) => change.includes('engineLoad, coolantTemp')))
})

test('FMM00A PCB temperature uses its documented scale in both display systems', async () => {
  const definition = JSON.parse(await readFile(profilePath, 'utf8'))
  const metric = createCarProfile(definition, 'metric')
  const imperial = createCarProfile(definition, 'imperial')
  const metricValue = translateAttribute(metric, 'io13201', 327)
  const imperialValue = translateAttribute(imperial, 'io13201', 327)

  assert.equal(metricValue.label, 'Tracker PCB Temperature')
  assert.equal(metricValue.canonicalValue, 32.7)
  assert.equal(metricValue.value, 32.7)
  assert.equal(metricValue.unit, '°C')
  assert.deepEqual(getTelemetryUnit(definition.attributeMap.io13201.sourceUnit), {
    symbol: '0.1 °C',
    label: 'Tenths of a degree Celsius (0.1 °C)',
    scale: 0.1,
    offset: 0,
    quantity: 'temperature',
    canonicalUnit: '°C',
  })
  assert.ok(Math.abs(imperialValue.value - 90.86) < 1e-9)
  assert.equal(imperialValue.unit, '°F')
})

test('FMM00A AVL 247 has a known crash-code identity and no physical unit', async () => {
  const definition = JSON.parse(await readFile(profilePath, 'utf8'))
  const translated = translateAttribute(createCarProfile(definition), 'io247', 6)

  assert.equal(translated.label, 'Crash Detection')
  assert.equal(translated.value, 6)
  assert.equal(translated.unit, '')
  assert.equal(translated.status, 'mapped')
})

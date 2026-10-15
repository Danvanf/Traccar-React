import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createCarProfile, getAttributeMapValidationIssues, translateAttribute } from '../src/lib/carProfiles.js'

const profilePath = fileURLToPath(new URL('../device-profiles/teltonika-fmm00a.json', import.meta.url))

test('FMM00A profile keeps its live assignment ID and validates the observed field map', async () => {
  const definition = JSON.parse(await readFile(profilePath, 'utf8'))

  assert.equal(definition.id, 'teltonika-fmm003')
  assert.equal(definition.name, 'Teltonika FMM00A')
  assert.equal(definition.schemaVersion, 14)
  assert.equal(Object.keys(definition.attributeMap).length, 22)
  assert.deepEqual(getAttributeMapValidationIssues(definition.attributeMap), [])
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
  assert.ok(Math.abs(imperialValue.value - 90.86) < 1e-9)
  assert.equal(imperialValue.unit, '°F')
})

test('FMM00A AVL 247 remains an unscaled raw value with an uncertainty label', async () => {
  const definition = JSON.parse(await readFile(profilePath, 'utf8'))
  const translated = translateAttribute(createCarProfile(definition), 'io247', 6)

  assert.match(translated.label, /support unverified/)
  assert.equal(translated.value, 6)
  assert.equal(translated.unit, '')
  assert.equal(translated.status, 'mapped')
})

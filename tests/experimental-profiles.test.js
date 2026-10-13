import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE_ID, PROFILE_DEFINITION_SCHEMA_VERSION, getAttributeMapValidationIssues, migrateProfileDefinition } from '../src/lib/carProfiles.js'

const profileDirectory = fileURLToPath(new URL('../device-profiles/', import.meta.url))
const candidateFiles = [
  'teltonika-fmb120.experimental.json',
  'teltonika-fmc003.experimental.json',
  'teltonika-fmc130.experimental.json',
  'queclink-gv300.experimental.json',
  'queclink-gv55.experimental.json',
]

test('experimental bundled profiles are current, valid, distinct, and preserve their mappings', async () => {
  const definitions = await Promise.all(candidateFiles.map(async (filename) => {
    const json = await readFile(join(profileDirectory, filename), 'utf8')
    const definition = JSON.parse(json)

    assert.equal(definition.schemaVersion, PROFILE_DEFINITION_SCHEMA_VERSION, filename)
    assert.match(definition.name, /experimental/i, filename)
    assert.notEqual(definition.id, DEFAULT_PROFILE_ID, filename)
    assert.ok(Object.keys(definition.attributeMap || {}).length > 0, filename)
    assert.deepEqual(getAttributeMapValidationIssues(definition.attributeMap), [], filename)

    const migrated = migrateProfileDefinition(definition).definition
    assert.equal(migrated.id, definition.id, filename)
    assert.deepEqual(migrated.attributeMap, definition.attributeMap, filename)
    return definition
  }))

  assert.equal(new Set(definitions.map(({ id }) => id)).size, candidateFiles.length)
})

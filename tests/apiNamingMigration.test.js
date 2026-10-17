import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, readSettings } from '../src/lib/settings.js'

function readSaved(value) {
  const original = globalThis.localStorage
  globalThis.localStorage = { getItem: () => JSON.stringify(value) }
  try { return readSettings() } finally { globalThis.localStorage = original }
}

test('saved legacy API URL migrates to the renamed proxy without losing other settings', () => {
  const result = readSaved({ vehicleApiBaseUrl: '/vehicle-api', pollIntervalMs: 12000 })
  assert.equal(result.traccarReactApiBaseUrl, '/traccar-react-api')
  assert.equal(result.pollIntervalMs, 12000)
  assert.equal('vehicleApiBaseUrl' in result, false)
})

test('custom API hosts survive the rename and a current value wins over the old property', () => {
  assert.equal(readSaved({ vehicleApiBaseUrl: 'https://example.test/custom-api' }).traccarReactApiBaseUrl, 'https://example.test/custom-api')
  assert.equal(readSaved({ vehicleApiBaseUrl: 'https://example.test/vehicle-api/' }).traccarReactApiBaseUrl, 'https://example.test/traccar-react-api')
  assert.equal(readSaved({ vehicleApiBaseUrl: '/old', traccarReactApiBaseUrl: '/current' }).traccarReactApiBaseUrl, '/current')
  assert.equal(DEFAULT_SETTINGS.traccarReactApiBaseUrl, '/traccar-react-api')
})

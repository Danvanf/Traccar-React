import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, readSettings } from '../src/lib/settings.js'

function readSaved(value) {
  const original = globalThis.localStorage
  globalThis.localStorage = { getItem: () => JSON.stringify(value) }
  try { return readSettings() } finally { globalThis.localStorage = original }
}

test('Traccar Scope settings use the Scope API URL and retain other saved preferences', () => {
  const result = readSaved({ traccarScopeApiBaseUrl: 'https://example.test/traccar-scope-api', pollIntervalMs: 12000 })
  assert.equal(result.traccarScopeApiBaseUrl, 'https://example.test/traccar-scope-api')
  assert.equal(result.pollIntervalMs, 12000)
  assert.equal(DEFAULT_SETTINGS.traccarScopeApiBaseUrl, '/traccar-scope-api')
})

test('current settings do not read prior product URL properties', () => {
  const result = readSaved({ traccarReactApiBaseUrl: '/traccar-react-api', vehicleApiBaseUrl: '/vehicle-api' })
  assert.equal(result.traccarScopeApiBaseUrl, '/traccar-scope-api')
  assert.equal('traccarReactApiBaseUrl' in result, false)
  assert.equal('vehicleApiBaseUrl' in result, false)
})

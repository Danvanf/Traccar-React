import test from 'node:test'
import assert from 'node:assert/strict'
import { saveTelemetrySourceMapping } from '../src/lib/vehicleAppApi.js'

test('sends a source mapping change kind with its expected revision', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return { ok: true, json: async () => ({ fieldKey: 'io50', revision: 3, changeKind: 'documented-auto' }) }
  }
  try {
    const result = await saveTelemetrySourceMapping('/vehicle-api', 42, 'io50', { label: 'Analog input', sourceUnit: 'V' }, 2, 'documented-auto')
    assert.equal(request.url, '/vehicle-api/api/telemetry-source-mappings/42/io50')
    assert.deepEqual(JSON.parse(request.options.body), {
      expectedRevision: 2,
      mapping: { label: 'Analog input', sourceUnit: 'V' },
      changeKind: 'documented-auto',
    })
    assert.equal(result.changeKind, 'documented-auto')
  } finally {
    globalThis.fetch = originalFetch
  }
})

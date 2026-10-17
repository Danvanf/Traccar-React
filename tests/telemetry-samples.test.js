import test from 'node:test'
import assert from 'node:assert/strict'
import { formatTelemetrySample } from '../src/lib/telemetrySamples.js'

test('sensitive telemetry identifiers never expose their sample value', () => {
  for (const [key, mapping] of [
    ['vin', {}],
    ['tripTagName', {}],
    ['security_key', {}],
    ['field42', { label: 'Vehicle Identification Number' }],
    ['field43', { valueType: 'identifier' }],
  ]) {
    const sample = formatTelemetrySample(key, mapping, 'sensitive-value', { revealText: true })
    assert.deepEqual(sample, { text: 'Hidden sensitive value', hidden: true, revealable: false })
    assert.equal(JSON.stringify(sample).includes('sensitive-value'), false)
  }
})

test('ordinary text samples are hidden until the user explicitly reveals them', () => {
  assert.deepEqual(formatTelemetrySample('alarm', {}, 'Engine warning'), {
    text: 'Text value hidden (14 characters)',
    hidden: true,
    revealable: true,
  })
  assert.deepEqual(formatTelemetrySample('alarm', {}, 'Engine warning', { revealText: true }), {
    text: 'Engine warning',
    hidden: false,
    revealable: true,
  })
})

test('numeric telemetry samples remain visible and units stay separate', () => {
  assert.deepEqual(formatTelemetrySample('coolantTemp', { sourceUnit: '°C' }, 92), {
    text: '92',
    hidden: false,
    revealable: false,
  })
})

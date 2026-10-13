import test from 'node:test'
import assert from 'node:assert/strict'
import { hasMeaningfulTelemetryValue, isTelemetryPlaceholderValue } from '../src/lib/telemetry.js'

test('uses selected profile sentinels instead of global Teltonika assumptions', () => {
  const profile = {
    getAttributeInfo: (key) => ({ sentinelValues: key === 'io29' ? [255] : key === 'io86' ? [65535] : [] }),
  }
  assert.equal(isTelemetryPlaceholderValue('io29', 255), false)
  assert.equal(isTelemetryPlaceholderValue('io29', 255, profile), true)
  assert.equal(isTelemetryPlaceholderValue('io86', 65535, profile), true)
  assert.equal(isTelemetryPlaceholderValue('io86', 65536, profile), false)
  assert.equal(isTelemetryPlaceholderValue('io36', 1200, profile), false)
})

test('telemetry series are selectable only when they contain a meaningful value', () => {
  assert.equal(hasMeaningfulTelemetryValue([0, 0, 0], 'io40'), false)
  const profile = {
    getAttributeInfo: (key) => ({ sentinelValues: key === 'io29' ? [255] : key === 'io86' ? [65535] : [] }),
  }
  assert.equal(hasMeaningfulTelemetryValue([255, 255], 'io29', profile), false)
  assert.equal(hasMeaningfulTelemetryValue([65535, 65535], 'io86', profile), false)
  assert.equal(hasMeaningfulTelemetryValue([0, 255, 2.5], 'io40', profile), true)
})

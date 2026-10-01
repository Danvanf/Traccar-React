import test from 'node:test'
import assert from 'node:assert/strict'
import { hasMeaningfulTelemetryValue, isTelemetryPlaceholderValue } from '../src/lib/telemetry.js'

test('recognizes Teltonika absent-value sentinels without treating normal values as absent', () => {
  assert.equal(isTelemetryPlaceholderValue('io29', 255), true)
  assert.equal(isTelemetryPlaceholderValue('io86', 65535), true)
  assert.equal(isTelemetryPlaceholderValue('io86', 65536), true)
  assert.equal(isTelemetryPlaceholderValue('io36', 1200), false)
})

test('telemetry series are selectable only when they contain a meaningful value', () => {
  assert.equal(hasMeaningfulTelemetryValue([0, 0, 0], 'io40'), false)
  assert.equal(hasMeaningfulTelemetryValue([255, 255], 'io29'), false)
  assert.equal(hasMeaningfulTelemetryValue([65535, 65535], 'io86'), false)
  assert.equal(hasMeaningfulTelemetryValue([0, 255, 2.5], 'io40'), true)
})

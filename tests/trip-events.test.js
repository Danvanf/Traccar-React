import test from 'node:test'
import assert from 'node:assert/strict'
import { detectTripEvents, normalizePointTelemetry, resolveEventThresholds } from '../src/lib/tripEvents.js'

test('detects maximum speed using the configured threshold', () => {
  const trip = { start: new Date('2026-01-01T00:00:00Z'), points: [[1, 2, { speedMph: 72, timestamp: '2026-01-01T00:01:00Z' }]] }
  const events = detectTripEvents(trip, { maximum_speed: { value: 70, unit: 'mph' } })
  assert.equal(events.length, 1)
  assert.equal(events[0].eventType, 'maximum_speed')
})

test('emits only the highest maximum-speed event for a trip', () => {
  const trip = { start: new Date('2026-01-01T00:00:00Z'), points: [
    [1, 2, { speedMph: 71, timestamp: '2026-01-01T00:01:00Z' }],
    [1, 2, { speedMph: 74, timestamp: '2026-01-01T00:02:00Z' }],
    [1, 2, { speedMph: 72, timestamp: '2026-01-01T00:03:00Z' }],
  ] }
  const events = detectTripEvents(trip)
  assert.equal(events.filter((event) => event.eventType === 'maximum_speed').length, 1)
  assert.equal(events[0].measuredValue, 74)
})

test('detects hard braking and acceleration from supplied measurements', () => {
  const trip = { start: new Date('2026-01-01T00:00:00Z'), points: [
    [1, 2, { accelerationMps2: -4, accelerationSource: 'obd2' }],
    [1, 2, { accelerationMps2: 4, accelerationSource: 'obd2' }],
  ] }
  const events = detectTripEvents(trip)
  assert.deepEqual(events.map((event) => event.eventType), ['hard_braking', 'hard_acceleration'])
  assert.equal(events[0].source, 'obd2')
})

test('does not emit events below thresholds', () => {
  const trip = { start: new Date('2026-01-01T00:00:00Z'), points: [[1, 2, { speedMph: 20, accelerationMps2: 0.2 }]] }
  assert.deepEqual(detectTripEvents(trip), [])
})

test('normalizes common tracker telemetry names', () => {
  const telemetry = normalizePointTelemetry([1, 2, { attributes: { accel: '-4.2', vehicleSpeed: '73' } }])
  assert.equal(telemetry.accelerationMps2, -4.2)
  assert.equal(telemetry.speedMph, 73)
  assert.equal(telemetry.accelerationSource, 'obd2')
})

test('detects long idle and ignores course-only cornering', () => {
  const start = new Date('2026-01-01T00:00:00Z')
  const trip = { start, points: [
    [1, 2, { timestamp: start, speedMph: 0, course: 0 }],
    [1, 2, { timestamp: new Date(start.getTime() + 301000), speedMph: 0, course: 100 }],
  ] }
  const types = detectTripEvents(trip).map((event) => event.eventType)
  assert.ok(types.includes('long_idle'))
  assert.ok(!types.includes('hard_cornering'))
})

test('resolves thresholds from vehicle to system to global to defaults', () => {
  const resolved = resolveEventThresholds({
    global: { maximum_speed: { value: 65, unit: 'mph' } },
    system: { maximum_speed: { value: 70, unit: 'mph' } },
    vehicle: { maximum_speed: { value: 75, unit: 'mph' } },
  })
  assert.equal(resolved.maximum_speed.value, 75)
  assert.equal(resolved.hard_braking.value, -3.5)
})

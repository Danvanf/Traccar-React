import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVehicleQuestion, summarizeVehicleReport } from '../src/lib/vehicleQuery.js'

const now = new Date(2026, 9, 16, 12)
const vehicles = [
  { id: 'silverado-id', displayName: 'Silverado' },
  { id: 'enclave-id', displayName: 'Enclave' },
]

test('parses a vehicle distance question and prior calendar week', () => {
  assert.deepEqual(parseVehicleQuestion('How many miles did the Silverado drive last week?', vehicles, now), {
    metric: 'distance', vehicleId: 'silverado-id', vehicleName: 'Silverado', from: '2026-10-05', to: '2026-10-11', rangeLabel: 'last calendar week',
  })
})

test('uses a rolling seven-day date range when requested', () => {
  const plan = parseVehicleQuestion('How many trips did the Enclave make in the last 7 days?', vehicles, now)
  assert.equal(plan.metric, 'trip-count')
  assert.equal(plan.vehicleId, 'enclave-id')
  assert.equal(plan.from, '2026-10-10')
  assert.equal(plan.to, '2026-10-16')
})

test('defaults a missing date phrase to the last seven days and supports all accessible vehicles', () => {
  const plan = parseVehicleQuestion('How far did we drive?', vehicles, now)
  assert.equal(plan.metric, 'distance')
  assert.equal(plan.vehicleId, null)
  assert.equal(plan.from, '2026-10-10')
  assert.equal(plan.rangeLabel, 'the last 7 days (default)')
})

test('recognizes highest speed and generic pronouns as all accessible vehicles', () => {
  const plan = parseVehicleQuestion('What was the highest speed this month?', vehicles, now)
  assert.equal(plan.metric, 'max-speed')
  assert.equal(plan.vehicleId, null)
  assert.equal(plan.from, '2026-10-01')
  assert.equal(parseVehicleQuestion('How far did we drive?', vehicles, now).vehicleId, null)
})

test('rejects unsupported metrics and invalid date order', () => {
  assert.match(parseVehicleQuestion('Where is the Silverado now?', vehicles, now).error, /trip count, distance/)
  assert.match(parseVehicleQuestion('How many miles from 2026-10-20 to 2026-10-01?', vehicles, now).error, /end date/)
  assert.match(parseVehicleQuestion('How many miles from 2024-01-01 to 2026-01-01?', vehicles, now).error, /one year or less/)
})

test('asks for a correction when an explicitly named vehicle cannot be matched', () => {
  assert.match(parseVehicleQuestion('How many miles did the Camaro drive yesterday?', vehicles, now).error, /could not match that vehicle/)
})

test('aggregates daily report values by vehicle without reading trip locations', () => {
  const rows = summarizeVehicleReport({ rows: [
    { vehicleId: 'one', vehicleName: 'Truck', tripCount: 2, distanceMeters: 1609.344, durationSeconds: 3600, eventCount: 1, maxSpeedMph: 55 },
    { vehicleId: 'one', vehicleName: 'Truck', tripCount: 1, distanceMeters: 804.672, durationSeconds: 1800, eventCount: 2, maxSpeedMph: 61 },
    { vehicleId: 'two', vehicleName: 'Car', tripCount: 1, distanceMeters: 0, durationSeconds: 0, eventCount: 0, maxSpeedMph: null },
  ] }, 'distance')
  assert.deepEqual(rows.map(({ vehicleId, value }) => [vehicleId, value]), [['one', 2414.016], ['two', 0]])
  assert.equal(summarizeVehicleReport({ rows: [] }, 'max-speed').length, 0)
})

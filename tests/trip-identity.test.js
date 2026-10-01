import test from 'node:test'
import assert from 'node:assert/strict'
import { toHistoryPosition } from '../src/lib/geo.js'
import { buildTripsForDevice } from '../src/lib/trips.js'
import { resolveTrip, importTripsByDevice, recalculateTrip } from '../src/lib/vehicleAppApi.js'
import { createRequestGate } from '../src/lib/requestGate.js'

const start = new Date('2026-01-15T12:00:00Z')
const trip = { deviceId: 5, start, end: new Date(+start + 30000), startTraccarPositionId: 101, endTraccarPositionId: 103 }

test('position identities survive normalization, trip merging, and JSON import payloads', () => {
  const points = [101, 102, 103].map((id, i) => toHistoryPosition({
    id, deviceId: 5, latitude: 40 + i * 0.001, longitude: -75,
    fixTime: new Date(+start + i * 15000).toISOString(),
  }))
  const [derived] = buildTripsForDevice(5, points, 20)
  assert.equal(derived.startTraccarPositionId, 101)
  assert.equal(derived.endTraccarPositionId, 103)
  assert.equal(derived.startLatitude, 40)
  assert.equal(derived.endLatitude, 40.002)
  const payload = JSON.parse(JSON.stringify(derived))
  assert.equal(payload.startTraccarPositionId, 101)
  assert.equal(payload.endTraccarPositionId, 103)
})

test('separate journeys retain their own source endpoints', () => {
  const points = [0, 15000, 1200000, 1215000].map((ms, i) => ({
    positionId: i + 1, timestamp: new Date(+start + ms),
    latitude: i < 2 ? 40 + i * 0.001 : 40.001 + (i - 2) * 0.001, longitude: -75,
  }))
  const trips = buildTripsForDevice(5, points, 20)
  assert.deepEqual(trips.map(t => [t.startTraccarPositionId, t.endTraccarPositionId]), [[1, 2], [3, 4]])
})

test('resolver requests exact device, timestamps, and source IDs', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url, 'http://localhost')
    assert.equal(parsed.pathname, '/vehicle-api/api/trips/resolve')
    assert.equal(parsed.searchParams.get('traccarDeviceId'), '5')
    assert.equal(parsed.searchParams.get('startedAt'), trip.start.toISOString())
    assert.equal(parsed.searchParams.get('endedAt'), trip.end.toISOString())
    assert.equal(parsed.searchParams.get('startTraccarPositionId'), '101')
    assert.equal(parsed.searchParams.get('endTraccarPositionId'), '103')
    assert.equal(parsed.searchParams.has('vehicleId'), false)
    return Response.json({ id: 'persisted-id', vehicleId: 'historical-vehicle', notes: 'Saved note' })
  })
  assert.equal((await resolveTrip('/vehicle-api', trip)).id, 'persisted-id')
})

for (const status of [404, 409, 503]) {
  test(`resolver refuses HTTP ${status} without retrying a guessed identity`, async (t) => {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
      calls++
      return Response.json({ title: 'Editing disabled', detail: 'No unique identity' }, { status })
    })
    await assert.rejects(resolveTrip('/vehicle-api', trip), /Editing disabled.*No unique identity/)
    assert.equal(calls, 1)
  })
}

test('legacy points without source IDs omit optional query fields', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(url, 'http://localhost').searchParams.has('startTraccarPositionId'), false)
    return Response.json({ id: 'legacy-id' })
  })
  await resolveTrip('/vehicle-api', { ...trip, startTraccarPositionId: null, endTraccarPositionId: null })
})

test('late selection responses and old write completions cannot replace the current selection', async () => {
  const gate = createRequestGate()
  let releaseOld
  const oldRequest = new Promise(resolve => { releaseOld = resolve })
  let displayed
  const oldSelection = gate.begin()
  const oldWrite = gate.current()
  const pending = oldRequest.then(() => {
    if (gate.isCurrent(oldSelection)) displayed = 'old trip'
  })
  const newSelection = gate.begin()
  if (gate.isCurrent(newSelection)) displayed = 'new trip'
  releaseOld()
  await pending
  assert.equal(displayed, 'new trip')
  assert.equal(gate.isCurrent(oldWrite), false)
  gate.begin() // Changing API invalidates the current selection too.
  assert.equal(gate.isCurrent(newSelection), false)
})


test('import conflict preserves server details and exposes a structured status to the UI', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++
    assert.equal(options.method, 'POST')
    assert.equal(JSON.parse(options.body).traccarDeviceId, 5)
    return Response.json({
      title: 'Trip import conflicts with saved history',
      detail: 'No trips in this batch were saved.', code: 'trip_import_conflict',
    }, { status: 409 })
  })
  await assert.rejects(importTripsByDevice('/vehicle-api', { traccarDeviceId: 5, trips: [] }), error => {
    assert.equal(error.status, 409)
    assert.equal(error.code, 'trip_import_conflict')
    assert.match(error.message, /No trips in this batch were saved/)
    return true
  })
  assert.equal(calls, 1)
})

test('recalculation targets a saved UUID and does not send annotation fields', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url, 'http://localhost').pathname, '/vehicle-api/api/trips/saved-id/recalculate')
    const body = JSON.parse(options.body)
    assert.equal(body.derivationVersion, 'trip-v2')
    assert.equal(body.distanceMeters, 222)
    assert.equal('notes' in body, false)
    assert.equal('vehicleId' in body, false)
    return Response.json({ id: 'saved-id', notes: 'keep this', derivationVersion: 'trip-v2' })
  })
  const result = await recalculateTrip('/vehicle-api', 'saved-id', {
    durationSeconds: 42, distanceMeters: 222, derivationVersion: 'trip-v2',
  })
  assert.equal(result.notes, 'keep this')
})

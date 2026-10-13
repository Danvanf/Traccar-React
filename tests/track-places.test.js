import test from 'node:test'
import assert from 'node:assert/strict'
import { addNamedPlaceMarkers } from '../src/lib/trackPlaces.js'

test('named-place passage uses its midpoint timestamp and marks the exit', () => {
    const points = [
      { timestamp: new Date('2026-01-01T00:00:00Z'), latitude: 40, longitude: -74, __groupIndex: 0 },
      { timestamp: new Date('2026-01-01T00:00:10Z'), latitude: 40.0001, longitude: -74, __groupIndex: 0 },
      { timestamp: new Date('2026-01-01T00:00:20Z'), latitude: 40.0002, longitude: -74, __groupIndex: 0 },
      { timestamp: new Date('2026-01-01T00:00:30Z'), latitude: 40.01, longitude: -74, __groupIndex: 0 },
    ]
    const places = [{ name: 'Start', trackName: 'Test Course', placeType: 'track_start', latitude: 40, longitude: -74, radiusMeters: 50, vehicleId: 'car-1' }]
    const groups = [{ vehicleId: 'car-1' }]

    const marked = addNamedPlaceMarkers(points, places, groups)

    assert.equal(marked[1].placeEvent, 'enter:track_start:Test Course / Start')
    assert.equal(marked[3].placeEvent, 'exit:track_start:Test Course / Start')
})

test('named places assigned to another vehicle are ignored', () => {
    const points = [{ timestamp: new Date(), latitude: 40, longitude: -74, __groupIndex: 0 }]
    const places = [{ name: 'Start', placeType: 'track_start', latitude: 40, longitude: -74, radiusMeters: 50, vehicleId: 'car-2' }]

    assert.equal(addNamedPlaceMarkers(points, places, [{ vehicleId: 'car-1' }])[0].placeEvent, '')
})

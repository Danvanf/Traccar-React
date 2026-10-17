import test from 'node:test'
import assert from 'node:assert/strict'
import { groupsMissingTelemetryAttributes, mergeFetchedTelemetryGroups, summarizeUnplottedTelemetryFields } from '../src/lib/telemetryGraphData.js'

test('identifies route-only groups whose points do not carry telemetry attributes', () => {
  const groups = [
    { id: 'route-only', points: [{ attributes: {} }, { attributes: {} }] },
    { id: 'has-telemetry', points: [{ attributes: { io247: 4 } }] },
    { id: 'empty', points: [] },
  ]

  assert.deepEqual(groupsMissingTelemetryAttributes(groups), [groups[0]])
})

test('replaces route-only points with full Traccar positions and preserves group context', () => {
  const groups = [
    { id: 'truck-trip', vehicleId: 'truck', profileContext: { profileId: 'fmm00a' }, points: [{ timestamp: new Date(1), attributes: {} }] },
    { id: 'offline-trip', points: [{ timestamp: new Date(2), attributes: {} }] },
  ]
  const fullPoint = { timestamp: new Date(3), attributes: { io247: 4, io69: 9 } }

  const result = mergeFetchedTelemetryGroups(groups, [{ groupId: 'truck-trip', points: [fullPoint] }])

  assert.equal(result[0].vehicleId, 'truck')
  assert.equal(result[0].profileContext.profileId, 'fmm00a')
  assert.deepEqual(result[0].points, [fullPoint])
  assert.deepEqual(result[1], groups[1])
})

test('summarizes unplotted fields by source and time without copying received values', () => {
  const groups = [
    { id: 'trip-a', deviceId: 17, points: [
      { timestamp: '2026-10-14T10:00:00Z', attributes: { vin: 'sensitive-value', state: true, packed: { bits: [1, 2] }, io30: 0, temperature: 21 } },
      { timestamp: '2026-10-14T10:05:00Z', attributes: { vin: 'another-sensitive-value', state: false, packed: null, io30: 0 } },
    ] },
    { id: 'trip-b', deviceId: 23, points: [
      { timestamp: '2026-10-15T12:00:00Z', attributes: { vin: 'third-sensitive-value' } },
    ] },
  ]

  assert.deepEqual(summarizeUnplottedTelemetryFields(groups, ['temperature'], ['state']), [
    { key: 'io30', sourceKey: 'device:17', deviceId: '17', groupId: 'trip-a', valueCount: 2, firstSeen: '2026-10-14T10:00:00.000Z', lastSeen: '2026-10-14T10:05:00.000Z', observedTypes: ['number'] },
    { key: 'packed', sourceKey: 'device:17', deviceId: '17', groupId: 'trip-a', valueCount: 2, firstSeen: '2026-10-14T10:00:00.000Z', lastSeen: '2026-10-14T10:05:00.000Z', observedTypes: ['empty', 'structured'] },
    { key: 'vin', sourceKey: 'device:17', deviceId: '17', groupId: 'trip-a', valueCount: 2, firstSeen: '2026-10-14T10:00:00.000Z', lastSeen: '2026-10-14T10:05:00.000Z', observedTypes: ['text'] },
    { key: 'vin', sourceKey: 'device:23', deviceId: '23', groupId: 'trip-b', valueCount: 1, firstSeen: '2026-10-15T12:00:00.000Z', lastSeen: '2026-10-15T12:00:00.000Z', observedTypes: ['text'] },
  ])

  assert.equal(JSON.stringify(summarizeUnplottedTelemetryFields(groups)).includes('sensitive-value'), false)
})

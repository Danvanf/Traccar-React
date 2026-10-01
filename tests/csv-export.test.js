import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRangeCsv, parseAppPositionCsv } from '../src/lib/csvExport.js'

test('app position export round trips into restorable points', () => {
  const timestamp = new Date('2026-09-29T15:00:00.000Z')
  const csv = buildRangeCsv({
    dayKey: '2026-09-29',
    deviceName: 'ODB2-1',
    points: [{
      timestamp,
      latitude: 39.92388,
      longitude: -83.89874,
      speed: 55 / 1.150779,
      course: 180,
      accuracy: 3.28084,
      altitude: 1000 / 3.28084,
      attributes: { ignition: true },
    }],
  })

  const parsed = parseAppPositionCsv([csv.headers, ...csv.rows].map((row) => row.join(',')).join('\n'), 5)
  assert.equal(parsed.format, 'traccar-react-positions-v1')
  assert.equal(parsed.rows.length, 1)
  assert.equal(parsed.rows[0].deviceId, 5)
  assert.equal(parsed.rows[0].latitude, 39.92388)
  assert.ok(Math.abs(parsed.rows[0].speed * 1.150779 - 55) < 0.01)
  assert.equal(parsed.rows[0].attributes.attr_ignition, 'true')
})

test('foreign CSV headers are rejected by app position detection', () => {
  const parsed = parseAppPositionCsv('Start Date/Time,End Date/Time\n09/29/2026,09/29/2026', 5)
  assert.equal(parsed.format, 'unknown')
  assert.equal(parsed.rows.length, 0)
})

test('exports can use Teltonika attribute IDs and translated headers round-trip', () => {
  const point = {
    timestamp: new Date('2026-09-29T15:00:00.000Z'),
    latitude: 39,
    longitude: -83,
    speed: 0,
    course: 0,
    accuracy: 0,
    altitude: 0,
    attributes: { io36: 1001, io40: 469 },
  }
  const profile = {
    getAttributeHeader: (key) => key === 'io40' ? 'Mass Air Flow (g/s) [attr_io40]' : 'Engine RPM (rpm) [attr_io36]',
    decodeAttributeValue: (key, value) => key === 'io40' ? (Number(value) / 100).toFixed(2) : value,
  }

  const raw = buildRangeCsv({ dayKey: '2026-09-29', deviceName: 'ODB2-1', points: [point], carProfile: profile, headerMode: 'teltonika' })
  assert.ok(raw.headers.includes('io36'))
  assert.ok(raw.headers.includes('io40'))

  const translated = buildRangeCsv({ dayKey: '2026-09-29', deviceName: 'ODB2-1', points: [point], carProfile: profile })
  const parsed = parseAppPositionCsv([translated.headers, ...translated.rows].map((row) => row.join(',')).join('\n'), 5)
  assert.equal(parsed.rows[0].attributes.io36, '1001')
  assert.equal(parsed.rows[0].attributes.io40, '4.69')
})

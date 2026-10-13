import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRangeCsv, buildTelemetryCsv, buildTrackMetadata, buildTrackTiming, buildTrackTimingCsv, parseAppPositionCsv } from '../src/lib/csvExport.js'
import { DEFAULT_PROFILE_DEFINITIONS, createCarProfile } from '../src/lib/carProfiles.js'

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
  assert.equal(parsed.rows[0].attributes.ignition, 'true')
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
  assert.equal(parsed.rows[0].attributes.io40, '469')
  assert.ok(translated.headers.includes('raw_attr_io40'))
})

test('metric range CSV round-trips GPS units and preserves raw attributes', () => {
  const timestamp = new Date('2026-09-29T15:00:00.000Z')
  const point = { timestamp, latitude: 39, longitude: -83, speed: 55 / 1.150779, course: 90, accuracy: 4, altitude: 120, attributes: { io50: 99 } }
  const profile = {
    getAttributeHeader: () => 'Barometric Pressure (kPa) [attr_io50]',
    getAttributeInfo: () => ({ units: 'kPa' }),
    decodeAttributeValue: (_key, value) => value,
  }
  const csv = buildRangeCsv({ dayKey: '2026-09-29', deviceName: 'FMM003', points: [point], carProfile: profile, unitSystem: 'metric' })
  assert.ok(csv.headers.includes('speedKph'))
  assert.ok(csv.headers.includes('accuracyM'))
  assert.ok(csv.headers.includes('altitudeM'))
  assert.ok(Math.abs(csv.rows[0][4] - 55 * 1.609344) < 0.01)
  const parsed = parseAppPositionCsv([csv.headers, ...csv.rows].map((row) => row.join(',')).join('\n'), 5)
  assert.ok(Math.abs(parsed.rows[0].speed * 1.150779 - 55) < 0.01)
  assert.equal(parsed.rows[0].accuracy, 4)
  assert.equal(parsed.rows[0].altitude, 120)
  assert.equal(parsed.rows[0].attributes.io50, '99')
})

test('telemetry export includes native timing, channel metadata, and quality status', () => {
  const start = new Date('2026-09-29T15:00:00.000Z')
  const profile = {
    getAttributeHeader: (key) => key === 'io40' ? 'Mass Air Flow (g/s) [attr_io40]' : 'Engine RPM (rpm) [attr_io36]',
    getAttributeInfo: (key) => key === 'io40' ? { units: 'g/s', sourceUnit: 'g/s', canonicalUnit: 'g/s', quantity: 'mass_flow', precision: 2, conversion: 'hundredthsToNumber', avlId: 40, sourceGroup: 'obd' } : { units: 'rpm', avlId: 36, sourceGroup: 'obd' },
    decodeAttributeValue: (key, value) => key === 'io40' ? (Number(value) / 100).toFixed(2) : value,
  }
  const exportData = buildTelemetryCsv({
    sessionStart: start,
    deviceName: 'Race Car',
    deviceId: 7,
    vehicleId: 'vehicle-7',
    vehicleVin: 'FALLBACKVIN',
    points: [
      { timestamp: start, latitude: 39, longitude: -83, speed: 0, course: 0, accuracy: 1, altitude: 2, attributes: { io40: 469, io36: 900 } },
      { timestamp: new Date(start.getTime() + 2000), latitude: 39.001, longitude: -83.001, speed: 10, course: 5, accuracy: 1, altitude: 2, attributes: { io40: 'bad' } },
    ],
    carProfile: profile,
  })
  assert.equal(exportData.metadata.schema, 'vehicle-telemetry-v1')
  assert.equal(exportData.metadata.vehicle.vin, 'FALLBACKVIN')
  assert.equal(exportData.rows[1][6], '2.000')
  assert.match(exportData.rows[1].at(-1), /io36.*missing/)
  assert.match(exportData.rows[1].at(-1), /io40.*invalid/)
  assert.equal(exportData.metadata.channels.find((channel) => channel.key === 'io40').source, 'OBD-II')
  assert.equal(exportData.metadata.channels.find((channel) => channel.key === 'io40').quantity, 'mass_flow')
  assert.equal(exportData.metadata.channels.find((channel) => channel.key === 'io40').sourceUnit, 'g/s')
  assert.equal(exportData.metadata.channels.find((channel) => channel.key === 'io40').valueRepresentation, 'profile-decoded')
  assert.match(exportData.metadata.telemetryValues, /profile-decoded values/)
  assert.equal(exportData.metadata.session.interpolation, 'none')
})

test('telemetry CSV values and metadata use the assigned profile and display units', () => {
  const timestamp = new Date('2026-10-07T15:00:00.000Z')
  const points = [{ timestamp, latitude: 40, longitude: -75, speed: 0, attributes: { io50: 99 } }]
  const definition = DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010']
  const imperialProfile = createCarProfile(definition, 'imperial')
  const metricProfile = createCarProfile(definition, 'metric')

  const imperial = buildTelemetryCsv({ sessionStart: timestamp, points, carProfile: imperialProfile })
  const imperialColumn = imperial.headers.indexOf(imperialProfile.getAttributeHeader('io50'))
  assert.equal(imperial.rows[0][imperialColumn], 29.234687625)
  assert.equal(imperial.metadata.channels.find((channel) => channel.key === 'io50').units, 'inHg')
  assert.equal(imperial.metadata.channels.find((channel) => channel.key === 'io50').sourceUnit, 'kPa')

  const metric = buildTelemetryCsv({ sessionStart: timestamp, points, carProfile: metricProfile })
  const metricColumn = metric.headers.indexOf(metricProfile.getAttributeHeader('io50'))
  assert.equal(metric.rows[0][metricColumn], 99)
  assert.equal(metric.metadata.channels.find((channel) => channel.key === 'io50').units, 'kPa')
})

test('track place events produce lap, split, and drag timing summaries', () => {
  const start = new Date('2026-09-29T15:00:00.000Z')
  const points = [
    { tripId: 'trip-1', timestamp: start, placeEvent: 'enter:track_start_finish:Line' },
    { tripId: 'trip-1', timestamp: new Date(start.getTime() + 5000), placeEvent: 'enter:track_split:Back Straight' },
    { tripId: 'trip-1', timestamp: new Date(start.getTime() + 7000), placeEvent: 'enter:track_split:Far Turn' },
    { tripId: 'trip-1', timestamp: new Date(start.getTime() + 10000), placeEvent: 'enter:track_start_finish:Line' },
    { tripId: 'trip-2', timestamp: new Date(start.getTime() + 20000), placeEvent: 'enter:drag_start:Staging' },
    { tripId: 'trip-2', timestamp: new Date(start.getTime() + 28000), placeEvent: 'enter:drag_finish:Finish' },
  ]
  const timing = buildTrackTiming(points)
  assert.equal(timing.laps[0].elapsedSeconds, 10)
  assert.equal(timing.lapSummary.bestElapsedSeconds, 10)
  assert.equal(timing.lapSummary.averageElapsedSeconds, 10)
  assert.equal(timing.splitPassages[0].place, 'Back Straight')
  assert.equal(timing.splitPassages[0].elapsedSincePreviousSeconds, null)
  assert.equal(timing.splitPassages[1].elapsedSincePreviousSeconds, 2)
  assert.equal(timing.dragRuns[0].elapsedSeconds, 8)
})

test('track timing export stays separate from telemetry records', () => {
  const trackCsv = buildTrackTimingCsv({
    deviceName: 'Race Car',
    sessionStart: new Date('2026-09-29T15:00:00.000Z'),
    timing: { laps: [{ tripId: 'trip-1', startPlace: 'Start', finishPlace: 'Finish', startUtc: '2026-09-29T15:00:00Z', finishUtc: '2026-09-29T15:05:00Z', elapsedSeconds: 300 }], dragRuns: [], splitPassages: [] },
  })
  assert.deepEqual(trackCsv.headers.slice(0, 2), ['event_type', 'trip_id'])
  assert.equal(trackCsv.rows[0][0], 'lap')
    assert.match(trackCsv.fileName, /vehicle-track-timing-race-car-2026-09-29\.csv/i)
})

test('track metadata reports route distances for laps and splits', () => {
  const start = new Date('2026-09-29T15:00:00.000Z')
  const points = [
    { tripId: 'trip-1', timestamp: start, latitude: 40, longitude: -75, placeEvent: 'enter:track_start:Road Course / Start' },
    { tripId: 'trip-1', timestamp: new Date(start.getTime() + 60000), latitude: 40.001, longitude: -75, placeEvent: 'enter:track_split:Road Course / Mid' },
    { tripId: 'trip-1', timestamp: new Date(start.getTime() + 120000), latitude: 40.002, longitude: -75, placeEvent: 'enter:track_finish:Road Course / Finish' },
  ]
  const timing = buildTrackTiming(points)
  const metadata = buildTrackMetadata({ points, timing, deviceName: 'Race Car', sessionStart: start })
  assert.equal(metadata.schema, 'vehicle-track-metadata-v1')
  assert.equal(metadata.laps.length, 1)
  assert.ok(metadata.laps[0].distanceMeters > 200)
  assert.ok(metadata.splitPassages[0].distanceFromPreviousMeters > 100)
  assert.ok(metadata.splitPassages[0].distanceToNextMeters > 100)
  assert.equal(metadata.segments.length, 2)
})

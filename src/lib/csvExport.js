import { translateAttribute } from './carProfiles.js'

function escapeCsv(value) {
  if (value === null || value === undefined) {
    return ''
  }

  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

function sanitizeFileNamePart(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function formatLocalTimestamp(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function buildCsvText({ headers, rows }) {
  const csvLines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ]
  return csvLines.join('\n')
}

export function downloadTextFile({ fileName, contents, type = 'application/octet-stream' }) {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsvFile({ fileName, headers, rows }) {
  downloadTextFile({ fileName, contents: buildCsvText({ headers, rows }), type: 'text/csv;charset=utf-8;' })
}

export function downloadJsonFile({ fileName, value }) {
  downloadTextFile({ fileName, contents: JSON.stringify(value, null, 2), type: 'application/json;charset=utf-8;' })
}

function metersToFeet(value) {
  const n = Number(value)
  return Number.isFinite(n) ? (n * 3.28084).toFixed(2) : ''
}

export function buildRangeCsv({ dayKey, deviceName, points, carProfile, profileForPoint = null, headerMode = 'translated', unitSystem = carProfile?.unitSystem || 'imperial' }) {
  const metric = unitSystem === 'metric'
  const headerProfile = points.length > 0 ? profileForPoint?.(points[0]) || carProfile : carProfile
  const attributeKeys = new Set()

  points.forEach((point) => {
    const attrs = point.attributes || {}
    Object.keys(attrs).forEach((key) => attributeKeys.add(key))
  })

  const sortedAttributeKeys = [...attributeKeys].sort((a, b) => a.localeCompare(b))

  const headers = [
    'timestampIso',
    'timestampLocal',
    'latitude',
    'longitude',
    metric ? 'speedKph' : 'speedMph',
    'headingDeg',
    metric ? 'accuracyM' : 'accuracyFt',
    metric ? 'altitudeM' : 'altitudeFt',
    ...sortedAttributeKeys.map((key) => {
      if (headerMode === 'teltonika') return key
      if (headerProfile) return headerProfile.getAttributeHeader(key)
      return `attr_${key}`
    }),
    ...(headerMode === 'teltonika' ? [] : sortedAttributeKeys.map((key) => `raw_attr_${key}`)),
  ]

  const rows = points.map((point) => {
    const attrs = point.attributes || {}
    const speedKnots = Number(point.speed || 0)
    const pointProfile = profileForPoint?.(point) || carProfile

    return [
      point.timestamp.toISOString(),
      formatLocalTimestamp(point.timestamp),
      point.latitude,
      point.longitude,
      (speedKnots * (metric ? 1.852 : 1.150779)).toFixed(2),
      point.course ?? '',
      metric ? (Number.isFinite(Number(point.accuracy)) ? Number(point.accuracy).toFixed(2) : '') : metersToFeet(point.accuracy),
      metric ? (Number.isFinite(Number(point.altitude)) ? Number(point.altitude).toFixed(2) : '') : metersToFeet(point.altitude),
      ...sortedAttributeKeys.map((key) => {
        const raw = attrs[key] ?? ''
        return headerMode === 'teltonika' || !pointProfile
          ? raw
          : translateAttribute(pointProfile, key, raw).value
      }),
      ...(headerMode === 'teltonika' ? [] : sortedAttributeKeys.map((key) => attrs[key] ?? '')),
    ]
  })

  const safeDevice = sanitizeFileNamePart(deviceName || 'device')
  const safeDay = sanitizeFileNamePart(dayKey)
  const fileName = `traccar-${safeDevice}-range-${safeDay}.csv`

  return { headers, rows, fileName }
}

function channelSource(key, carProfile) {
  if (key === 'latitude' || key === 'longitude' || key === 'speed' || key === 'course' || key === 'altitude' || key === 'accuracy') return 'GPS'
  const sourceGroup = translateAttribute(carProfile, key, undefined).source.group
  if (sourceGroup === 'obd') return 'OBD-II'
  if (sourceGroup === 'obd-oem') return 'manufacturer-specific PID'
  if (key === 'speedMph' || key === '__speedMph') return 'derived'
  return sourceGroup ? 'tracker' : 'unknown'
}

function attributeValue(point, key, carProfile) {
  const raw = point.attributes?.[key]
  const translated = translateAttribute(carProfile, key, raw)
  if (['missing', 'sentinel', 'invalid'].includes(translated.status)) return { value: '', status: translated.status, raw }
  if (typeof translated.value === 'boolean') return { value: translated.value, status: 'valid', raw }
  const numeric = Number(translated.value)
  if (Number.isFinite(numeric)) return { value: numeric, status: 'valid', raw }
  return { value: '', status: 'invalid', raw }
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function safeFileNamePart(value) {
  return sanitizeFileNamePart(value || 'device') || 'device'
}

function parsePlaceEvent(value) {
  const match = String(value || '').match(/^(enter|exit):([^:]+):(.*)$/)
  return match ? { direction: match[1], role: match[2], name: match[3] } : null
}

export function buildTrackTiming(points) {
  const orderedPoints = [...points].sort((a, b) => a.timestamp - b.timestamp)
  const openStarts = new Map()
  const openDragRuns = new Map()
  const laps = []
  const dragRuns = []
  const splitPassages = []
  const previousSplitByTrip = new Map()
  orderedPoints.forEach((point) => {
    String(point.placeEvent || '').split(';').map((event) => parsePlaceEvent(event.trim())).filter(Boolean).forEach((event) => {
      const key = point.tripId || ''
      if (event.direction !== 'enter') return
      if (event.role === 'track_split') {
        const tripKey = point.tripId || ''
        const previous = previousSplitByTrip.get(tripKey)
        splitPassages.push({ tripId: point.tripId || null, place: event.name, timestampUtc: point.timestamp.toISOString(), elapsedSincePreviousSeconds: previous ? Math.max(0, (point.timestamp - previous) / 1000) : null })
        previousSplitByTrip.set(tripKey, point.timestamp)
      }
      if (event.role === 'drag_start') {
        openDragRuns.set(point.tripId || '', { tripId: point.tripId || null, startPlace: event.name, startUtc: point.timestamp.toISOString(), startTimestamp: point.timestamp })
      }
      if (event.role === 'drag_finish') {
        const start = openDragRuns.get(point.tripId || '')
        if (start) {
          dragRuns.push({ tripId: start.tripId, startPlace: start.startPlace, finishPlace: event.name, startUtc: start.startUtc, finishUtc: point.timestamp.toISOString(), elapsedSeconds: Math.max(0, (point.timestamp - start.startTimestamp) / 1000) })
          openDragRuns.delete(point.tripId || '')
        }
      }
      if (event.role === 'track_start' || event.role === 'track_start_finish') {
        const previous = openStarts.get(key)
        if (previous) {
          laps.push({ tripId: previous.tripId, startPlace: previous.place, startUtc: previous.timestamp.toISOString(), finishPlace: event.name, finishUtc: point.timestamp.toISOString(), elapsedSeconds: Math.max(0, (point.timestamp - previous.timestamp) / 1000) })
        }
        openStarts.set(key, { tripId: point.tripId || null, place: event.name, timestamp: point.timestamp })
      }
      if (event.role === 'track_finish') {
        const start = openStarts.get(key)
        if (start) {
          laps.push({ tripId: start.tripId, startPlace: start.place, startUtc: start.timestamp.toISOString(), finishPlace: event.name, finishUtc: point.timestamp.toISOString(), elapsedSeconds: Math.max(0, (point.timestamp - start.timestamp) / 1000) })
          openStarts.delete(key)
        }
      }
    })
  })
  const summarize = (items) => {
    const durations = items.map((item) => Number(item.elapsedSeconds)).filter(Number.isFinite)
    return {
      count: durations.length,
      bestElapsedSeconds: durations.length ? Math.min(...durations) : null,
      averageElapsedSeconds: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    }
  }
  return { laps, dragRuns, splitPassages, lapSummary: summarize(laps), dragRunSummary: summarize(dragRuns) }
}

function distanceMetersBetween(latitudeA, longitudeA, latitudeB, longitudeB) {
  if (![latitudeA, longitudeA, latitudeB, longitudeB].every((value) => Number.isFinite(Number(value)))) return null
  const earthRadius = 6371000
  const toRadians = (value) => (value * Math.PI) / 180
  const dLat = toRadians(Number(latitudeB) - Number(latitudeA))
  const dLon = toRadians(Number(longitudeB) - Number(longitudeA))
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(Number(latitudeA))) * Math.cos(toRadians(Number(latitudeB))) * Math.sin(dLon / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const TRACK_ROLES = new Set(['track_start', 'track_finish', 'track_start_finish', 'track_split', 'track_other', 'drag_start', 'drag_finish'])

function trackPassageName(value) {
  const text = String(value || '')
  const separator = text.indexOf(' / ')
  return separator >= 0 ? { trackName: text.slice(0, separator), placeName: text.slice(separator + 3) } : { trackName: null, placeName: text }
}

function distanceForTimingItem(item, passages) {
  const start = passages.find((passage) => (passage.label === item.startPlace || passage.placeName === item.startPlace) && passage.timestampUtc === item.startUtc)
  const finish = passages.find((passage) => (passage.label === item.finishPlace || passage.placeName === item.finishPlace) && passage.timestampUtc === item.finishUtc)
  if (!start || !finish || start.tripId !== finish.tripId || !Number.isFinite(start.routeDistanceMeters) || !Number.isFinite(finish.routeDistanceMeters)) return null
  return Math.max(0, finish.routeDistanceMeters - start.routeDistanceMeters)
}

// Builds route-aware metadata for the track-only export. Distances follow the
// recorded GPS route; if either boundary lacks usable GPS, the distance is null.
export function buildTrackMetadata({ points, timing, deviceName, sessionStart, vehicleId = null, deviceId = null }) {
  const orderedPoints = [...(points || [])].sort((a, b) => a.timestamp - b.timestamp)
  const cumulativeByTrip = new Map()
  const previousByTrip = new Map()
  const passages = []
  orderedPoints.forEach((point) => {
    const tripId = point.tripId || ''
    const previous = previousByTrip.get(tripId)
    let routeDistanceMeters = cumulativeByTrip.get(tripId) || 0
    const segmentDistance = previous ? distanceMetersBetween(previous.latitude, previous.longitude, point.latitude, point.longitude) : null
    if (Number.isFinite(segmentDistance)) routeDistanceMeters += segmentDistance
    cumulativeByTrip.set(tripId, routeDistanceMeters)
    if (Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude))) previousByTrip.set(tripId, { latitude: Number(point.latitude), longitude: Number(point.longitude) })
    else previousByTrip.set(tripId, null)
    String(point.placeEvent || '').split(';').map((event) => parsePlaceEvent(event.trim())).filter((event) => event && event.direction === 'enter' && TRACK_ROLES.has(event.role)).forEach((event) => {
      const names = trackPassageName(event.name)
      passages.push({ tripId: point.tripId || null, role: event.role, label: event.name, trackName: names.trackName, placeName: names.placeName, timestampUtc: point.timestamp.toISOString(), latitude: Number.isFinite(Number(point.latitude)) ? Number(point.latitude) : null, longitude: Number.isFinite(Number(point.longitude)) ? Number(point.longitude) : null, routeDistanceMeters: Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)) ? routeDistanceMeters : null })
    })
  })
  const byTrip = new Map()
  passages.forEach((passage) => byTrip.set(passage.tripId || '', [...(byTrip.get(passage.tripId || '') || []), passage]))
  const segments = [...byTrip.entries()].flatMap(([tripId, tripPassages]) => tripPassages.slice(1).map((to, index) => {
    const from = tripPassages[index]
    const distance = Number.isFinite(from.routeDistanceMeters) && Number.isFinite(to.routeDistanceMeters) ? Math.max(0, to.routeDistanceMeters - from.routeDistanceMeters) : null
    return { tripId: tripId || null, from: { role: from.role, trackName: from.trackName, placeName: from.placeName, timestampUtc: from.timestampUtc }, to: { role: to.role, trackName: to.trackName, placeName: to.placeName, timestampUtc: to.timestampUtc }, distanceMeters: distance, distanceMiles: Number.isFinite(distance) ? distance / 1609.344 : null }
  }))
  const splitPassages = (timing?.splitPassages || []).map((split) => {
    const passage = passages.find((item) => (item.label === split.place || item.placeName === trackPassageName(split.place).placeName) && item.timestampUtc === split.timestampUtc)
    const tripPassages = passage ? byTrip.get(passage.tripId || '') || [] : []
    const index = passage ? tripPassages.indexOf(passage) : -1
    const previous = index > 0 ? tripPassages[index - 1] : null
    const next = index >= 0 ? tripPassages[index + 1] || null : null
    const fromDistance = previous && Number.isFinite(previous.routeDistanceMeters) && Number.isFinite(passage?.routeDistanceMeters) ? Math.max(0, passage.routeDistanceMeters - previous.routeDistanceMeters) : null
    const toDistance = next && Number.isFinite(next.routeDistanceMeters) && Number.isFinite(passage?.routeDistanceMeters) ? Math.max(0, next.routeDistanceMeters - passage.routeDistanceMeters) : null
    return { ...split, distanceFromPreviousMeters: fromDistance, distanceFromPreviousMiles: Number.isFinite(fromDistance) ? fromDistance / 1609.344 : null, distanceToNextMeters: toDistance, distanceToNextMiles: Number.isFinite(toDistance) ? toDistance / 1609.344 : null }
  })
  const laps = (timing?.laps || []).map((lap) => ({ ...lap, distanceMeters: distanceForTimingItem(lap, passages), distanceMiles: Number.isFinite(distanceForTimingItem(lap, passages)) ? distanceForTimingItem(lap, passages) / 1609.344 : null }))
  const dragRuns = (timing?.dragRuns || []).map((run) => ({ ...run, distanceMeters: distanceForTimingItem(run, passages), distanceMiles: Number.isFinite(distanceForTimingItem(run, passages)) ? distanceForTimingItem(run, passages) / 1609.344 : null }))
  const date = sessionStart instanceof Date ? sessionStart : new Date(sessionStart || Date.now())
  return { schema: 'vehicle-track-metadata-v1', session: { startUtc: date.toISOString(), endUtc: orderedPoints.at(-1)?.timestamp?.toISOString() || date.toISOString(), distanceMethod: 'cumulative recorded GPS route; no interpolation or straight-line fallback', distanceUnit: 'meters', distanceUnitImperial: 'miles' }, vehicle: { id: vehicleId, deviceId, name: deviceName || null }, passages, segments, laps, dragRuns, splitPassages }
}

// Maintenance note: if this track-only export changes, check buildTelemetryCsv
// and buildTrackMetadata/TelemetryGraphViewer.exportGraphTelemetry for shared GPS/session behavior.
export function buildTrackTimingCsv({ timing, deviceName, sessionStart }) {
  const headers = ['event_type', 'trip_id', 'start_place', 'finish_place', 'place', 'start_utc', 'finish_utc', 'timestamp_utc', 'elapsed_s', 'elapsed_since_previous_split_s']
  const rows = []
  ;(timing?.laps || []).forEach((lap) => rows.push(['lap', lap.tripId ?? '', lap.startPlace ?? '', lap.finishPlace ?? '', '', lap.startUtc ?? '', lap.finishUtc ?? '', '', Number(lap.elapsedSeconds).toFixed(3), '']))
  ;(timing?.dragRuns || []).forEach((run) => rows.push(['drag_run', run.tripId ?? '', run.startPlace ?? '', run.finishPlace ?? '', '', run.startUtc ?? '', run.finishUtc ?? '', '', Number(run.elapsedSeconds).toFixed(3), '']))
  ;(timing?.splitPassages || []).forEach((split) => rows.push(['split', split.tripId ?? '', '', '', split.place ?? '', '', '', split.timestampUtc ?? '', '', Number.isFinite(split.elapsedSincePreviousSeconds) ? Number(split.elapsedSincePreviousSeconds).toFixed(3) : '']))
  const date = sessionStart instanceof Date ? sessionStart : new Date(sessionStart || Date.now())
  const safeName = safeFileNamePart(deviceName)
  return { headers, rows, fileName: `vehicle-track-timing-${safeName}-${date.toISOString().slice(0, 10)}.csv` }
}

/**
 * Builds a race-oriented native-sample CSV. Values are never interpolated;
 * blank cells mean no value was present at that recorded position timestamp.
 * The quality_json column identifies missing and invalid channel values.
 * Maintenance note: changes to this telemetry export should be checked against
 * buildTrackTimingCsv and the graph export route; track and telemetry exports
 * intentionally use different data subsets but share session and GPS context.
 */
export function buildTelemetryCsv({ sessionStart, deviceName, points, carProfile, vehicleId, deviceId, vehicleVin, deviceVin, channelKeys, appVersion = 'vehicle-app-react' }) {
  const orderedPoints = [...points].sort((a, b) => a.timestamp - b.timestamp)
  const availableKeys = [...new Set(orderedPoints.flatMap((point) => Object.keys(point.attributes || {})))]
  const attributeKeys = (channelKeys ? channelKeys.filter((key) => availableKeys.includes(key)) : availableKeys).sort((a, b) => a.localeCompare(b))
  const start = sessionStart || orderedPoints[0]?.timestamp || new Date()
  const metric = carProfile?.unitSystem === 'metric'
  const headers = ['vehicle_id', 'device_id', 'trip_id', 'session_start_utc', 'timestamp_utc', 'timestamp_local', 'elapsed_s', 'latitude', 'longitude', metric ? 'gps_speed_kph' : 'gps_speed_mph', 'heading_deg', metric ? 'altitude_m' : 'altitude_ft', metric ? 'accuracy_m' : 'accuracy_ft', 'gps_match', 'gps_delta_s', 'place_name', 'place_track', 'place_role', 'place_event', ...attributeKeys.map((key) => carProfile?.getAttributeHeader?.(key) || `attr_${key}`), 'quality_json']
  const rows = orderedPoints.map((point) => {
    const qualities = {}
    const values = attributeKeys.map((key) => {
      const result = attributeValue(point, key, carProfile)
      if (result.status !== 'valid') qualities[key] = result.status
      return result.value
    })
    if (!Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude))) qualities.gps = 'missing'
    return [vehicleId ?? '', deviceId ?? '', point.tripId ?? '', start.toISOString(), point.timestamp.toISOString(), formatLocalTimestamp(point.timestamp), ((point.timestamp - start) / 1000).toFixed(3), point.latitude ?? '', point.longitude ?? '', Number.isFinite(Number(point.speed)) ? (Number(point.speed) * (metric ? 1.852 : 1.150779)).toFixed(3) : '', point.course ?? '', metric ? (Number.isFinite(Number(point.altitude)) ? Number(point.altitude).toFixed(3) : '') : metersToFeet(point.altitude), metric ? (Number.isFinite(Number(point.accuracy)) ? Number(point.accuracy).toFixed(3) : '') : metersToFeet(point.accuracy), point.gpsMatch || (point.latitude || point.longitude ? 'embedded' : 'missing'), point.gpsDeltaSeconds ?? '', point.placeName ?? '', point.placeTrack ?? '', point.placeRole ?? '', point.placeEvent ?? '', ...values, JSON.stringify(qualities)]
  })
  const fileName = `vehicle-telemetry-${safeFileNamePart(deviceName)}-${start.toISOString().slice(0, 10)}.csv`
  const metadata = buildTelemetryMetadata({ sessionStart: start, deviceName, points: orderedPoints, carProfile, vehicleId, deviceId, vehicleVin, deviceVin, channelKeys: attributeKeys, appVersion })
  return { headers, rows, fileName, metadata }
}

export function buildTelemetryMetadata({ sessionStart, deviceName, points, carProfile, vehicleId, deviceId, vehicleVin, deviceVin, channelKeys, appVersion = 'vehicle-app-react' }) {
  const orderedPoints = [...points].sort((a, b) => a.timestamp - b.timestamp)
  const start = sessionStart || orderedPoints[0]?.timestamp || new Date()
  const availableKeys = [...new Set(orderedPoints.flatMap((point) => Object.keys(point.attributes || {})))]
  const selectedKeys = (channelKeys ? channelKeys.filter((key) => availableKeys.includes(key)) : availableKeys).sort((a, b) => a.localeCompare(b))
  const trackTiming = buildTrackTiming(orderedPoints)
  const channels = selectedKeys.map((key) => {
    const samples = orderedPoints.filter((point) => point.attributes?.[key] !== undefined && point.attributes?.[key] !== null && point.attributes?.[key] !== '')
    const validSamples = samples.filter((point) => attributeValue(point, key, carProfile).status === 'valid')
    const intervals = samples.slice(1).map((point, index) => (point.timestamp - samples[index].timestamp) / 1000).filter((value) => value >= 0)
    const info = carProfile?.getAttributeInfo?.(key)
    return {
      key,
      name: carProfile?.getAttributeHeader?.(key) || key,
      units: carProfile?.getAttributeUnit?.(key) || info?.units || null,
      sourceUnit: info?.sourceUnit || null,
      canonicalUnit: info?.canonicalUnit || null,
        canonicalScale: Number.isFinite(info?.canonicalScale) ? info.canonicalScale : null,
        canonicalOffset: Number.isFinite(info?.canonicalOffset) ? info.canonicalOffset : null,
      quantity: info?.quantity || null,
      conversion: info?.conversion || null,
      precision: Number.isInteger(info?.precision) ? info.precision : null,
      valueRepresentation: info ? 'profile-decoded' : 'raw-unmapped',
      source: channelSource(key, carProfile),
      avlId: info?.avlId ?? null,
      samples: samples.length,
      validSamples: validSamples.length,
      invalidSamples: samples.length - validSamples.length,
      medianIntervalSeconds: median(intervals),
      firstSampleUtc: samples[0]?.timestamp?.toISOString() || null,
      lastSampleUtc: samples.at(-1)?.timestamp?.toISOString() || null,
      interpolation: 'none',
    }
  })
  return {
    schema: 'vehicle-telemetry-v1',
    session: {
      startUtc: start.toISOString(),
      endUtc: orderedPoints.at(-1)?.timestamp?.toISOString() || start.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      displayUnits: carProfile?.unitSystem || 'imperial',
      gpsUnits: carProfile?.unitSystem === 'metric' ? { speed: 'km/h', altitude: 'm', accuracy: 'm' } : { speed: 'mph', altitude: 'ft', accuracy: 'ft' },
      pointCount: orderedPoints.length,
      interpolation: 'none',
      gpsJoin: 'trip_id + timestamp_utc; nearest native GPS position is used only during export',
    },
    vehicle: { id: vehicleId ?? null, name: deviceName || null, vin: deviceVin || vehicleVin || null },
    device: { id: deviceId ?? null, name: deviceName || null, vin: deviceVin || null },
    application: { name: 'Vehicle App', version: appVersion },
    channels,
    placeMarkers: { source: 'VehicleApp named places', eventValues: 'enter or exit with place role and name; repeated track_start_finish or track_split entries can be used as lap/run boundaries' },
    trackTiming,
    quality: { missingValues: 'blank cell plus quality_json status', invalidValues: 'blank cell plus quality_json status', unsupportedValues: 'channel omitted when not measured' },
    telemetryValues: 'CSV attribute cells contain profile-decoded values; profile sourceUnit and conversion metadata describe the mapping when present. Unmapped attributes retain their raw values.',
  }
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < String(text || '').length; index += 1) {
    const character = text[index]
    const next = text[index + 1]
    if (quoted) {
      if (character === '"' && next === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        value += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(value)
      value = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && next === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }

  if (value !== '' || row.length > 0) {
    row.push(value)
    if (row.some((cell) => cell !== '')) rows.push(row)
  }

  if (rows.length === 0) return { headers: [], rows: [] }
  const headers = rows[0].map((header, index) => {
    const normalized = String(header || '').trim()
    return index === 0 ? normalized.replace(/^\uFEFF/, '') : normalized
  })
  return { headers, rows: rows.slice(1).map((cells) => headers.map((_, index) => cells[index] ?? '')) }
}

function numberOrNull(value) {
  if (value == null || String(value).trim() === '') return null
  const number = Number(String(value).trim())
  return Number.isFinite(number) ? number : null
}

/**
 * Reads the CSV produced by buildRangeCsv. This restores raw positions into
 * the current session; the caller supplies the target Traccar device because
 * the spreadsheet export intentionally does not embed a database device id.
 */
export function parseAppPositionCsv(text, deviceId) {
  const parsed = parseCsv(text)
  const required = ['timestampIso', 'latitude', 'longitude', 'headingDeg']
  const headerSet = new Set(parsed.headers)
  const imperial = ['speedMph', 'accuracyFt', 'altitudeFt'].every((header) => headerSet.has(header))
  const metric = ['speedKph', 'accuracyM', 'altitudeM'].every((header) => headerSet.has(header))
  if (!required.every((header) => headerSet.has(header)) || (!imperial && !metric)) {
    return { rows: [], format: 'unknown', error: 'This file is not a Traccar React position export.' }
  }
  const gpsHeaders = new Set([...required, 'timestampLocal', 'speedMph', 'speedKph', 'accuracyFt', 'accuracyM', 'altitudeFt', 'altitudeM'])

  const rows = parsed.rows.map((cells) => {
    const source = Object.fromEntries(parsed.headers.map((header, index) => [header, cells[index]]))
    const timestamp = new Date(source.timestampIso)
    const latitude = numberOrNull(source.latitude)
    const longitude = numberOrNull(source.longitude)
    if (Number.isNaN(timestamp.getTime()) || latitude == null || longitude == null) return null

    const attributes = {}
    parsed.headers
      .filter((header) => !gpsHeaders.has(header))
      .forEach((header) => {
        if (source[header] !== '') {
          // Human-readable exports retain the original attribute key in
          // brackets (for example, "Mass Air Flow (g/s) [attr_io40]").
          // Restore that key so translated exports remain round-trippable.
          const rawKey = header.match(/^(?:raw_attr_|attr_)(.+)$/)?.[1] || header.match(/\[(?:attr_)?([^\]]+)\]$/)?.[1] || header
          if (!header.startsWith('raw_attr_') && Object.hasOwn(attributes, rawKey)) return
          attributes[rawKey] = source[header]
        }
      })

    return {
      positionId: null,
      deviceId: Number(deviceId),
      latitude,
      longitude,
      timestamp,
      // Traccar stores speed in knots; exports may display either system.
      speed: (imperial ? (numberOrNull(source.speedMph) || 0) / 1.150779 : (numberOrNull(source.speedKph) || 0) / 1.852),
      course: numberOrNull(source.headingDeg),
      accuracy: imperial ? (numberOrNull(source.accuracyFt) || 0) / 3.28084 : (numberOrNull(source.accuracyM) || 0),
      altitude: imperial ? (numberOrNull(source.altitudeFt) || 0) / 3.28084 : (numberOrNull(source.altitudeM) || 0),
      attributes,
    }
  }).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp)

  return { rows, format: 'traccar-react-positions-v1' }
}

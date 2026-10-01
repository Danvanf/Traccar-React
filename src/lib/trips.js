import { metersBetween } from './geo.js'

function localDayKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const TRIP_GAP_MS = 10 * 60 * 1000
const STATIONARY_NOISE_DISTANCE_M = 400

function ignitionOff(point) {
  const attributes = point?.attributes || {}
  const value = Object.entries(attributes).find(([key]) => /^(ignition|ignitionOn|engineOn)$/i.test(key))?.[1]
  return value === false || value === 0 || String(value).toLowerCase() === 'off'
}

function likelyStationaryNoise(trip) {
  if (!Array.isArray(trip.points) || trip.points.length < 2 || trip.distance >= STATIONARY_NOISE_DISTANCE_M) return false
  const offCount = trip.points.filter((point) => ignitionOff({ attributes: point?.[2]?.attributes })).length
  if (offCount < Math.ceil(trip.points.length / 2)) return false
  const maxSpeedMph = getTripMaxSpeedMph(trip)
  return maxSpeedMph == null || maxSpeedMph <= 5
}

export function buildTripsForDevice(deviceId, points, movementThresholdM) {
  if (!Array.isArray(points) || points.length < 2) {
    return []
  }

  const moveEvents = []

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const curr = points[i]
    const dist = metersBetween(prev.latitude, prev.longitude, curr.latitude, curr.longitude)

    if (dist > movementThresholdM) {
      moveEvents.push({
        startTraccarPositionId: prev.positionId ?? null,
        endTraccarPositionId: curr.positionId ?? null,
        startLatitude: prev.latitude,
        startLongitude: prev.longitude,
        endLatitude: curr.latitude,
        endLongitude: curr.longitude,
        start: prev.timestamp,
        end: curr.timestamp,
        distance: dist,
        points: [
          [prev.latitude, prev.longitude, { timestamp: prev.timestamp, speedMph: Number(prev.speed || 0) * 1.15078, course: prev.course, attributes: prev.attributes || {} }],
          [curr.latitude, curr.longitude, { timestamp: curr.timestamp, speedMph: Number(curr.speed || 0) * 1.15078, course: curr.course, attributes: curr.attributes || {} }],
        ],
      })
    }
  }

  if (moveEvents.length === 0) {
    return []
  }

  const trips = []
  let active = {
    ...moveEvents[0],
    tripId: `${deviceId}-${moveEvents[0].start.getTime()}`,
  }

  for (let i = 1; i < moveEvents.length; i += 1) {
    const event = moveEvents[i]
    const gap = event.start.getTime() - active.end.getTime()

    if (gap <= TRIP_GAP_MS) {
      active.end = event.end
      active.endTraccarPositionId = event.endTraccarPositionId
      active.endLatitude = event.endLatitude
      active.endLongitude = event.endLongitude
      active.distance += event.distance
      active.points.push(...event.points)
    } else {
      trips.push(active)
      active = {
        ...event,
        tripId: `${deviceId}-${event.start.getTime()}`,
      }
    }
  }

  trips.push(active)

  return trips.filter((trip) => !likelyStationaryNoise(trip)).map((trip) => ({
    ...trip,
    deviceId,
    dayKey: localDayKey(trip.start),
  }))
}

export function getTripMaxSpeedMph(trip) {
  const speeds = (Array.isArray(trip?.points) ? trip.points : [])
    .map((point) => {
      const metadata = point?.[2] || {}
      if (Number.isFinite(Number(metadata.speedMph))) return Number(metadata.speedMph)
      return Number.isFinite(Number(metadata.speed)) ? Number(metadata.speed) * 1.15078 : NaN
    })
    .filter(Number.isFinite)
  return speeds.length > 0 ? Math.max(...speeds) : null
}

export function summarizeTripsByDay(trips) {
  const map = new Map()

  trips.forEach((trip) => {
    const existing = map.get(trip.dayKey) || {
      dayKey: trip.dayKey,
      tripCount: 0,
      distanceM: 0,
    }

    existing.tripCount += 1
    existing.distanceM += trip.distance
    map.set(trip.dayKey, existing)
  })

  return [...map.values()].sort((a, b) => b.dayKey.localeCompare(a.dayKey))
}

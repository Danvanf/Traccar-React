import { metersBetween } from './geo.js'

function localDayKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const TRIP_GAP_MS = 10 * 60 * 1000
const STATIONARY_NOISE_DISTANCE_M = 400

function ignitionState(point) {
  const attributes = point?.attributes || {}
  const value = Object.entries(attributes).find(([key]) => /^(ignition|ignitionOn|engineOn)$/i.test(key))?.[1]
  if (value === true || value === 1 || ['true', '1', 'on'].includes(String(value).toLowerCase())) return true
  if (value === false || value === 0 || ['false', '0', 'off'].includes(String(value).toLowerCase())) return false
  return null
}

function likelyStationaryNoise(trip) {
  if (!Array.isArray(trip.points) || trip.points.length < 2 || trip.distance >= STATIONARY_NOISE_DISTANCE_M) return false
  const offCount = trip.points.filter((point) => ignitionState({ attributes: point?.[2]?.attributes }) === false).length
  if (offCount < Math.ceil(trip.points.length / 2)) return false
  const maxSpeedMph = getTripMaxSpeedMph(trip)
  return maxSpeedMph == null || maxSpeedMph <= 5
}

export function buildTripsForDevice(deviceId, points, movementThresholdM) {
  if (!Array.isArray(points) || points.length < 2) {
    return []
  }

  const orderedPoints = [...points].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  const ignitionStates = orderedPoints.map(ignitionState)
  const knownIgnitionSamples = ignitionStates.filter((state) => state !== null).length
  if (knownIgnitionSamples >= 2 && ignitionStates.includes(true)) {
    const trips = []
    let activePoints = []
    const finishTrip = () => {
      if (activePoints.length < 2) { activePoints = []; return }
      const first = activePoints[0]
      const last = activePoints.at(-1)
      if (last.timestamp <= first.timestamp) { activePoints = []; return }
      let distance = 0
      for (let index = 1; index < activePoints.length; index += 1) {
        const previous = activePoints[index - 1]
        const current = activePoints[index]
        const segmentDistance = metersBetween(previous.latitude, previous.longitude, current.latitude, current.longitude)
        if (segmentDistance > movementThresholdM) distance += segmentDistance
      }
      const pointsForTrip = activePoints.map((point) => [point.latitude, point.longitude, {
        timestamp: point.timestamp,
        speedMph: Number(point.speed || 0) * 1.15078,
        course: point.course,
        attributes: point.attributes || {},
      }])
      trips.push({
        tripId: `${deviceId}-${first.timestamp.getTime()}`,
        startTraccarPositionId: first.positionId ?? null,
        endTraccarPositionId: last.positionId ?? null,
        startLatitude: first.latitude,
        startLongitude: first.longitude,
        endLatitude: last.latitude,
        endLongitude: last.longitude,
        start: first.timestamp,
        end: last.timestamp,
        distance,
        points: pointsForTrip,
      })
      activePoints = []
    }

    orderedPoints.forEach((point, index) => {
      const state = ignitionStates[index]
      if (!activePoints.length) {
        if (state === true) activePoints = [point]
        return
      }
      activePoints.push(point)
      if (state === false) finishTrip()
    })
    finishTrip()
    return trips.map((trip) => ({ ...trip, deviceId, dayKey: localDayKey(trip.start) }))
  }

  const moveEvents = []

  for (let i = 1; i < orderedPoints.length; i += 1) {
    const prev = orderedPoints[i - 1]
    const curr = orderedPoints[i]
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

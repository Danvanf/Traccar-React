export const DEFAULT_EVENT_THRESHOLDS = {
  hard_braking: { value: -3.5, unit: 'm/s²' },
  hard_acceleration: { value: 3.5, unit: 'm/s²' },
  maximum_speed: { value: 70, unit: 'mph' },
  long_idle: { value: 300, unit: 'seconds' },
}

export function resolveEventThresholds({ global = {}, system = {}, vehicle = {} } = {}) {
  const eventTypes = new Set([
    ...Object.keys(DEFAULT_EVENT_THRESHOLDS),
    ...Object.keys(global),
    ...Object.keys(system),
    ...Object.keys(vehicle),
  ])
  return Object.fromEntries([...eventTypes].map((eventType) => [
    eventType,
    vehicle[eventType] || system[eventType] || global[eventType] || DEFAULT_EVENT_THRESHOLDS[eventType],
  ]))
}

function resolvedThreshold(eventType, thresholds = {}) {
  return thresholds[eventType] || DEFAULT_EVENT_THRESHOLDS[eventType]
}

function firstNumber(attributes, keys) {
  for (const key of keys) {
    const value = Number(attributes?.[key])
    if (Number.isFinite(value)) return value
  }
  return null
}

export function normalizePointTelemetry(point) {
  const metadata = point?.[2] || {}
  const attributes = metadata.attributes || {}
  const accelerationMps2 = Number.isFinite(Number(metadata.accelerationMps2))
    ? Number(metadata.accelerationMps2)
    : firstNumber(attributes, ['acceleration', 'accelerationMps2', 'accel', 'gForce'])
  const speedMph = Number.isFinite(Number(metadata.speedMph))
    ? Number(metadata.speedMph)
    : firstNumber(attributes, ['speedMph', 'obdSpeed', 'vehicleSpeed'])
  return {
    ...metadata,
    speedMph,
    accelerationMps2,
    accelerationSource: accelerationMps2 == null ? null : (metadata.accelerationSource || 'obd2'),
    attributes,
  }
}

export function detectTripEvents(trip, thresholds = {}) {
  const points = Array.isArray(trip?.points) ? trip.points : []
  const events = []
  const speedThreshold = resolvedThreshold('maximum_speed', thresholds)
  let maximumSpeedEvent = null
  let brakingEpisodeActive = false
  let accelerationEpisodeActive = false

  points.forEach((point, index) => {
    const [latitude, longitude] = point
    const metadata = normalizePointTelemetry(point)
    if (metadata.accelerationMps2 == null && index > 0) {
      const previous = normalizePointTelemetry(points[index - 1])
      const elapsedSeconds = (new Date(metadata.timestamp || trip.start).getTime() - new Date(previous.timestamp || trip.start).getTime()) / 1000
      if (elapsedSeconds > 0 && Number.isFinite(previous.speedMph) && Number.isFinite(metadata.speedMph)) {
        metadata.accelerationMps2 = ((metadata.speedMph - previous.speedMph) * 0.44704) / elapsedSeconds
        metadata.accelerationSource = 'calculated'
      }
    }
    const speedMph = Number(metadata.speedMph ?? metadata.speed ?? NaN)
    if (Number.isFinite(speedMph) && speedMph >= speedThreshold.value && (!maximumSpeedEvent || speedMph > maximumSpeedEvent.measuredValue)) {
      maximumSpeedEvent = { eventType: 'maximum_speed', source: metadata.speedSource || 'traccar', occurredAt: metadata.timestamp || trip.start, latitude, longitude, measuredValue: speedMph, thresholdValue: speedThreshold.value, unit: speedThreshold.unit }
    }

    const acceleration = Number(metadata.accelerationMps2 ?? NaN)
    if (Number.isFinite(acceleration)) {
      const braking = acceleration <= resolvedThreshold('hard_braking', thresholds).value
      const accelerating = acceleration >= resolvedThreshold('hard_acceleration', thresholds).value
      const evidence = { accelerationMps2: acceleration, speedMph: Number.isFinite(speedMph) ? speedMph : null }
      if (braking && !brakingEpisodeActive) events.push({ eventType: 'hard_braking', source: metadata.accelerationSource || 'calculated', occurredAt: metadata.timestamp || trip.start, latitude, longitude, measuredValue: acceleration, thresholdValue: resolvedThreshold('hard_braking', thresholds).value, unit: 'm/s²', rawEvidence: JSON.stringify(evidence) })
      if (accelerating && !accelerationEpisodeActive) events.push({ eventType: 'hard_acceleration', source: metadata.accelerationSource || 'calculated', occurredAt: metadata.timestamp || trip.start, latitude, longitude, measuredValue: acceleration, thresholdValue: resolvedThreshold('hard_acceleration', thresholds).value, unit: 'm/s²', rawEvidence: JSON.stringify(evidence) })
      brakingEpisodeActive = braking
      accelerationEpisodeActive = accelerating
    }

    if (index > 0) {
      const previous = normalizePointTelemetry(points[index - 1])
      const previousTimestamp = new Date(previous.timestamp || trip.start).getTime()
      const currentTimestamp = new Date(metadata.timestamp || trip.start).getTime()
      const elapsedSeconds = (currentTimestamp - previousTimestamp) / 1000
      const previousSpeed = Number(previous.speedMph)
      const currentSpeed = Number(metadata.speedMph)
      if (elapsedSeconds > 0 && Number.isFinite(previousSpeed) && Number.isFinite(currentSpeed) && previousSpeed < 2 && currentSpeed < 2 && elapsedSeconds >= resolvedThreshold('long_idle', thresholds).value) {
        const idleThreshold = resolvedThreshold('long_idle', thresholds)
        events.push({ eventType: 'long_idle', source: 'calculated', occurredAt: metadata.timestamp || trip.start, latitude, longitude, measuredValue: elapsedSeconds, thresholdValue: idleThreshold.value, unit: idleThreshold.unit })
      }

    }
  })

  if (maximumSpeedEvent) events.push(maximumSpeedEvent)
  return events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt))
}

// Older event batches may contain one maximum-speed row for every telemetry
// sample. Keep one representative marker per continuous episode in the UI.
export function collapseTripEvents(events, gapSeconds = 30) {
  const ordered = [...(Array.isArray(events) ? events : [])].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt))
  const lastByType = new Map()
  const maximumSpeed = ordered.filter((event) => event.eventType === 'maximum_speed').sort((a, b) => Number(b.measuredValue || 0) - Number(a.measuredValue || 0))[0]
  return ordered.filter((event) => {
    if (event.eventType === 'maximum_speed') return event === maximumSpeed
    if (!['hard_braking', 'hard_acceleration'].includes(event.eventType)) return true
    const timestamp = new Date(event.occurredAt).getTime()
    const previous = lastByType.get(event.eventType)
    if (previous != null && timestamp - previous <= gapSeconds * 1000) return false
    lastByType.set(event.eventType, timestamp)
    return true
  })
}

export function formatEventMeasurement(event) {
  const value = Number(event?.measuredValue)
  if (!Number.isFinite(value)) return ''
  if (event.eventType === 'hard_acceleration' || event.eventType === 'hard_braking') {
    return `${Math.abs(value * 2.236936).toFixed(1)} mph/s`
  }
  return `${value.toFixed(2)} ${event.unit || ''}`.trim()
}

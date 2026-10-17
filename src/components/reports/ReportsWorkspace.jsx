import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { fetchBusinessMileageReport, fetchDataCompletenessReport, fetchDeviceBindingHistory, fetchEventReport, fetchMonthlySummaryReport, fetchNamedPlaces, fetchPlaceReport, fetchSpeedBandReport, fetchTripLogReport, fetchTripTags, fetchUsageSummaryReport, fetchUtilizationReport, fetchVehicleCatalog, fetchVehicleSpeedBands } from '../../lib/traccarReactApi'
import { DEFAULT_SPEED_BANDS } from '../../lib/speedBands'
import { resolveProfileContext, translateAttribute } from '../../lib/carProfiles'
import { resolveProfileRevision } from '../../lib/profileHistory'
import { profileWithSourceMappings } from '../../lib/telemetrySourceMappings'
import { toHistoryPosition } from '../../lib/geo'
import { buildTrackMetadata, buildTrackTiming } from '../../lib/csvExport'
import { addNamedPlaceMarkers } from '../../lib/trackPlaces'

function distance(meters, units) { return units === 'metric' ? `${(Number(meters || 0) / 1000).toFixed(1)} km` : `${(Number(meters || 0) / 1609.344).toFixed(1)} mi` }
function speed(mph, units) { if (mph == null) return '—'; return units === 'metric' ? `${(Number(mph) * 1.609344).toFixed(1)} km/h` : `${Number(mph).toFixed(1)} mph` }
function minutes(seconds) { return `${Math.round(Number(seconds || 0) / 60)} min` }
function period(value, groupBy) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '—')
  return date.toLocaleString(undefined, groupBy === 'trip' ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'medium' })
}

function tripPeriod(startValue, endValue) {
  const start = new Date(startValue)
  const end = endValue ? new Date(endValue) : null
  if (Number.isNaN(start.getTime())) return String(startValue || '—')
  const startText = start.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  if (!end || Number.isNaN(end.getTime())) return startText
  const endTime = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  const sameDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate()
  if (sameDay) return `${startText} → ${endTime}`
  const endDate = end.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
  return `${startText} → ${endTime} (on ${endDate})`
}

function LocationCell({ address, latitude, longitude }) {
  const hasCoordinates = latitude != null && longitude != null
  const label = address || (hasCoordinates ? `${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}` : '—')
  if (!hasCoordinates) return <span className="report-location-cell">{label}</span>
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`)}`
  return <a className="report-location-cell" href={href} target="_blank" rel="noreferrer" title="Open location in Google Maps">{label}</a>
}

function metricCell(metric) {
  if (metric?.value == null) return '—'
  const value = Number(metric.value)
  const text = Number.isInteger(value) ? Math.round(value).toLocaleString() : value.toFixed(1)
  return `${text}${metric.unit ? ` ${metric.unit}` : ''}`
}

function profileMetricHeader(rows, key, fallback, suffix) {
  const labels = [...new Set(rows.map((row) => row[key]?.label).filter(Boolean))]
  return labels.length === 1 ? `${labels[0]} ${suffix}` : `${fallback} ${suffix}`
}

function ReportTable({ reportType, rows, units, groupBy }) {
  const health = reportType === 'vehicle-health'
  const tracker = reportType === 'tracker-health'
  const speedBands = reportType === 'speed-bands'
  const racer = reportType === 'racer'
  const headers = health ? ['Vehicle', 'Device profile', 'Samples', profileMetricHeader(rows, 'coolantMax', 'Coolant', 'max'), profileMetricHeader(rows, 'obdSpeedMax', 'OBD speed', 'max'), profileMetricHeader(rows, 'voltageMin', 'Voltage', 'min'), profileMetricHeader(rows, 'rpmMax', 'RPM', 'max'), profileMetricHeader(rows, 'mafMax', 'MAF', 'max'), profileMetricHeader(rows, 'throttleMax', 'Throttle', 'max'), profileMetricHeader(rows, 'dtcMax', 'DTC', 'max')]
    : tracker ? ['Vehicle', 'Device profile', 'Samples', 'Last contact', 'Max gap', profileMetricHeader(rows, 'satellitesMin', 'Satellites', 'min-max'), profileMetricHeader(rows, 'hdopMin', 'HDOP', 'min'), profileMetricHeader(rows, 'rssiMin', 'RSSI', 'min'), profileMetricHeader(rows, 'powerMin', 'Power', 'min'), profileMetricHeader(rows, 'batteryMin', 'Battery', 'min')]
    : speedBands ? ['Vehicle', 'Band', 'Range', 'Distance', 'Points', 'Color']
      : racer ? ['Event', 'Course', 'Vehicle', 'From', 'To', 'Time', 'Distance', 'Max speed', 'Max RPM', 'Max coolant', 'Max throttle', 'Max load', 'Device profile']
      : reportType === 'places' ? ['Place', 'Vehicle', 'Visits', 'Arrivals', 'Departures', 'Distance', 'Duration', 'Last visit']
        : reportType === 'data-completeness' ? ['Vehicle', 'Source', 'Trips', 'Without max speed', 'Without route', 'Without telemetry', 'Route points', 'Telemetry points', 'Route coverage', 'Telemetry coverage', 'Events']
          : reportType === 'events' ? ['Vehicle', 'Event', 'Source', 'Count', 'First', 'Last', 'Minimum', 'Maximum', 'Unit', 'High severity']
            : reportType === 'utilization' ? ['Period', 'Vehicle', 'Trips', 'First departure', 'Last arrival', 'Distance', 'Driving time']
              : reportType === 'business-mileage' ? ['Date', 'Vehicle', 'From', 'To', 'Distance', 'Duration', 'Tags', 'Purpose']
      : ['Period', 'Vehicle', reportType === 'trip-log' ? 'From' : 'Trips', ...(reportType === 'trip-log' ? ['To'] : []), 'Distance', 'Duration', 'Max speed', 'Events']
  const cells = (row) => {
    if (health) return [row.vehicleName, row.profileName, row.samples, metricCell(row.coolantMax), metricCell(row.obdSpeedMax), metricCell(row.voltageMin), metricCell(row.rpmMax), metricCell(row.mafMax), metricCell(row.throttleMax), metricCell(row.dtcMax)]
    if (tracker) return [row.vehicleName, row.profileName, row.samples, row.lastContact ? row.lastContact.toLocaleString() : '—', row.maxGapSeconds ? `${Math.round(row.maxGapSeconds)} s` : '—', row.satellitesMin == null ? '—' : `${metricCell(row.satellitesMin)} – ${metricCell(row.satellitesMax)}`, metricCell(row.hdopMin), metricCell(row.rssiMin), metricCell(row.powerMin), metricCell(row.batteryMin)]
    if (speedBands) {
      const convert = (value) => units === 'metric' ? Number(value) * 1.609344 : Number(value)
      const unit = units === 'metric' ? 'km/h' : 'mph'
      return [row.vehicleName, row.bandIndex, row.throughMph == null ? `${convert(row.fromMph).toFixed(1)}+ ${unit}` : `${convert(row.fromMph).toFixed(1)}—${convert(row.throughMph).toFixed(1)} ${unit}`, distance(row.distanceMeters, units), row.points, <><span className="report-color-swatch" style={{ backgroundColor: row.color || '#64748b' }} /> <code>{row.color || '—'}</code></>]
    }
    if (racer) return [row.eventType, row.courseName, row.vehicleName, row.startLabel, row.finishLabel, row.elapsedSeconds == null ? '—' : `${Number(row.elapsedSeconds).toFixed(3)} s`, row.distanceMeters == null ? '—' : distance(row.distanceMeters, units), speed(row.maxSpeedMph, units), metricCell(row.maxRpm), metricCell(row.maxCoolant), metricCell(row.maxThrottle), metricCell(row.maxLoad), row.profileName]
    if (reportType === 'places') return [row.placeName, row.vehicleName, row.tripCount, row.arrivals, row.departures, distance(row.distanceMeters, units), minutes(row.durationSeconds), period(row.lastVisit, 'trip')]
    if (reportType === 'data-completeness') return [row.vehicleName, row.source, row.tripCount, row.tripsWithoutMaxSpeed, row.tripsWithoutRoute, row.tripsWithoutTelemetry, row.routePoints, row.telemetryPoints, row.routeCoverage, row.telemetryCoverage, row.eventCount]
    if (reportType === 'events') return [row.vehicleName, row.eventType, row.source, row.eventCount, period(row.firstOccurrence, 'trip'), period(row.lastOccurrence, 'trip'), row.minimum ?? '—', row.maximum ?? '—', row.unit || '—', row.highSeverity]
    if (reportType === 'utilization') return [period(row.period, groupBy), row.vehicleName, row.tripCount, period(row.firstDeparture, 'trip'), period(row.lastArrival, 'trip'), distance(row.distanceMeters, units), minutes(row.durationSeconds)]
    if (reportType === 'business-mileage') return [period(row.startedAt, 'trip'), row.vehicleName, row.startAddress || '—', row.endAddress || '—', distance(row.distanceMeters, units), minutes(row.durationSeconds), row.tags || '—', row.notes || '—']
    const common = [reportType === 'trip-log' ? tripPeriod(row.period, row.endedAt) : period(row.period, reportType === 'monthly-summary' ? 'month' : groupBy), row.vehicleName]
    if (reportType === 'trip-log') common.push(<LocationCell address={row.startAddress} latitude={row.startLatitude} longitude={row.startLongitude} />, <LocationCell address={row.endAddress} latitude={row.endLatitude} longitude={row.endLongitude} />)
    else common.push(row.tripCount)
    common.push(distance(row.distanceMeters, units), minutes(row.durationSeconds), speed(row.maxSpeedMph, units), row.eventCount)
    return common
  }
  return <div className="report-workspace-table-wrap"><table className="operations-report-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={headers.length} className="vehicle-stats-empty">No records found.</td></tr> : rows.map((row, index) => <tr key={`${row.vehicleId || row.id || index}-${index}`}>{cells(row, index).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
}

function dateInputValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function metersBetween(a, b) {
  const radius = 6371000
  const radians = Math.PI / 180
  const lat1 = Number(a.latitude) * radians
  const lat2 = Number(b.latitude) * radians
  const dLat = (Number(b.latitude) - Number(a.latitude)) * radians
  const dLon = (Number(b.longitude) - Number(a.longitude)) * radians
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(value))
}

function liveSpeedBandRows(report, bandsByVehicle, positionsByDevice) {
  const totals = new Map()
  for (const window of report.traccarWindows || []) {
    const points = (positionsByDevice.get(Number(window.traccarDeviceId)) || [])
      .filter((point) => {
        const time = new Date(point.fixTime || point.deviceTime || point.serverTime).getTime()
        return time >= new Date(window.startedAt).getTime() && time <= new Date(window.endedAt).getTime()
      })
      .sort((a, b) => new Date(a.fixTime || a.deviceTime || a.serverTime) - new Date(b.fixTime || b.deviceTime || b.serverTime))
    const bands = bandsByVehicle.get(String(window.vehicleId)) || []
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]
      const current = points[index]
      const mph = Number(current.speed || 0) * 1.150779
      const bandIndex = bands.findIndex((band, bandIndex) => {
        const from = Number.isFinite(Number(band.fromMph)) ? Number(band.fromMph) : (bandIndex === 0 ? 0 : Number(bands[bandIndex - 1].upperMph))
        const through = band.throughMph != null ? Number(band.throughMph) : (band.upperMph == null ? null : Number(band.upperMph))
        return mph >= from && (through == null || mph < through)
      })
      if (bandIndex < 0) continue
      const key = `${window.vehicleId}:${bandIndex}`
      const old = totals.get(key) || { vehicleId: window.vehicleId, vehicleName: window.vehicleName, bandIndex, distanceMeters: 0, points: 0 }
      old.distanceMeters += metersBetween(previous, current)
      old.points += 1
      totals.set(key, old)
    }
  }
  return [...totals.values()].map((row) => {
    const bands = bandsByVehicle.get(String(row.vehicleId)) || []
    const band = bands[row.bandIndex] || {}
    return { ...row, fromMph: Number.isFinite(Number(band.fromMph)) ? Number(band.fromMph) : (row.bandIndex === 0 ? 0 : Number(bands[row.bandIndex - 1]?.upperMph || 0)), throughMph: band.throughMph != null ? Number(band.throughMph) : (band.upperMph == null ? null : Number(band.upperMph)), color: band.color || '' }
  })
}

function mappedMetric(profile, attributes, quantity) {
  if (!profile) return null
  const entry = Object.entries(profile.attributeMap || {}).find(([, info]) => info?.quantity === quantity)
  if (!entry) return null
  const [key] = entry
  const raw = attributes?.[key]
  const translated = translateAttribute(profile, key, raw)
  if (['missing', 'invalid', 'sentinel'].includes(translated.status)) return null
  const value = Number(translated.value)
  return Number.isFinite(value) ? { value, unit: translated.unit, label: translated.label } : null
}

function mappedMetricByLabel(profile, attributes, quantity, pattern) {
  if (!profile) return null
  const entry = Object.entries(profile.attributeMap || {}).find(([, info]) => (quantity == null || info?.quantity === quantity) && pattern.test(String(info.label || '')))
  if (!entry) return null
  const [key] = entry
  const translated = translateAttribute(profile, key, attributes?.[key])
  if (['missing', 'invalid', 'sentinel'].includes(translated.status)) return null
  const value = Number(translated.value)
  return Number.isFinite(value) ? { value, unit: translated.unit, label: translated.label } : null
}

function updateMetric(current, candidate, mode) {
  if (!candidate) return current
  if (!current || (mode === 'max' ? candidate.value > current.value : candidate.value < current.value)) return candidate
  return current
}

function resolveHistoricalProfileContext(context, at, profileDefinitionHistoryById) {
  const revision = resolveProfileRevision(profileDefinitionHistoryById?.[context.profileId], at)
  return revision ? { ...context, profile: revision.profile, profileRevision: revision.revision, profileRevisionEffectiveAt: revision.effectiveAt } : context
}

function profileContextForWindow(window, vehicles, bindings, profileMap, profileAssignments, profileDefinitionHistoryById) {
  const context = resolveProfileContext({ vehicleId: window.vehicleId, deviceId: window.traccarDeviceId, at: window.startedAt, vehicles, bindings, profileAssignments, profileMap })
  return resolveHistoricalProfileContext(context, window.startedAt, profileDefinitionHistoryById)
}

function profileContextForPoint(window, point, vehicles, bindings, profileMap, profileAssignments, profileDefinitionHistoryById) {
  const at = point.fixTime || point.deviceTime || point.serverTime || window.startedAt
  const context = resolveProfileContext({ vehicleId: window.vehicleId, deviceId: window.traccarDeviceId, at, vehicles, bindings, profileAssignments, profileMap })
  return resolveHistoricalProfileContext(context, at, profileDefinitionHistoryById)
}

function liveVehicleHealthRows(report, positionsByDevice, vehicles, bindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById) {
  const summaries = new Map()
  for (const window of report.traccarWindows || []) {
    const points = (positionsByDevice.get(Number(window.traccarDeviceId)) || []).filter((point) => {
      const time = new Date(point.fixTime || point.deviceTime || point.serverTime).getTime()
      return time >= new Date(window.startedAt).getTime() && time <= new Date(window.endedAt).getTime()
    })
    const profileContext = profileContextForWindow(window, vehicles, bindings, profileMap, profileAssignments, profileDefinitionHistoryById)
    const profile = profileContext.profile
    const reportVehicleId = profileContext.vehicle?.id ?? window.vehicleId
    const reportVehicleName = profileContext.vehicle?.displayName || profileContext.vehicle?.name || window.vehicleName
    const current = summaries.get(String(reportVehicleId)) || { vehicleId: reportVehicleId, vehicleName: reportVehicleName, profileNames: [], samples: 0, coolantMax: null, obdSpeedMax: null, voltageMin: null, rpmMax: null, mafMax: null, throttleMax: null, dtcMax: null }
    for (const point of points) {
      const attributes = point.attributes || {}
      const pointContext = profileContextForPoint(window, point, vehicles, bindings, profileMap, profileAssignments, profileDefinitionHistoryById)
      const pointProfile = profileWithSourceMappings(pointContext.profile, sourceMappingRevisionsByDevice?.[Number(window.traccarDeviceId)] || [], point.fixTime || point.deviceTime || point.serverTime)
      const profileName = pointProfile?.name || (pointContext.status === 'missing-definition' ? `Missing profile: ${pointContext.profileId}` : 'No profile assigned')
      if (!current.profileNames.includes(profileName)) current.profileNames.push(profileName)
      current.samples += 1
      current.coolantMax = updateMetric(current.coolantMax, mappedMetric(pointProfile, attributes, 'engine_coolant_temperature'), 'max')
      current.obdSpeedMax = updateMetric(current.obdSpeedMax, mappedMetric(pointProfile, attributes, 'obd_speed'), 'max')
      current.voltageMin = updateMetric(current.voltageMin, mappedMetric(pointProfile, attributes, 'control_module_voltage'), 'min')
      current.rpmMax = updateMetric(current.rpmMax, mappedMetric(pointProfile, attributes, 'rotational_speed'), 'max')
      current.mafMax = updateMetric(current.mafMax, mappedMetric(pointProfile, attributes, 'mass_flow'), 'max')
      current.throttleMax = updateMetric(current.throttleMax, mappedMetric(pointProfile, attributes, 'percentage'), 'max')
      current.dtcMax = updateMetric(current.dtcMax, mappedMetric(pointProfile, attributes, 'diagnostic_code_count'), 'max')
    }
    summaries.set(String(reportVehicleId), current)
  }
  return [...summaries.values()].map(({ profileNames, ...row }) => ({ ...row, profileName: profileNames.join(', ') }))
}

function liveTrackerHealthRows(report, positionsByDevice, vehicles, bindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById) {
  const summaries = new Map()
  for (const window of report.traccarWindows || []) {
    const points = (positionsByDevice.get(Number(window.traccarDeviceId)) || []).filter((point) => {
      const time = new Date(point.fixTime || point.deviceTime || point.serverTime).getTime()
      return time >= new Date(window.startedAt).getTime() && time <= new Date(window.endedAt).getTime()
    }).sort((a, b) => new Date(a.fixTime || a.deviceTime || a.serverTime) - new Date(b.fixTime || b.deviceTime || b.serverTime))
    const profileContext = profileContextForWindow(window, vehicles, bindings, profileMap, profileAssignments, profileDefinitionHistoryById)
    const profile = profileContext.profile
    const reportVehicleId = profileContext.vehicle?.id ?? window.vehicleId
    const reportVehicleName = profileContext.vehicle?.displayName || profileContext.vehicle?.name || window.vehicleName
    const current = summaries.get(String(reportVehicleId)) || { vehicleId: reportVehicleId, vehicleName: reportVehicleName, profileNames: [], samples: 0, lastContact: null, maxGapSeconds: 0, satellitesMin: null, satellitesMax: null, hdopMin: null, rssiMin: null, powerMin: null, batteryMin: null }
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const timestamp = new Date(point.fixTime || point.deviceTime || point.serverTime)
      const attributes = point.attributes || {}
      current.samples += 1
      if (!current.lastContact || timestamp > current.lastContact) current.lastContact = timestamp
      if (index > 0) current.maxGapSeconds = Math.max(current.maxGapSeconds, (timestamp - new Date(points[index - 1].fixTime || points[index - 1].deviceTime || points[index - 1].serverTime)) / 1000)
      const pointContext = profileContextForPoint(window, point, vehicles, bindings, profileMap, profileAssignments, profileDefinitionHistoryById)
      const pointProfile = profileWithSourceMappings(pointContext.profile, sourceMappingRevisionsByDevice?.[Number(window.traccarDeviceId)] || [], timestamp)
      const profileName = pointProfile?.name || (pointContext.status === 'missing-definition' ? `Missing profile: ${pointContext.profileId}` : 'No profile assigned')
      if (!current.profileNames.includes(profileName)) current.profileNames.push(profileName)
      const satellites = mappedMetric(pointProfile, attributes, 'gnss_satellite_count')
      const hdop = mappedMetric(pointProfile, attributes, 'gnss_hdop')
      const rssi = mappedMetric(pointProfile, attributes, 'gsm_signal_level')
      const power = mappedMetric(pointProfile, attributes, 'external_supply_voltage')
      const battery = mappedMetric(pointProfile, attributes, 'tracker_battery_voltage')
      current.satellitesMin = updateMetric(current.satellitesMin, satellites, 'min')
      current.satellitesMax = updateMetric(current.satellitesMax, satellites, 'max')
      current.hdopMin = updateMetric(current.hdopMin, hdop, 'min')
      current.rssiMin = updateMetric(current.rssiMin, rssi, 'min')
      current.powerMin = updateMetric(current.powerMin, power, 'min')
      current.batteryMin = updateMetric(current.batteryMin, battery, 'min')
    }
    summaries.set(String(reportVehicleId), current)
  }
  return [...summaries.values()].map(({ profileNames, ...row }) => ({ ...row, profileName: profileNames.join(', ') }))
}

function trackNameFromPlace(value) {
  const text = String(value || '')
  const separator = text.indexOf(' / ')
  return separator >= 0 ? text.slice(0, separator) : 'Unassigned course'
}

function summarizeRacerEvent(item, eventType, windowByTrip, pointsByTrip, vehicles, bindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById) {
  const tripId = String(item.tripId || '')
  const window = windowByTrip.get(tripId)
  const courseName = trackNameFromPlace(item.startPlace || item.place)
  const startedAt = item.startUtc ? new Date(item.startUtc) : null
  const endedAt = item.finishUtc ? new Date(item.finishUtc) : item.timestampUtc ? new Date(item.timestampUtc) : null
  const elapsedSeconds = Number.isFinite(Number(item.elapsedSeconds)) ? Number(item.elapsedSeconds) : Number.isFinite(Number(item.elapsedSincePreviousSeconds)) ? Number(item.elapsedSincePreviousSeconds) : null
  const points = (pointsByTrip.get(tripId) || []).filter((point) => (!startedAt || point.timestamp >= startedAt) && (!endedAt || point.timestamp <= endedAt))
  const profileContext = window ? profileContextForWindow(window, vehicles, bindings, profileMap, profileAssignments, profileDefinitionHistoryById) : { profile: null, status: 'missing-definition' }
  const profileNames = new Set()
  const profile = profileContext.profile
  let maxSpeedMph = null
  let maxRpm = null
  let maxCoolant = null
  let maxThrottle = null
  let maxLoad = null
  for (const point of points) {
    const pointContext = window ? profileContextForPoint(window, point, vehicles, bindings, profileMap, profileAssignments, profileDefinitionHistoryById) : profileContext
    const pointProfile = profileWithSourceMappings(pointContext.profile, sourceMappingRevisionsByDevice?.[Number(window?.traccarDeviceId)] || [], point.timestamp)
    if (pointProfile?.name) profileNames.add(pointProfile.name)
    const speedMph = Number(point.speed) * 1.150779
    if (Number.isFinite(speedMph)) maxSpeedMph = maxSpeedMph == null ? speedMph : Math.max(maxSpeedMph, speedMph)
    maxRpm = updateMetric(maxRpm, mappedMetric(pointProfile, point.attributes, 'rotational_speed'), 'max')
    maxCoolant = updateMetric(maxCoolant, mappedMetric(pointProfile, point.attributes, 'engine_coolant_temperature'), 'max')
    maxThrottle = updateMetric(maxThrottle, mappedMetricByLabel(pointProfile, point.attributes, 'percentage', /throttle/i), 'max')
    maxLoad = updateMetric(maxLoad, mappedMetricByLabel(pointProfile, point.attributes, null, /load/i), 'max')
  }
  const distanceMeters = item.distanceMeters ?? item.distanceFromPreviousMeters ?? null
  return {
    id: `${eventType}:${tripId}:${item.startUtc || item.timestampUtc || item.finishUtc}`,
    eventType,
    vehicleId: window?.vehicleId ?? null,
    vehicleName: window?.vehicleName || 'Unknown vehicle',
    courseName,
    startLabel: item.startPlace || 'Previous checkpoint',
    finishLabel: item.finishPlace || item.place || '—',
    startedAt,
    endedAt,
    elapsedSeconds,
    distanceMeters: Number.isFinite(Number(distanceMeters)) ? Number(distanceMeters) : null,
    maxSpeedMph,
    maxRpm,
    maxCoolant,
    maxThrottle,
    maxLoad,
    profileName: [...profileNames].join(', ') || profile?.name || (profileContext.status === 'missing-definition' ? `Missing profile: ${profileContext.profileId}` : 'No profile assigned'),
  }
}

async function loadRacerReport({ baseUrl, traccarApi, from, through, vehicleId, tagId, vehicles, bindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById }) {
  if (!traccarApi) throw new Error('Traccar position access is required for Racer Report.')
  const sourceReport = await fetchSpeedBandReport(baseUrl, { from, to: through, vehicleId: vehicleId || undefined, tagId: tagId || undefined })
  const trackPlaces = (await fetchNamedPlaces(baseUrl, vehicleId || null)).filter((place) => ['track_start', 'track_finish', 'track_start_finish', 'track_split', 'track_other', 'drag_start', 'drag_finish'].includes(place.placeType))
  const windows = sourceReport.traccarWindows || []
  const warnings = []
  if (!trackPlaces.length) warnings.push('No track locations are defined. Add a track start/finish, split, or drag start/finish named place to produce timing rows.')
  if (!windows.length) warnings.push('No Traccar trips match the selected date, vehicle, and tag filters.')
  if (!trackPlaces.length || !windows.length) return { reportType: 'racer', generatedAtUtc: new Date().toISOString(), filters: { from, through, vehicleId: vehicleId || null, tagId: tagId || null }, summary: { courses: 0, lapCount: 0, bestLapSeconds: null, averageLapSeconds: null, dragRunCount: 0, bestDragSeconds: null, splitCount: 0, routePoints: 0 }, warnings, rows: [], trackTiming: null, trackMetadata: null }

  const rangesByDevice = new Map()
  windows.forEach((window) => {
    const key = Number(window.traccarDeviceId)
    const start = new Date(window.startedAt)
    const end = new Date(window.endedAt)
    const current = rangesByDevice.get(key)
    if (!current) rangesByDevice.set(key, { from: start, to: end })
    else { if (start < current.from) current.from = start; if (end > current.to) current.to = end }
  })
  const positionsByDevice = new Map(await Promise.all([...rangesByDevice.entries()].map(async ([deviceId, range]) => {
    const params = new URLSearchParams({ deviceId: String(deviceId), from: range.from.toISOString(), to: range.to.toISOString() })
    const payload = await traccarApi(`/positions?${params.toString()}`, { cache: 'no-store' })
    return [deviceId, (Array.isArray(payload) ? payload : []).map(toHistoryPosition).sort((a, b) => a.timestamp - b.timestamp)]
  })))
  const groups = windows.map((window, index) => ({ id: `racer-${window.vehicleId}-${window.traccarDeviceId}-${new Date(window.startedAt).getTime()}-${index}`, vehicleId: window.vehicleId, deviceId: window.traccarDeviceId, window }))
  const points = []
  groups.forEach((group, index) => {
    const start = new Date(group.window.startedAt).getTime()
    const end = new Date(group.window.endedAt).getTime()
    ;(positionsByDevice.get(Number(group.deviceId)) || []).forEach((point) => {
      if (point.timestamp.getTime() < start || point.timestamp.getTime() > end) return
      points.push({ ...point, tripId: group.id, __groupIndex: index })
    })
  })
  if (!points.length) warnings.push('No Traccar position samples were returned for the selected trip windows.')
  const markedPoints = addNamedPlaceMarkers(points.sort((a, b) => a.timestamp - b.timestamp), trackPlaces, groups, vehicleId || null)
  const trackTiming = buildTrackTiming(markedPoints)
  const trackMetadata = buildTrackMetadata({ points: markedPoints, timing: trackTiming, sessionStart: markedPoints[0]?.timestamp, vehicleId: vehicleId || null })
  const pointsByTrip = new Map()
  markedPoints.forEach((point) => pointsByTrip.set(point.tripId, [...(pointsByTrip.get(point.tripId) || []), point]))
  const windowByTrip = new Map(groups.map((group) => [group.id, group.window]))
  const rows = [
    ...trackMetadata.laps.map((item) => summarizeRacerEvent(item, 'Lap', windowByTrip, pointsByTrip, vehicles, bindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById)),
    ...trackMetadata.dragRuns.map((item) => summarizeRacerEvent(item, 'Drag run', windowByTrip, pointsByTrip, vehicles, bindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById)),
    ...trackMetadata.splitPassages.map((item) => summarizeRacerEvent(item, 'Split', windowByTrip, pointsByTrip, vehicles, bindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById)),
  ].sort((a, b) => (a.endedAt?.getTime() || 0) - (b.endedAt?.getTime() || 0))
  if (!rows.length && points.length) warnings.push('GPS points were found, but none crossed a configured track or drag timing location.')
  const laps = rows.filter((row) => row.eventType === 'Lap').map((row) => row.elapsedSeconds).filter(Number.isFinite)
  const dragRuns = rows.filter((row) => row.eventType === 'Drag run').map((row) => row.elapsedSeconds).filter(Number.isFinite)
  return {
    reportType: 'racer',
    generatedAtUtc: new Date().toISOString(),
    filters: { from, through, vehicleId: vehicleId || null, tagId: tagId || null },
    summary: { courses: new Set(rows.map((row) => row.courseName)).size, lapCount: laps.length, bestLapSeconds: laps.length ? Math.min(...laps) : null, averageLapSeconds: laps.length ? laps.reduce((sum, value) => sum + value, 0) / laps.length : null, dragRunCount: dragRuns.length, bestDragSeconds: dragRuns.length ? Math.min(...dragRuns) : null, splitCount: rows.filter((row) => row.eventType === 'Split').length, routePoints: points.length },
    warnings,
    rows,
    trackTiming,
    trackMetadata,
  }
}

export default function ReportsWorkspace({ baseUrl, initialVehicleId, traccarApi, onClose, profileMap = {}, bindings = [], profileAssignments = [], sourceMappingRevisionsByDevice = {}, profileDefinitionHistoryById = {}, displayUnits = 'imperial', updateSetting }) {
  const today = dateInputValue(new Date())
  const defaultFromDate = new Date()
  defaultFromDate.setMonth(defaultFromDate.getMonth() - 1)
  const [from, setFrom] = useState(dateInputValue(defaultFromDate))
  const [through, setThrough] = useState(today)
  const [groupBy, setGroupBy] = useState('day')
  const [reportType, setReportType] = useState('usage-summary')
  const units = displayUnits === 'metric' ? 'metric' : 'imperial'
  const [vehicleId, setVehicleId] = useState(initialVehicleId || '')
  const [tagId, setTagId] = useState('')
  const [vehicles, setVehicles] = useState([])
  const [reportBindings, setReportBindings] = useState(bindings)
  const [bindingHistoryStatus, setBindingHistoryStatus] = useState('loading')
  const [tags, setTags] = useState([])
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const selectReportType = (nextType) => {
    setReportType(nextType)
    setReport(null)
    if (nextType === 'monthly-summary') {
      const yearPrior = new Date()
      yearPrior.setFullYear(yearPrior.getFullYear() - 1)
      setFrom(dateInputValue(yearPrior))
      setGroupBy('month')
    }
  }

  useEffect(() => {
    let active = true
    fetchVehicleCatalog(baseUrl).then((values) => { if (active) setVehicles(values) }).catch(() => { if (active) setVehicles([]) })
    return () => { active = false }
  }, [baseUrl])

  useEffect(() => {
    let active = true
    setBindingHistoryStatus('loading')
    setReportBindings(bindings)
    fetchDeviceBindingHistory(baseUrl)
      .then((values) => { if (active) { setReportBindings(values); setBindingHistoryStatus('loaded') } })
      .catch(() => { if (active) { setReportBindings(bindings); setBindingHistoryStatus('unavailable') } })
    return () => { active = false }
  }, [baseUrl, bindings])

  useEffect(() => {
    let active = true
    if (!vehicleId) { setTags([]); return () => { active = false } }
    fetchTripTags(baseUrl, vehicleId).then((values) => { if (active) setTags(values) }).catch(() => { if (active) setTags([]) })
    return () => { active = false }
  }, [baseUrl, vehicleId])

  const run = async () => {
    if (!from || !through) { setError('Choose both a from and through date.'); return }
    if (through < from) { setError('The through date must be on or after the from date.'); return }
    setBusy(true); setError(''); setReport(null)
    try {
      if (reportType === 'racer') {
        const nextReport = await loadRacerReport({ baseUrl, traccarApi, from, through, vehicleId, tagId, vehicles, bindings: reportBindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById })
        setReport(nextReport)
        return
      }
      const fetchReport = reportType === 'trip-log' ? fetchTripLogReport : reportType === 'monthly-summary' ? fetchMonthlySummaryReport : reportType === 'places' ? fetchPlaceReport : reportType === 'data-completeness' ? fetchDataCompletenessReport : reportType === 'events' ? fetchEventReport : reportType === 'utilization' ? fetchUtilizationReport : reportType === 'business-mileage' ? fetchBusinessMileageReport : (reportType === 'speed-bands' || reportType === 'vehicle-health' || reportType === 'tracker-health') ? fetchSpeedBandReport : fetchUsageSummaryReport
      const effectiveGroupBy = reportType === 'monthly-summary' ? 'month' : groupBy
      let nextReport = await fetchReport(baseUrl, { from, to: through, groupBy: effectiveGroupBy, timeZone, units, vehicleId: vehicleId || undefined, tagId: tagId || undefined })
      if ((reportType === 'speed-bands' || reportType === 'vehicle-health' || reportType === 'tracker-health') && traccarApi && nextReport.traccarWindows?.length) {
        const windowsByDevice = new Map()
        for (const window of nextReport.traccarWindows) {
          const current = windowsByDevice.get(Number(window.traccarDeviceId))
          const start = new Date(window.startedAt)
          const end = new Date(window.endedAt)
          if (!current) windowsByDevice.set(Number(window.traccarDeviceId), { from: start, to: end })
          else { if (start < current.from) current.from = start; if (end > current.to) current.to = end }
        }
        const positionsByDevice = new Map(await Promise.all([...windowsByDevice.entries()].map(async ([deviceId, range]) => {
          const params = new URLSearchParams({ deviceId: String(deviceId), from: range.from.toISOString(), to: range.to.toISOString() })
          const payload = await traccarApi(`/positions?${params.toString()}`, { cache: 'no-store' })
          return [deviceId, Array.isArray(payload) ? payload : []]
        })))
        const bandsByVehicle = reportType === 'speed-bands'
          ? new Map(await Promise.all((nextReport.traccarWindows || []).map(async (window) => {
            const config = await fetchVehicleSpeedBands(baseUrl, window.vehicleId)
            return [String(window.vehicleId), Array.isArray(config?.bands) && config.bands.length ? config.bands : DEFAULT_SPEED_BANDS]
          })))
          : new Map()
          const rows = reportType === 'speed-bands' ? liveSpeedBandRows(nextReport, bandsByVehicle, positionsByDevice) : reportType === 'vehicle-health' ? liveVehicleHealthRows(nextReport, positionsByDevice, vehicles, reportBindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById) : liveTrackerHealthRows(nextReport, positionsByDevice, vehicles, reportBindings, profileMap, profileAssignments, sourceMappingRevisionsByDevice, profileDefinitionHistoryById)
        const warnings = reportType === 'speed-bands'
          ? []
          : [reportType === 'vehicle-health' ? 'Vehicle Health translates telemetry using the profile assigned to each vehicle. Fields without a matching profile mapping are unavailable.' : 'Tracker Health translates telemetry using the profile assigned to each vehicle. Fields without a matching profile mapping are unavailable.']
        if (rows.some((row) => row.profileName?.startsWith('No profile assigned') || row.profileName?.startsWith('Missing profile:'))) warnings.push('One or more vehicles have no available assigned profile. Their profile-mapped metrics are shown as unavailable; check each row’s Device profile.')
        if (reportType !== 'speed-bands' && bindingHistoryStatus === 'unavailable') warnings.push('Historical device bindings could not be loaded. The report used the active binding list, which may not reflect older vehicle assignments.')
        nextReport = { ...nextReport, summary: reportType === 'speed-bands' ? { ...nextReport.summary, vehicles: new Set(rows.map((row) => row.vehicleId)).size, routeVehicles: new Set(rows.map((row) => row.vehicleId)).size, distanceMeters: rows.reduce((sum, row) => sum + row.distanceMeters, 0) } : { vehicles: rows.length, samples: rows.reduce((sum, row) => sum + row.samples, 0), tripCount: rows.length, distanceMeters: 0, durationSeconds: 0, averageTripDistanceMeters: null, averageTripDurationSeconds: null, eventCount: 0, maxSpeedMph: null }, warnings, rows }
      }
      setReport(nextReport)
    } catch (err) { setReport(null); setError(err instanceof Error ? err.message : 'Report lookup failed') } finally { setBusy(false) }
  }

  const exportCsv = async () => {
    try {
      if (report && reportType === 'racer') {
        const metricHeaders = (key, fallback) => profileMetricHeader(report.rows, key, fallback, 'max')
        const headers = ['Event', 'Course', 'Vehicle', 'From', 'To', 'Start UTC', 'Finish UTC', 'Elapsed seconds', `Distance (${units === 'metric' ? 'km' : 'mi'})`, `Max speed (${units === 'metric' ? 'km/h' : 'mph'})`, metricHeaders('maxRpm', 'Max RPM'), metricHeaders('maxCoolant', 'Max coolant'), metricHeaders('maxThrottle', 'Max throttle'), metricHeaders('maxLoad', 'Max load'), 'Device profile']
        const values = report.rows.map((row) => [row.eventType, row.courseName, row.vehicleName, row.startLabel, row.finishLabel, row.startedAt?.toISOString(), row.endedAt?.toISOString(), row.elapsedSeconds, row.distanceMeters == null ? '' : units === 'metric' ? (row.distanceMeters / 1000).toFixed(3) : (row.distanceMeters / 1609.344).toFixed(3), row.maxSpeedMph == null ? '' : units === 'metric' ? (row.maxSpeedMph * 1.609344).toFixed(2) : Number(row.maxSpeedMph).toFixed(2), metricCell(row.maxRpm), metricCell(row.maxCoolant), metricCell(row.maxThrottle), metricCell(row.maxLoad), row.profileName])
        const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
        const csv = [headers, ...values].map((line) => line.map(escape).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `racer-${from}-${through}.csv`; link.click(); URL.revokeObjectURL(url)
        return
      }
      if (report && (reportType === 'speed-bands' || reportType === 'vehicle-health' || reportType === 'tracker-health')) {
        const headers = reportType === 'speed-bands'
          ? ['Vehicle', 'Band', `Range (${units === 'metric' ? 'km/h' : 'mph'})`, `Distance (${units === 'metric' ? 'km' : 'mi'})`, 'Points', 'Color']
          : reportType === 'vehicle-health' ? ['Vehicle', 'Device profile', 'Samples', profileMetricHeader(report.rows, 'coolantMax', 'Coolant', 'max'), profileMetricHeader(report.rows, 'obdSpeedMax', 'OBD speed', 'max'), profileMetricHeader(report.rows, 'voltageMin', 'Voltage', 'min'), profileMetricHeader(report.rows, 'rpmMax', 'RPM', 'max'), profileMetricHeader(report.rows, 'mafMax', 'MAF', 'max'), profileMetricHeader(report.rows, 'throttleMax', 'Throttle', 'max'), profileMetricHeader(report.rows, 'dtcMax', 'DTC', 'max')]
            : ['Vehicle', 'Device profile', 'Samples', 'Last contact', 'Max gap seconds', profileMetricHeader(report.rows, 'satellitesMin', 'Satellites', 'min-max'), profileMetricHeader(report.rows, 'hdopMin', 'HDOP', 'min'), profileMetricHeader(report.rows, 'rssiMin', 'RSSI', 'min'), profileMetricHeader(report.rows, 'powerMin', 'Power', 'min'), profileMetricHeader(report.rows, 'batteryMin', 'Battery', 'min')]
        const values = report.rows.map((row) => reportType === 'speed-bands'
          ? [row.vehicleName, row.bandIndex, row.throughMph == null ? `${(units === 'metric' ? row.fromMph * 1.609344 : row.fromMph).toFixed(1)}+ ${units === 'metric' ? 'km/h' : 'mph'}` : `${(units === 'metric' ? row.fromMph * 1.609344 : row.fromMph).toFixed(1)}-${(units === 'metric' ? row.throughMph * 1.609344 : row.throughMph).toFixed(1)} ${units === 'metric' ? 'km/h' : 'mph'}`, units === 'metric' ? (row.distanceMeters / 1000).toFixed(3) : (row.distanceMeters / 1609.344).toFixed(3), row.points, row.color]
          : reportType === 'vehicle-health' ? [row.vehicleName, row.profileName, row.samples, metricCell(row.coolantMax), metricCell(row.obdSpeedMax), metricCell(row.voltageMin), metricCell(row.rpmMax), metricCell(row.mafMax), metricCell(row.throttleMax), metricCell(row.dtcMax)]
            : [row.vehicleName, row.profileName, row.samples, row.lastContact?.toISOString(), row.maxGapSeconds, row.satellitesMin == null ? null : `${metricCell(row.satellitesMin)} - ${metricCell(row.satellitesMax)}`, metricCell(row.hdopMin), metricCell(row.rssiMin), metricCell(row.powerMin), metricCell(row.batteryMin)])
        const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
        const csv = [headers, ...values].map((line) => line.map(escape).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${reportType}-${from}-${through}.csv`; link.click(); URL.revokeObjectURL(url)
        return
      }
      const fetchReport = reportType === 'trip-log' ? fetchTripLogReport : reportType === 'monthly-summary' ? fetchMonthlySummaryReport : reportType === 'places' ? fetchPlaceReport : reportType === 'data-completeness' ? fetchDataCompletenessReport : reportType === 'events' ? fetchEventReport : reportType === 'utilization' ? fetchUtilizationReport : reportType === 'business-mileage' ? fetchBusinessMileageReport : fetchUsageSummaryReport
      const effectiveGroupBy = reportType === 'monthly-summary' ? 'month' : groupBy
      const blob = await fetchReport(baseUrl, { from, to: through, groupBy: effectiveGroupBy, timeZone, units, vehicleId: vehicleId || undefined, tagId: tagId || undefined, format: 'csv' })
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `usage-summary-${from}-${through}.csv`; link.click(); URL.revokeObjectURL(url)
    } catch (err) { setError(err instanceof Error ? err.message : 'CSV export failed') }
  }

  const exportJson = () => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${reportType}-${from}-${through}.json`; link.click(); URL.revokeObjectURL(url)
  }

  const exportPdf = () => {
    if (!report?.rows?.length) return
    const table = document.querySelector('.report-workspace-table-wrap table')
    if (!table) { setError('The report table is not available for PDF export.'); return }
    const printWindow = window.open('', '_blank', 'width=1100,height=800')
    if (!printWindow) { setError('The PDF print window was blocked. Allow popups for this site and try again.'); return }
    printWindow.document.write(`<!doctype html><html><head><title>${reportType} ${from} to ${through}</title><style>body{font-family:Arial,sans-serif;color:#111;padding:24px}h1{font-size:20px}p{color:#444}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}</style></head><body><h1>${reportType.replaceAll('-', ' ')}</h1><p>${from} through ${through}</p>${table.outerHTML}</body></html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.onload = () => { printWindow.print() }
  }

  const showsGroupBy = ['usage-summary', 'monthly-summary', 'utilization'].includes(reportType)
  const showsUnits = ['usage-summary', 'trip-log', 'monthly-summary', 'utilization', 'business-mileage', 'speed-bands', 'racer'].includes(reportType)

  const workspace = <div className="modal-backdrop report-workspace-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="report-workspace" role="dialog" aria-modal="true" aria-label="Reports">
      <div className="modal-header"><div><h2>Reports</h2><small>Usage summary across authorized vehicles and trips</small></div><button type="button" className="small secondary" onClick={onClose}>Close</button></div>
      <div className="report-workspace-filters">
        <label>Report<select value={reportType} onChange={(event) => selectReportType(event.target.value)}><option value="usage-summary">Usage Summary</option><option value="trip-log">Trip Log</option><option value="monthly-summary">Monthly Summary</option><option value="places">Named Places</option><option value="data-completeness">Data Completeness</option><option value="events">Driving Events</option><option value="utilization">Utilization Calendar</option><option value="business-mileage">Business Mileage</option><option value="speed-bands">Speed Bands</option><option value="racer">Racer Report</option><option value="vehicle-health">Vehicle Health</option><option value="tracker-health">Tracker Health</option></select></label>
        <label>Vehicle<select value={vehicleId} onChange={(event) => { setVehicleId(event.target.value); setTagId(''); setReport(null) }}><option value="">All authorized vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.displayName || vehicle.name || 'Unnamed vehicle'}</option>)}</select></label>
        <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Through<input type="date" value={through} onChange={(event) => setThrough(event.target.value)} /></label>
        {showsGroupBy && <label>Group by<select value={reportType === 'monthly-summary' ? 'month' : groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="trip">Trip</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></label>}
         {showsUnits && <label>Units<select value={units} onChange={(event) => { updateSetting?.('displayUnits', event.target.value); setReport(null) }}><option value="imperial">Imperial</option><option value="metric">Metric</option></select></label>}
        <label>Tag<select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">All tags</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
         <button type="button" onClick={run} disabled={busy || (['vehicle-health', 'tracker-health', 'racer'].includes(reportType) && bindingHistoryStatus === 'loading')}>{busy ? 'Running…' : ['vehicle-health', 'tracker-health', 'racer'].includes(reportType) && bindingHistoryStatus === 'loading' ? 'Loading bindings…' : 'Run report'}</button>
      </div>
      {error && <div className="report-workspace-message" role="alert">{error}</div>}
      {report && <>
        {report.warnings?.map((warning) => <div key={warning} className="report-workspace-message" role="status">{warning}</div>)}
        {reportType === 'racer' ? <div className="report-summary-cards"><div><strong>{report.summary.courses}</strong><span>Courses</span></div><div><strong>{report.summary.lapCount}</strong><span>Laps</span></div><div><strong>{report.summary.bestLapSeconds == null ? '—' : `${report.summary.bestLapSeconds.toFixed(3)} s`}</strong><span>Best lap</span></div><div><strong>{report.summary.averageLapSeconds == null ? '—' : `${report.summary.averageLapSeconds.toFixed(3)} s`}</strong><span>Average lap</span></div><div><strong>{report.summary.dragRunCount}</strong><span>Drag runs</span></div><div><strong>{report.summary.bestDragSeconds == null ? '—' : `${report.summary.bestDragSeconds.toFixed(3)} s`}</strong><span>Best drag run</span></div><div><strong>{report.summary.splitCount}</strong><span>Split passages</span></div></div> : reportType === 'places' ? <div className="report-summary-cards"><div><strong>{report.summary.placeCount}</strong><span>Places</span></div><div><strong>{report.summary.visitCount}</strong><span>Visits</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Trip distance</span></div><div><strong>{minutes(report.summary.durationSeconds)}</strong><span>Trip time</span></div></div> : reportType === 'data-completeness' ? <div className="report-summary-cards"><div><strong>{report.summary.tripCount}</strong><span>Trips</span></div><div><strong>{report.summary.tripsWithoutMaxSpeed}</strong><span>Without max speed</span></div><div><strong>{report.summary.tripsWithoutRoute}</strong><span>Without route</span></div><div><strong>{report.summary.tripsWithoutTelemetry}</strong><span>Without telemetry</span></div><div><strong>{report.summary.sourceCount}</strong><span>Sources</span></div></div> : reportType === 'events' ? <div className="report-summary-cards"><div><strong>{report.summary.eventCount}</strong><span>Events</span></div><div><strong>{report.summary.eventTypes}</strong><span>Event types</span></div><div><strong>{report.summary.vehicles}</strong><span>Vehicles</span></div></div> : reportType === 'utilization' ? <div className="report-summary-cards"><div><strong>{report.summary.activeDays}</strong><span>Active days</span></div><div><strong>{report.summary.tripCount}</strong><span>Trips</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Distance</span></div><div><strong>{minutes(report.summary.durationSeconds)}</strong><span>Driving time</span></div></div> : reportType === 'speed-bands' ? <div className="report-summary-cards"><div><strong>{report.summary.vehicles}</strong><span>Vehicles</span></div><div><strong>{report.summary.routeVehicles}</strong><span>With routes</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Covered distance</span></div></div> : reportType === 'tracker-health' ? <div className="report-summary-cards"><div><strong>{report.summary.vehicles}</strong><span>Vehicles</span></div><div><strong>{report.summary.samples}</strong><span>Telemetry samples</span></div></div> : reportType === 'vehicle-health' ? <div className="report-summary-cards"><div><strong>{report.summary.vehicles}</strong><span>Vehicles</span></div><div><strong>{report.summary.samples}</strong><span>Telemetry samples</span></div></div> : reportType === 'business-mileage' ? <div className="report-summary-cards"><div><strong>{report.summary.tripCount}</strong><span>Trips</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Mileage</span></div><div><strong>{minutes(report.summary.durationSeconds)}</strong><span>Driving time</span></div><div><strong>{report.summary.uncategorizedCount}</strong><span>Uncategorized</span></div></div> : <div className="report-summary-cards"><div><strong>{report.summary.tripCount}</strong><span>Trips</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Distance</span></div><div><strong>{minutes(report.summary.durationSeconds)}</strong><span>Duration</span></div><div><strong>{report.summary.averageTripDistanceMeters == null ? '—' : distance(report.summary.averageTripDistanceMeters, units)}</strong><span>Average trip</span></div><div><strong>{report.summary.averageTripDurationSeconds == null ? '—' : minutes(report.summary.averageTripDurationSeconds)}</strong><span>Average duration</span></div><div><strong>{report.summary.eventCount}</strong><span>Events</span></div><div><strong>{speed(report.summary.maxSpeedMph, units)}</strong><span>Max speed</span></div></div>}
        <div className="report-workspace-actions"><span>{report.rows.length ? `${report.rows.length} rows` : 'No records found for the selected filters.'}</span><div className="report-workspace-export-buttons"><span className="report-export-label">Export</span><button type="button" className="small secondary" onClick={exportJson} disabled={!report.rows.length} title="Download JSON">JSON</button><button type="button" className="small secondary" onClick={exportCsv} disabled={!report.rows.length} title="Download CSV">CSV</button><button type="button" className="small secondary" onClick={exportPdf} disabled={!report.rows.length} title="Print or save as PDF">PDF</button></div></div>
        <ReportTable reportType={reportType} rows={report.rows} units={units} groupBy={groupBy} />
      </>}
    </section>
  </div>
  return createPortal(workspace, document.body)
}

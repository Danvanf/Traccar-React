import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { fetchBusinessMileageReport, fetchDataCompletenessReport, fetchEventReport, fetchMonthlySummaryReport, fetchPlaceReport, fetchSpeedBandReport, fetchTripLogReport, fetchTripTags, fetchUsageSummaryReport, fetchUtilizationReport, fetchVehicleCatalog, fetchVehicleSpeedBands } from '../../lib/vehicleAppApi'
import { DEFAULT_SPEED_BANDS } from '../../lib/speedBands'

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

function ReportTable({ reportType, rows, units, groupBy }) {
  const health = reportType === 'vehicle-health'
  const tracker = reportType === 'tracker-health'
  const speedBands = reportType === 'speed-bands'
  const headers = health ? ['Vehicle', 'Samples', 'Coolant max', 'Max', 'Voltage min', 'RPM max', 'MAF max', 'Throttle max', 'DTC max']
    : tracker ? ['Vehicle', 'Samples', 'Last contact', 'Max gap', 'Satellites', 'HDOP min', 'RSSI min', 'Power min', 'Battery min']
    : speedBands ? ['Vehicle', 'Band', 'Range', 'Distance', 'Points', 'Color']
      : reportType === 'places' ? ['Place', 'Vehicle', 'Visits', 'Arrivals', 'Departures', 'Distance', 'Duration', 'Last visit']
        : reportType === 'data-completeness' ? ['Vehicle', 'Source', 'Trips', 'Without max speed', 'Without route', 'Without telemetry', 'Route points', 'Telemetry points', 'Route coverage', 'Telemetry coverage', 'Events']
          : reportType === 'events' ? ['Vehicle', 'Event', 'Source', 'Count', 'First', 'Last', 'Minimum', 'Maximum', 'Unit', 'High severity']
            : reportType === 'utilization' ? ['Period', 'Vehicle', 'Trips', 'First departure', 'Last arrival', 'Distance', 'Driving time']
              : reportType === 'business-mileage' ? ['Date', 'Vehicle', 'From', 'To', 'Distance', 'Duration', 'Tags', 'Purpose']
      : ['Period', 'Vehicle', reportType === 'trip-log' ? 'From' : 'Trips', ...(reportType === 'trip-log' ? ['To'] : []), 'Distance', 'Duration', 'Max speed', 'Events']
  const cells = (row, index) => {
    if (health) return [row.vehicleName, row.samples, row.coolantMaxC == null ? '—' : `${(row.coolantMaxC * 9 / 5 + 32).toFixed(1)} °F`, row.obdMaxMph == null ? '—' : `${row.obdMaxMph.toFixed(1)} mph`, row.voltageMin == null ? '—' : `${row.voltageMin.toFixed(2)} V`, row.rpmMax == null ? '—' : Math.round(row.rpmMax).toLocaleString(), row.mafMax == null ? '—' : `${row.mafMax.toFixed(2)} g/s`, row.throttleMax == null ? '—' : `${row.throttleMax.toFixed(1)}%`, row.dtcMax == null ? '—' : row.dtcMax]
    if (tracker) return [row.vehicleName, row.samples, row.lastContact ? row.lastContact.toLocaleString() : '—', row.maxGapSeconds ? `${Math.round(row.maxGapSeconds)} s` : '—', row.satellitesMin == null ? '—' : `${row.satellitesMin} - ${row.satellitesMax}`, row.hdopMin ?? '—', row.rssiMin ?? '—', row.powerMin == null ? '—' : `${row.powerMin.toFixed(2)} V`, row.batteryMin == null ? '—' : `${row.batteryMin.toFixed(2)} V`]
    if (speedBands) return [row.vehicleName, row.bandIndex, row.throughMph == null ? `${row.fromMph}+ mph` : `${row.fromMph}—${row.throughMph} mph`, distance(row.distanceMeters, units), row.points, <><span className="report-color-swatch" style={{ backgroundColor: row.color || '#64748b' }} /> <code>{row.color || '—'}</code></>]
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

function numberAttribute(attributes, names, transform = (value) => value) {
  for (const name of names) {
    const value = Number(attributes?.[name])
    if (Number.isFinite(value)) return transform(value, name)
  }
  return null
}

function liveVehicleHealthRows(report, positionsByDevice) {
  const summaries = new Map()
  for (const window of report.traccarWindows || []) {
    const points = (positionsByDevice.get(Number(window.traccarDeviceId)) || []).filter((point) => {
      const time = new Date(point.fixTime || point.deviceTime || point.serverTime).getTime()
      return time >= new Date(window.startedAt).getTime() && time <= new Date(window.endedAt).getTime()
    })
    const current = summaries.get(String(window.vehicleId)) || { vehicleId: window.vehicleId, vehicleName: window.vehicleName, samples: 0, coolantMaxC: null, obdMaxMph: null, voltageMin: null, rpmMax: null, mafMax: null, throttleMax: null, dtcMax: null }
    for (const point of points) {
      const attributes = point.attributes || {}
      const coolant = numberAttribute(attributes, ['io32', 'engineCoolantTemperature', 'coolantTemperature'])
      const obdMph = numberAttribute(attributes, ['io37'], (value) => value * 0.621371) ?? numberAttribute(attributes, ['obdSpeedMph'])
      const voltage = numberAttribute(attributes, ['io51', 'controlModuleVoltage'], (value, name) => name === 'io51' ? value / 1000 : value)
      const rpm = numberAttribute(attributes, ['io36', 'engineRpm', 'rpm'])
      const maf = numberAttribute(attributes, ['io40', 'massAirFlow', 'maf'], (value, name) => name === 'io40' ? value / 100 : value)
      const throttle = numberAttribute(attributes, ['io41', 'throttlePosition', 'throttle'])
      const dtc = numberAttribute(attributes, ['io30', 'dtcCount', 'dtc'])
      current.samples += 1
      if (coolant != null) current.coolantMaxC = current.coolantMaxC == null ? coolant : Math.max(current.coolantMaxC, coolant)
      if (obdMph != null) current.obdMaxMph = current.obdMaxMph == null ? obdMph : Math.max(current.obdMaxMph, obdMph)
      if (voltage != null) current.voltageMin = current.voltageMin == null ? voltage : Math.min(current.voltageMin, voltage)
      if (rpm != null) current.rpmMax = current.rpmMax == null ? rpm : Math.max(current.rpmMax, rpm)
      if (maf != null) current.mafMax = current.mafMax == null ? maf : Math.max(current.mafMax, maf)
      if (throttle != null) current.throttleMax = current.throttleMax == null ? throttle : Math.max(current.throttleMax, throttle)
      if (dtc != null) current.dtcMax = current.dtcMax == null ? dtc : Math.max(current.dtcMax, dtc)
    }
    summaries.set(String(window.vehicleId), current)
  }
  return [...summaries.values()]
}

function liveTrackerHealthRows(report, positionsByDevice) {
  const summaries = new Map()
  for (const window of report.traccarWindows || []) {
    const points = (positionsByDevice.get(Number(window.traccarDeviceId)) || []).filter((point) => {
      const time = new Date(point.fixTime || point.deviceTime || point.serverTime).getTime()
      return time >= new Date(window.startedAt).getTime() && time <= new Date(window.endedAt).getTime()
    }).sort((a, b) => new Date(a.fixTime || a.deviceTime || a.serverTime) - new Date(b.fixTime || b.deviceTime || b.serverTime))
    const current = summaries.get(String(window.vehicleId)) || { vehicleId: window.vehicleId, vehicleName: window.vehicleName, samples: 0, lastContact: null, maxGapSeconds: 0, satellitesMin: null, satellitesMax: null, hdopMin: null, rssiMin: null, powerMin: null, batteryMin: null }
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const timestamp = new Date(point.fixTime || point.deviceTime || point.serverTime)
      const attributes = point.attributes || {}
      current.samples += 1
      if (!current.lastContact || timestamp > current.lastContact) current.lastContact = timestamp
      if (index > 0) current.maxGapSeconds = Math.max(current.maxGapSeconds, (timestamp - new Date(points[index - 1].fixTime || points[index - 1].deviceTime || points[index - 1].serverTime)) / 1000)
      const satellites = numberAttribute(attributes, ['sat', 'satellites'])
      const hdop = numberAttribute(attributes, ['hdop'])
      const rssi = numberAttribute(attributes, ['rssi', 'signal'])
      const power = numberAttribute(attributes, ['power', 'externalVoltage'])
      const battery = numberAttribute(attributes, ['battery', 'batteryVoltage'])
      if (satellites != null) {
        current.satellitesMin = current.satellitesMin == null ? satellites : Math.min(current.satellitesMin, satellites)
        current.satellitesMax = current.satellitesMax == null ? satellites : Math.max(current.satellitesMax, satellites)
      }
      if (hdop != null) current.hdopMin = current.hdopMin == null ? hdop : Math.min(current.hdopMin, hdop)
      if (rssi != null) current.rssiMin = current.rssiMin == null ? rssi : Math.min(current.rssiMin, rssi)
      if (power != null) current.powerMin = current.powerMin == null ? power : Math.min(current.powerMin, power)
      if (battery != null) current.batteryMin = current.batteryMin == null ? battery : Math.min(current.batteryMin, battery)
    }
    summaries.set(String(window.vehicleId), current)
  }
  return [...summaries.values()]
}

export default function ReportsWorkspace({ baseUrl, initialVehicleId, traccarApi, onClose }) {
  const today = dateInputValue(new Date())
  const defaultFromDate = new Date()
  defaultFromDate.setMonth(defaultFromDate.getMonth() - 1)
  const [from, setFrom] = useState(dateInputValue(defaultFromDate))
  const [through, setThrough] = useState(today)
  const [groupBy, setGroupBy] = useState('day')
  const [reportType, setReportType] = useState('usage-summary')
  const [units, setUnits] = useState('imperial')
  const [vehicleId, setVehicleId] = useState('')
  const [tagId, setTagId] = useState('')
  const [vehicles, setVehicles] = useState([])
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
    if (!vehicleId) { setTags([]); return () => { active = false } }
    fetchTripTags(baseUrl, vehicleId).then((values) => { if (active) setTags(values) }).catch(() => { if (active) setTags([]) })
    return () => { active = false }
  }, [baseUrl, vehicleId])

  const run = async () => {
    if (!from || !through) { setError('Choose both a from and through date.'); return }
    if (through < from) { setError('The through date must be on or after the from date.'); return }
    setBusy(true); setError(''); setReport(null)
    try {
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
        const rows = reportType === 'speed-bands' ? liveSpeedBandRows(nextReport, bandsByVehicle, positionsByDevice) : reportType === 'vehicle-health' ? liveVehicleHealthRows(nextReport, positionsByDevice) : liveTrackerHealthRows(nextReport, positionsByDevice)
        nextReport = { ...nextReport, summary: reportType === 'speed-bands' ? { ...nextReport.summary, vehicles: new Set(rows.map((row) => row.vehicleId)).size, routeVehicles: new Set(rows.map((row) => row.vehicleId)).size, distanceMeters: rows.reduce((sum, row) => sum + row.distanceMeters, 0) } : { vehicles: rows.length, samples: rows.reduce((sum, row) => sum + row.samples, 0), tripCount: rows.length, distanceMeters: 0, durationSeconds: 0, averageTripDistanceMeters: null, averageTripDurationSeconds: null, eventCount: 0, maxSpeedMph: null }, warnings: [reportType === 'speed-bands' ? 'Speed Bands currently use Traccar point-speed data only. Bouncie historical trips are excluded because their GPS coordinates do not include speed per point.' : reportType === 'vehicle-health' ? 'Vehicle Health currently uses live Traccar telemetry. Missing fields are shown as unavailable.' : 'Tracker Health currently uses live Traccar telemetry. Missing fields are shown as unavailable.'], rows }
      }
      setReport(nextReport)
    } catch (err) { setReport(null); setError(err instanceof Error ? err.message : 'Report lookup failed') } finally { setBusy(false) }
  }

  const exportCsv = async () => {
    try {
      if (report && (reportType === 'speed-bands' || reportType === 'vehicle-health' || reportType === 'tracker-health')) {
        const headers = reportType === 'speed-bands'
          ? ['Vehicle', 'Band', 'Range', 'Distance meters', 'Points', 'Color']
          : reportType === 'vehicle-health' ? ['Vehicle', 'Samples', 'Coolant max C', 'OBD speed max mph', 'Voltage min V', 'RPM max', 'MAF max g/s', 'Throttle max %', 'DTC max']
            : ['Vehicle', 'Samples', 'Last contact', 'Max gap seconds', 'Satellites min-max', 'HDOP min', 'RSSI min', 'Power min V', 'Battery min V']
        const values = report.rows.map((row) => reportType === 'speed-bands'
          ? [row.vehicleName, row.bandIndex, row.throughMph == null ? `${row.fromMph}+ mph` : `${row.fromMph}-${row.throughMph} mph`, row.distanceMeters, row.points, row.color]
          : reportType === 'vehicle-health' ? [row.vehicleName, row.samples, row.coolantMaxC, row.obdMaxMph, row.voltageMin, row.rpmMax, row.mafMax, row.throttleMax, row.dtcMax]
            : [row.vehicleName, row.samples, row.lastContact?.toISOString(), row.maxGapSeconds, row.satellitesMin == null ? null : `${row.satellitesMin} - ${row.satellitesMax}`, row.hdopMin, row.rssiMin, row.powerMin, row.batteryMin])
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
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `usage-summary-${from}-${through}.json`; link.click(); URL.revokeObjectURL(url)
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
  const showsUnits = ['usage-summary', 'trip-log', 'monthly-summary', 'utilization', 'business-mileage', 'speed-bands'].includes(reportType)

  const workspace = <div className="modal-backdrop report-workspace-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="report-workspace" role="dialog" aria-modal="true" aria-label="Reports">
      <div className="modal-header"><div><h2>Reports</h2><small>Usage summary across authorized vehicles and trips</small></div><button type="button" className="small secondary" onClick={onClose}>Close</button></div>
      <div className="report-workspace-filters">
        <label>Report<select value={reportType} onChange={(event) => selectReportType(event.target.value)}><option value="usage-summary">Usage Summary</option><option value="trip-log">Trip Log</option><option value="monthly-summary">Monthly Summary</option><option value="places">Named Places</option><option value="data-completeness">Data Completeness</option><option value="events">Driving Events</option><option value="utilization">Utilization Calendar</option><option value="business-mileage">Business Mileage</option><option value="speed-bands">Speed Bands</option><option value="vehicle-health">Vehicle Health</option><option value="tracker-health">Tracker Health</option></select></label>
        <label>Vehicle<select value={vehicleId} onChange={(event) => { setVehicleId(event.target.value); setTagId(''); setReport(null) }}><option value="">All authorized vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.displayName || vehicle.name || 'Unnamed vehicle'}</option>)}</select></label>
        <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Through<input type="date" value={through} onChange={(event) => setThrough(event.target.value)} /></label>
        {showsGroupBy && <label>Group by<select value={reportType === 'monthly-summary' ? 'month' : groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="trip">Trip</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></label>}
        {showsUnits && <label>Units<select value={units} onChange={(event) => { setUnits(event.target.value); setReport(null) }}><option value="imperial">Imperial</option><option value="metric">Metric</option></select></label>}
        <label>Tag<select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">All tags</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
        <button type="button" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run report'}</button>
      </div>
      {error && <div className="report-workspace-message" role="alert">{error}</div>}
      {report && <>
        {report.warnings?.map((warning) => <div key={warning} className="report-workspace-message" role="status">{warning}</div>)}
        {reportType === 'places' ? <div className="report-summary-cards"><div><strong>{report.summary.placeCount}</strong><span>Places</span></div><div><strong>{report.summary.visitCount}</strong><span>Visits</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Trip distance</span></div><div><strong>{minutes(report.summary.durationSeconds)}</strong><span>Trip time</span></div></div> : reportType === 'data-completeness' ? <div className="report-summary-cards"><div><strong>{report.summary.tripCount}</strong><span>Trips</span></div><div><strong>{report.summary.tripsWithoutMaxSpeed}</strong><span>Without max speed</span></div><div><strong>{report.summary.tripsWithoutRoute}</strong><span>Without route</span></div><div><strong>{report.summary.tripsWithoutTelemetry}</strong><span>Without telemetry</span></div><div><strong>{report.summary.sourceCount}</strong><span>Sources</span></div></div> : reportType === 'events' ? <div className="report-summary-cards"><div><strong>{report.summary.eventCount}</strong><span>Events</span></div><div><strong>{report.summary.eventTypes}</strong><span>Event types</span></div><div><strong>{report.summary.vehicles}</strong><span>Vehicles</span></div></div> : reportType === 'utilization' ? <div className="report-summary-cards"><div><strong>{report.summary.activeDays}</strong><span>Active days</span></div><div><strong>{report.summary.tripCount}</strong><span>Trips</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Distance</span></div><div><strong>{minutes(report.summary.durationSeconds)}</strong><span>Driving time</span></div></div> : reportType === 'speed-bands' ? <div className="report-summary-cards"><div><strong>{report.summary.vehicles}</strong><span>Vehicles</span></div><div><strong>{report.summary.routeVehicles}</strong><span>With routes</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Covered distance</span></div></div> : reportType === 'tracker-health' ? <div className="report-summary-cards"><div><strong>{report.summary.vehicles}</strong><span>Vehicles</span></div><div><strong>{report.summary.samples}</strong><span>Telemetry samples</span></div></div> : reportType === 'vehicle-health' ? <div className="report-summary-cards"><div><strong>{report.summary.vehicles}</strong><span>Vehicles</span></div><div><strong>{report.summary.samples}</strong><span>Telemetry samples</span></div></div> : reportType === 'business-mileage' ? <div className="report-summary-cards"><div><strong>{report.summary.tripCount}</strong><span>Trips</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Mileage</span></div><div><strong>{minutes(report.summary.durationSeconds)}</strong><span>Driving time</span></div><div><strong>{report.summary.uncategorizedCount}</strong><span>Uncategorized</span></div></div> : <div className="report-summary-cards"><div><strong>{report.summary.tripCount}</strong><span>Trips</span></div><div><strong>{distance(report.summary.distanceMeters, units)}</strong><span>Distance</span></div><div><strong>{minutes(report.summary.durationSeconds)}</strong><span>Duration</span></div><div><strong>{report.summary.averageTripDistanceMeters == null ? '—' : distance(report.summary.averageTripDistanceMeters, units)}</strong><span>Average trip</span></div><div><strong>{report.summary.averageTripDurationSeconds == null ? '—' : minutes(report.summary.averageTripDurationSeconds)}</strong><span>Average duration</span></div><div><strong>{report.summary.eventCount}</strong><span>Events</span></div><div><strong>{speed(report.summary.maxSpeedMph, units)}</strong><span>Max speed</span></div></div>}
        <div className="report-workspace-actions"><span>{report.rows.length ? `${report.rows.length} rows` : 'No records found for the selected filters.'}</span><div className="report-workspace-export-buttons"><span className="report-export-label">Export</span><button type="button" className="small secondary" onClick={exportJson} disabled={!report.rows.length} title="Download JSON">JSON</button><button type="button" className="small secondary" onClick={exportCsv} disabled={!report.rows.length} title="Download CSV">CSV</button><button type="button" className="small secondary" onClick={exportPdf} disabled={!report.rows.length} title="Print or save as PDF">PDF</button></div></div>
        <ReportTable reportType={reportType} rows={report.rows} units={units} groupBy={groupBy} />
      </>}
    </section>
  </div>
  return createPortal(workspace, document.body)
}

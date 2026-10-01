import { useEffect, useState } from 'react'
import { fetchTripTags, fetchVehicleCatalog, fetchVehicleStats } from '../lib/vehicleAppApi'

function formatPeriod(value, groupBy) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString(undefined, groupBy === 'trip'
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'medium' })
}

function VehicleStatsPanel({ baseUrl, vehicleId }) {
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [groupBy, setGroupBy] = useState('trip')
  const [catalogVehicles, setCatalogVehicles] = useState([])
  const [selectedVehicleId, setSelectedVehicleId] = useState(vehicleId ? String(vehicleId) : '')
  const [tags, setTags] = useState([])
  const [tagId, setTagId] = useState('')
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    fetchVehicleCatalog(baseUrl)
      .then((values) => { if (active) setCatalogVehicles(values) })
      .catch(() => { if (active) setCatalogVehicles([]) })
    return () => { active = false }
  }, [baseUrl])
  useEffect(() => {
    if (vehicleId && catalogVehicles.some((vehicle) => String(vehicle.id) === String(vehicleId))) {
      setSelectedVehicleId(String(vehicleId))
    }
  }, [vehicleId, catalogVehicles])
  const effectiveVehicleId = selectedVehicleId || ''
  useEffect(() => {
    let active = true
    if (!effectiveVehicleId) { setTags([]); return () => { active = false } }
    fetchTripTags(baseUrl, effectiveVehicleId)
      .then((values) => { if (active) setTags(values) })
      .catch(() => { if (active) setTags([]) })
    return () => { active = false }
  }, [baseUrl, effectiveVehicleId])
  const run = async () => {
    if (!effectiveVehicleId) { setError('Select a backend-catalog vehicle above to run statistics.'); return }
    try {
      setError('')
      setReport(await fetchVehicleStats(baseUrl, effectiveVehicleId, { from, to, groupBy, tagId: tagId || undefined }))
    } catch (err) { setError(err instanceof Error ? err.message : 'Statistics lookup failed') }
  }
  return <section className="vehicle-stats-panel"><div className="vehicle-stats-header"><div><h3>Vehicle Statistics</h3><small>Statistics use the selected catalog vehicle; map device selection controls the live status card.</small></div><select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="trip">Trip</option><option value="day">Day</option><option value="week">Week</option></select></div><div className="vehicle-stats-filters"><label>Vehicle<select value={effectiveVehicleId} onChange={(event) => { setSelectedVehicleId(event.target.value); setReport(null); setError('') }}><option value="">Select vehicle</option>{catalogVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.displayName || vehicle.name || 'Unnamed vehicle'}</option>)}</select></label><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Through<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label>Tag<select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">All tags</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><button type="button" onClick={run}>Run</button></div>{error && <div className="trip-empty">{error}</div>}{report && <table className="operations-report-table"><thead><tr><th>Period</th><th>Trips</th><th>Distance</th><th>Duration</th><th>Max speed</th><th>Events</th></tr></thead><tbody>{report.rows.length === 0 ? <tr><td colSpan="6" className="vehicle-stats-empty">No records found for this vehicle, date range, and tag filter.</td></tr> : report.rows.map((row, index) => <tr key={index}><td>{formatPeriod(row.period, groupBy)}</td><td>{row.tripCount}</td><td>{(Number(row.distanceMeters || 0) / 1609.344).toFixed(1)} mi</td><td>{Math.round(row.durationSeconds / 60)} min</td><td>{row.maxSpeedMph.toFixed(1)} mph</td><td>{row.eventCount}</td></tr>)}</tbody></table>}</section>
}

export default VehicleStatsPanel

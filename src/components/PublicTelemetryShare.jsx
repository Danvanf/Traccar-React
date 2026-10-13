import { useEffect, useMemo, useState } from 'react'
import TelemetryGraphViewer from './TelemetryGraphViewer.jsx'

function apiPath(token, suffix = '') {
  return `/vehicle-api/api/public/telemetry-shares/${encodeURIComponent(token)}${suffix}`
}

export default function PublicTelemetryShare({ token }) {
  const [share, setShare] = useState(null)
  const [selectedTrip, setSelectedTrip] = useState(null)
  const [tripData, setTripData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(apiPath(token), { headers: { Accept: 'application/json' } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('This shared telemetry link is unavailable or expired.')))
      .then((value) => { if (!cancelled) { setShare(value); setSelectedTrip(value.trips?.[0]?.tripKey || null) } })
      .catch((reason) => { if (!cancelled) setError(reason.message) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!selectedTrip) return undefined
    let cancelled = false
    fetch(apiPath(token, `/trips/${selectedTrip}`), { headers: { Accept: 'application/json' } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('The selected trip is no longer available.')))
      .then((value) => { if (!cancelled) setTripData(value) })
      .catch((reason) => { if (!cancelled) setError(reason.message) })
    return () => { cancelled = true }
  }, [token, selectedTrip])

  const groups = useMemo(() => tripData ? [{ points: (tripData.points || []).map((point) => ({
    timestamp: point.occurredAt,
    attributes: point.values || {},
  })) }] : [], [tripData])
  const publicProfile = useMemo(() => ({
    getAttributeHeader: (key) => {
      const series = (share?.series || []).find((item) => item.fieldKey === key)
      return series ? `${series.label}${series.unit ? `, ${series.unit}` : ''}` : key
    },
  }), [share])

  async function exportTrip() {
    const response = await fetch(apiPath(token, `/trips/${selectedTrip}/export.csv`), { headers: { Accept: 'text/csv' } })
    if (!response.ok) return
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `telemetry-${selectedTrip}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  async function exportJson() {
    const response = await fetch(apiPath(token, `/trips/${selectedTrip}/export.json`), { headers: { Accept: 'application/json' } })
    if (!response.ok) return
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `telemetry-${selectedTrip}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <main className="public-share-page"><section className="public-share-card"><h1>Telemetry share unavailable</h1><p>{error}</p></section></main>
  if (!share) return <main className="public-share-page"><section className="public-share-card"><p>Loading shared telemetry…</p></section></main>

  return <main className="public-share-page">
    <section className="public-share-card">
      <header><h1>{share.title || 'Shared telemetry graph'}</h1><p>{share.vehicle} · {new Date(share.fromUtc).toLocaleDateString()}–{new Date(share.throughUtc).toLocaleDateString()}</p>{share.message && <p>{share.message}</p>}</header>
      <label className="public-share-trip-picker">Trip<select value={selectedTrip || ''} onChange={(event) => setSelectedTrip(event.target.value)}>{(share.trips || []).map((trip) => <option key={trip.tripKey} value={trip.tripKey}>{new Date(trip.startedAt).toLocaleString()} – {new Date(trip.endedAt).toLocaleTimeString()}</option>)}</select></label>
      {tripData && <><TelemetryGraphViewer groups={groups} profile={publicProfile} publicMode title="Shared telemetry" onClose={() => {}} />{share.allowExport && <div className="public-share-export"><button type="button" className="small secondary" onClick={exportTrip}>Export CSV</button><button type="button" className="small secondary" onClick={exportJson}>Export JSON</button></div>}</>}
      {!tripData && <p>Loading trip telemetry…</p>}
    </section>
  </main>
}

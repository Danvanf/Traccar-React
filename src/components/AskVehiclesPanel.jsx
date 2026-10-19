import { useEffect, useState } from 'react'
import { fetchUsageSummaryReport, fetchVehicleCatalog } from '../lib/traccarScopeApi'
import { parseVehicleQuestion, summarizeVehicleReport } from '../lib/vehicleQuery'

const EXAMPLES = [
  'How many miles did the Silverado drive last week?',
  'How many trips did the Enclave make yesterday?',
  'What was the highest speed this month?',
  'How much driving time was there in the last 7 days?',
]

const METRIC_LABELS = {
  distance: 'Distance driven',
  'trip-count': 'Trips',
  'driving-time': 'Driving time',
  'event-count': 'Recorded events',
  'max-speed': 'Highest recorded speed',
}

function formatValue(metric, value, units) {
  if (value == null || !Number.isFinite(Number(value))) return 'No value recorded'
  if (metric === 'distance') {
    const distance = units === 'metric' ? Number(value) / 1000 : Number(value) / 1609.344
    return `${distance.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units === 'metric' ? 'km' : 'mi'}`
  }
  if (metric === 'driving-time') {
    const minutes = Math.round(Number(value) / 60)
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    return hours ? `${hours} hr ${remainder} min` : `${remainder} min`
  }
  if (metric === 'max-speed') {
    const speed = units === 'metric' ? Number(value) * 1.609344 : Number(value)
    return `${speed.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units === 'metric' ? 'km/h' : 'mph'}`
  }
  return Number(value).toLocaleString()
}

export default function AskVehiclesPanel({ baseUrl, displayUnits = 'imperial', onClose }) {
  const [question, setQuestion] = useState('')
  const [vehicles, setVehicles] = useState([])
  const [vehicleLoadError, setVehicleLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState(null)
  const units = displayUnits === 'metric' ? 'metric' : 'imperial'
  const interpretation = answer?.plan

  useEffect(() => {
    let active = true
    fetchVehicleCatalog(baseUrl)
      .then((values) => { if (active) setVehicles(Array.isArray(values) ? values : []) })
      .catch(() => { if (active) setVehicleLoadError('Vehicle names could not be loaded. You can still ask about all accessible vehicles.') })
    return () => { active = false }
  }, [baseUrl])

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const ask = async (event) => {
    event.preventDefault()
    setError('')
    setAnswer(null)
    const plan = parseVehicleQuestion(question, vehicles)
    if (plan.error) { setError(plan.error); return }
    setBusy(true)
    try {
      const from = new Date(`${plan.from}T00:00:00`)
      const to = new Date(`${plan.to}T23:59:59.999`)
      const report = await fetchUsageSummaryReport(baseUrl, {
        from,
        to,
        groupBy: 'day',
        vehicleId: plan.vehicleId || undefined,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        units,
      })
      setAnswer({ plan, rows: summarizeVehicleReport(report, plan.metric) })
    } catch (requestError) {
      setError(requestError?.message || 'The vehicle report could not be loaded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ask-vehicles-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="ask-vehicles-dialog" role="dialog" aria-modal="true" aria-labelledby="ask-vehicles-title">
        <header className="ask-vehicles-header">
          <div><h2 id="ask-vehicles-title">Ask about your vehicles</h2><p>Ask a question about trips and driving activity.</p></div>
          <button type="button" className="ask-vehicles-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={ask}>
          <label className="ask-vehicles-question-label" htmlFor="ask-vehicles-question">Your question</label>
          <textarea id="ask-vehicles-question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} autoFocus placeholder="For example: How many miles did the Silverado drive last week?" />
          <div className="ask-vehicles-actions"><button type="submit" disabled={busy || !question.trim()}>{busy ? 'Looking…' : 'Ask'}</button></div>
        </form>
        <div className="ask-vehicles-examples" aria-label="Example questions">
          <span>Try:</span>{EXAMPLES.map((example) => <button type="button" key={example} onClick={() => { setQuestion(example); setError(''); setAnswer(null) }}>{example}</button>)}
        </div>
        {vehicleLoadError && <p className="ask-vehicles-note">{vehicleLoadError}</p>}
        {error && <div className="ask-vehicles-error" role="alert">{error}</div>}
        {answer && <div className="ask-vehicles-result" aria-live="polite">
          <p className="ask-vehicles-interpretation">I understood: <strong>{METRIC_LABELS[interpretation.metric]}</strong> for <strong>{interpretation.vehicleName}</strong>, {interpretation.rangeLabel} ({interpretation.from} to {interpretation.to}).</p>
          {answer.rows.length ? <ul>{answer.rows.map((row) => <li key={row.vehicleId || row.vehicleName}><span>{row.vehicleName}</span><strong>{formatValue(interpretation.metric, row.value, units)}</strong></li>)}</ul> : <p>No trips were found for that vehicle and date range.</p>}
          <p className="ask-vehicles-note">Based on saved trip summaries. This first version supports trip count, distance, driving time, highest speed, and recorded event count.</p>
        </div>}
        {!answer && !error && <p className="ask-vehicles-note">This first version understands trip count, distance, driving time, highest speed, and recorded event count. It searches the last 7 days by default when no date range is stated.</p>}
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'

function asUtcDateInput(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function utcStartOfDay(value) {
  return new Date(`${value}T00:00:00.000Z`).toISOString()
}

function utcExclusiveDayAfter(value) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

function apiUrl(baseUrl, path) {
  const base = String(baseUrl || '/traccar-scope-api').replace(/\/+$/, '')
  return new URL(`${base}${path}`, window.location.origin)
}

export default function DeploymentTestTransferPanel({ baseUrl, isAdmin }) {
  const [available, setAvailable] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    if (!isAdmin || !baseUrl) {
      setAvailable(false)
      return () => { active = false }
    }

    fetch(apiUrl(baseUrl, '/api/admin/deployment-transfer/status'), { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json()
      })
      .then((status) => {
        if (!active || !status?.enabled) return
        setFrom(asUtcDateInput(status.defaultFromUtc))
        setTo(asUtcDateInput(status.defaultToUtc))
        setAvailable(true)
      })
      .catch(() => { if (active) setAvailable(false) })

    return () => { active = false }
  }, [baseUrl, isAdmin])

  const download = async () => {
    if (!from || !to) {
      setMessage('Choose both dates before exporting.')
      return
    }
    const fromDate = new Date(`${from}T00:00:00.000Z`)
    const toDate = new Date(`${to}T00:00:00.000Z`)
    if (fromDate >= toDate) {
      setMessage('The end date must be after the start date.')
      return
    }

    setBusy(true)
    setMessage('Preparing the archive. This can take a few minutes for a large history.')
    try {
      const url = apiUrl(baseUrl, '/api/admin/deployment-transfer/export')
      url.searchParams.set('from', utcStartOfDay(from))
      url.searchParams.set('to', utcExclusiveDayAfter(to))
      const response = await fetch(url, { credentials: 'include' })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || error?.title || `Export failed (${response.status}).`)
      }
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'traccar-scope-api-deployment-test.zip'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      setMessage('Export downloaded. It contains sensitive vehicle locations and telemetry; store and transfer it securely.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create the export.')
    } finally {
      setBusy(false)
    }
  }

  if (!available) return null

  return (
    <section className="profile-editor deployment-transfer-panel">
      <h4>Deployment test data export</h4>
      <p className="profile-editor-help">Create a ZIP for a fresh test installation. It includes Traccar positions and selected Traccar Scope API history, including custom telemetry profiles and revisions. It excludes user accounts, passwords, provider secrets, and server settings.</p>
      <p className="profile-editor-help"><strong>Privacy:</strong> the archive contains exact GPS locations, raw telemetry, and device identifiers. Keep it private and delete it when the test is complete.</p>
      <div className="settings-grid">
        <label>From date (UTC)<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} disabled={busy} /></label>
        <label>Through date (UTC)<input type="date" value={to} onChange={(event) => setTo(event.target.value)} disabled={busy} /></label>
      </div>
      <div className="actions">
        <button type="button" onClick={download} disabled={busy}>{busy ? 'Preparing export…' : 'Download data export'}</button>
        {message && <span role="status">{message}</span>}
      </div>
    </section>
  )
}

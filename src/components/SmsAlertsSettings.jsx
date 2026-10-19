import { useEffect, useState } from 'react'
import {
  fetchSmsAlertHistory,
  fetchSmsAlertPreferences,
  requestSmsAlertVerification,
  saveSmsAlertPreferences,
  verifySmsAlertCode,
} from '../lib/traccarScopeApi'

const EVENTS = {
  maximum_speed: 'Maximum speed',
  hard_braking: 'Hard braking',
  hard_acceleration: 'Hard acceleration',
  long_idle: 'Long idle',
}

export default function SmsAlertsSettings({ baseUrl, vehicleAuth, vehicles }) {
  const [draft, setDraft] = useState(null)
  const [verified, setVerified] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [automaticAlertsReady, setAutomaticAlertsReady] = useState(false)
  const [code, setCode] = useState('')
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refreshHistory = async () => {
    try { setHistory(await fetchSmsAlertHistory(baseUrl)) } catch (error) { setMessage(error.message) }
  }

  const refreshPreferences = async () => {
    const value = await fetchSmsAlertPreferences(baseUrl)
    setDraft({
      phone: value.phone || '',
      enabled: Boolean(value.enabled),
      eventTypes: value.eventTypes || [],
      vehicleIds: value.vehicleIds || [],
      dailyLimit: value.dailyLimit || 5,
    })
    setVerified(Boolean(value.verified))
    setStopped(Boolean(value.stopped))
    setAutomaticAlertsReady(Boolean(value.automaticAlertsReady))
  }

  useEffect(() => {
    if (!vehicleAuth?.authenticated) return
    let active = true
    Promise.all([fetchSmsAlertPreferences(baseUrl), fetchSmsAlertHistory(baseUrl)])
      .then(([value, rows]) => {
        if (!active) return
        setDraft({
          phone: value.phone || '', enabled: Boolean(value.enabled), eventTypes: value.eventTypes || [],
          vehicleIds: value.vehicleIds || [], dailyLimit: value.dailyLimit || 5,
        })
        setVerified(Boolean(value.verified))
        setStopped(Boolean(value.stopped))
        setAutomaticAlertsReady(Boolean(value.automaticAlertsReady))
        setHistory(rows)
        setMessage('')
      })
      .catch((error) => { if (active) setMessage(error.message) })
    return () => { active = false }
  }, [baseUrl, vehicleAuth?.authenticated, vehicleAuth?.username])

  const toggle = (key, value) => setDraft((current) => ({
    ...current,
    [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
  }))

  const save = async () => {
    setBusy(true)
    setMessage('')
    try {
      const result = await saveSmsAlertPreferences(baseUrl, draft)
      setVerified(Boolean(result.verified))
      await refreshPreferences()
      setMessage(result.verified ? 'SMS alert settings saved.' : 'Settings saved. Verify this phone number before alerts can be sent.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const requestCode = async () => {
    setBusy(true)
    setMessage('')
    try {
      await requestSmsAlertVerification(baseUrl)
      setMessage('Verification text requested. It may take a short time to arrive.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const verify = async () => {
    setBusy(true)
    setMessage('')
    try {
      await verifySmsAlertCode(baseUrl, code)
      setCode('')
      setVerified(true)
      setMessage('Phone number verified. SMS alerts are enabled for the selected events.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  return <div className="profile-editor">
    <h4>SMS Alerts</h4>
    {!vehicleAuth?.authenticated && <p className="profile-editor-help">Sign in to set up SMS alerts.</p>}
    {vehicleAuth?.authenticated && !draft && <p className="profile-editor-help">{message ? 'SMS alert preferences are unavailable.' : 'Loading SMS alert preferences…'}</p>}
    {draft && <>
      {!automaticAlertsReady && <p className="profile-editor-help">Automatic SMS alerts need a configured Twilio account and authenticated HTTPS webhook URLs. An administrator can review the setup requirements in the communications plan.</p>}
      <label>Phone number
        <input type="tel" autoComplete="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="+15551234567" />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
        I agree to receive recurring automated vehicle event alert texts at this number. Message frequency varies; message and data rates may apply. Reply STOP to opt out.
      </label>
      {stopped && <p className="profile-editor-help">This number opted out by texting STOP. Text START to the configured Traccar Scope API number before enabling alerts again.</p>}
      <h5>Events to text</h5>
      {Object.entries(EVENTS).map(([eventType, label]) => <label className="checkbox-row" key={eventType}>
        <input type="checkbox" checked={draft.eventTypes.includes(eventType)} onChange={() => toggle('eventTypes', eventType)} />{label}
      </label>)}
      <h5>Vehicles</h5>
      <p className="profile-editor-help">Leave every vehicle unchecked to include all vehicles you can access.</p>
      {vehicles.map((vehicle) => <label className="checkbox-row" key={vehicle.id}>
        <input type="checkbox" checked={draft.vehicleIds.includes(vehicle.id)} onChange={() => toggle('vehicleIds', vehicle.id)} />
        {vehicle.displayName || vehicle.name || vehicle.id}
      </label>)}
      <label>Maximum texts per day
        <input type="number" min="1" max="25" value={draft.dailyLimit} onChange={(event) => setDraft({ ...draft, dailyLimit: Number(event.target.value) })} />
      </label>
      <div className="actions"><button type="button" onClick={save} disabled={busy}>Save SMS Alerts</button></div>
      <p className="profile-editor-help">{verified ? 'Phone number verified.' : 'Phone number needs verification before SMS alerts are sent.'}</p>
      {!verified && draft.enabled && <div className="actions"><button type="button" className="secondary" onClick={requestCode} disabled={busy || !automaticAlertsReady}>Send Verification Code</button></div>}
      {!verified && draft.enabled && <>
        <label>Verification code<input inputMode="numeric" maxLength="8" value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <div className="actions"><button type="button" className="secondary" onClick={verify} disabled={busy || !/^\d{8}$/.test(code)}>Verify Phone</button></div>
      </>}
      <h5>Recent SMS delivery</h5>
      <div className="actions"><button type="button" className="secondary" onClick={refreshHistory}>Refresh Delivery History</button></div>
      {history.length === 0 && <p className="profile-editor-help">No SMS alerts have been queued.</p>}
      {history.length > 0 && <ul>{history.map((item) => <li key={item.id}>
        {item.vehicleName}: {EVENTS[item.eventType] || item.eventType} — {item.status}
        {item.status === 'accepted' && item.deliveryStatus !== 'pending' ? ` · ${item.deliveryStatus}` : ''}
        {item.providerErrorCode ? ` (provider error ${item.providerErrorCode})` : ''}
        {item.reason ? ` (${item.reason})` : ''}
        <small> · {new Date(item.createdAt).toLocaleString()}</small>
      </li>)}</ul>}
    </>}
    {message && <div className="profile-editor-status">{message}</div>}
  </div>
}

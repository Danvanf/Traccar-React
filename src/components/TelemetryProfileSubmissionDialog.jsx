import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildTelemetryProfileSubmissionDraft,
  collectTelemetryPositionFields,
  TELEMETRY_PROFILE_MAX_RANGE_DAYS,
  TELEMETRY_PROFILE_SUPPORT_EMAIL,
} from '../lib/telemetryProfileSubmission'
import { downloadTelemetryProfileProposalArchive, fetchTelemetryProfileSubmissionStatus, submitTelemetryProfileProposal } from '../lib/traccarReactApi'

function localDateValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function initialDateRange() {
  const through = new Date()
  const from = new Date(through)
  from.setDate(from.getDate() - 6)
  return { from: localDateValue(from), through: localDateValue(through) }
}

function localDateStartIso(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString()
}

function nextLocalDateStartIso(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day + 1, 0, 0, 0, 0).toISOString()
}

function rangeDayCount(from, through) {
  if (!from || !through) return 0
  const start = Date.parse(from + 'T00:00:00Z')
  const end = Date.parse(through + 'T00:00:00Z')
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86400000) + 1 : 0
}

function timestampValue(point) {
  const value = point?.fixTime || point?.deviceTime || point?.serverTime || point?.timestamp
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export default function TelemetryProfileSubmissionDialog({
  profile,
  devices = [],
  defaultDeviceId,
  apiBaseUrl,
  fetchDevicePositions,
  onClose,
}) {
  const dates = useMemo(initialDateRange, [])
  const [fromDate, setFromDate] = useState(dates.from)
  const [throughDate, setThroughDate] = useState(dates.through)
  const initialDeviceId = defaultDeviceId ?? devices[0]?.id ?? ''
  const [deviceId, setDeviceId] = useState(initialDeviceId === '' ? '' : String(initialDeviceId))
  const [includeSenderDetails, setIncludeSenderDetails] = useState(false)
  const [excludedPositionFields, setExcludedPositionFields] = useState([])
  const [note, setNote] = useState('')
  const [emailStatus, setEmailStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [positions, setPositions] = useState([])
  const [totalPointCount, setTotalPointCount] = useState(0)
  const [loadingPoints, setLoadingPoints] = useState(false)
  const [sending, setSending] = useState(false)
  const [downloadingArchive, setDownloadingArchive] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const gatherGeneration = useRef(0)
  const currentSelection = useRef({ deviceId, fromDate, throughDate })
  currentSelection.current = { deviceId, fromDate, throughDate }

  useEffect(() => {
    let active = true
    fetchTelemetryProfileSubmissionStatus(apiBaseUrl)
      .then((status) => {
        if (!active) return
        setEmailStatus(status)
        setIncludeSenderDetails(Boolean(status.contactName && status.contactEmail))
      })
      .catch((cause) => {
        if (!active) return
        setStatusError(cause instanceof Error ? cause.message : 'Email setup could not be checked.')
      })
    return () => { active = false }
  }, [apiBaseUrl])

  const dateSpan = rangeDayCount(fromDate, throughDate)
  const profileIsValid = Boolean(profile?.id && profile?.name?.trim())
    && profile.attributeMap && typeof profile.attributeMap === 'object' && !Array.isArray(profile.attributeMap)
  const telemetryFields = useMemo(() => collectTelemetryPositionFields(positions), [positions])
  const excludedFieldSet = useMemo(() => new Set(excludedPositionFields), [excludedPositionFields])
  const includedFieldCount = telemetryFields.reduce((count, field) => count + (excludedFieldSet.has(field.path) ? 0 : 1), 0)
  const supportsSelectableTelemetryFields = emailStatus?.supportsSelectableTelemetryFields === true
  const draft = useMemo(() => {
    if (!profileIsValid || positions.length === 0) return null
    return buildTelemetryProfileSubmissionDraft({
      profile,
      fromDate,
      throughDate,
      positions,
      excludedPositionFields,
      includeSenderDetails,
      contactName: emailStatus?.contactName,
      contactEmail: emailStatus?.contactEmail,
      note,
    })
  }, [emailStatus, excludedPositionFields, fromDate, includeSenderDetails, note, positions, profile, profileIsValid, throughDate])

  function buildDraftFromCurrentState() {
    if (!profileIsValid || positions.length === 0) return null
    return buildTelemetryProfileSubmissionDraft({
      profile,
      fromDate,
      throughDate,
      positions,
      excludedPositionFields,
      includeSenderDetails,
      contactName: emailStatus?.contactName,
      contactEmail: emailStatus?.contactEmail,
      note,
    })
  }

  function clearPrepared() {
    gatherGeneration.current += 1
    setLoadingPoints(false)
    setPositions([])
    setTotalPointCount(0)
    setExcludedPositionFields([])
    setMessage('')
    setError('')
  }

  async function prepareEmail() {
    setError('')
    setMessage('')
    if (!deviceId) { setError('Choose the device whose tracking points should be included.'); return }
    if (!profileIsValid) { setError('The current profile draft is not valid JSON. Correct it before submitting.'); return }
    if (dateSpan < 1) { setError('The end date must be on or after the start date.'); return }
    if (dateSpan > TELEMETRY_PROFILE_MAX_RANGE_DAYS) {
      setError('Choose a date range of ' + TELEMETRY_PROFILE_MAX_RANGE_DAYS + ' days or fewer.')
      return
    }
    setPositions([])
    setTotalPointCount(0)
    setExcludedPositionFields([])
    setLoadingPoints(true)
    const generation = ++gatherGeneration.current
    const selection = { deviceId, fromDate, throughDate }
    try {
      const response = await fetchDevicePositions(
        selection.deviceId,
        localDateStartIso(selection.fromDate),
        nextLocalDateStartIso(selection.throughDate),
      )
      const latest = currentSelection.current
      if (generation !== gatherGeneration.current || latest.deviceId !== selection.deviceId || latest.fromDate !== selection.fromDate || latest.throughDate !== selection.throughDate) return
      const points = (Array.isArray(response) ? response : []).slice().sort((a, b) => timestampValue(a) - timestampValue(b))
      if (points.length === 0) {
        setPositions([])
        setTotalPointCount(0)
        setError('No tracking points were returned for this device and date range. Check the dates and try again.')
        return
      }
      setPositions(points)
      setTotalPointCount(points.length)
      setExcludedPositionFields([])
      setMessage('All returned tracking points and fields are included by default. Turn off any fields you do not want to share, then send directly or open the manual email option.')
    } catch (cause) {
      if (generation === gatherGeneration.current) setError(cause instanceof Error ? cause.message : 'Could not load tracking points for this range.')
    } finally {
      if (generation === gatherGeneration.current) setLoadingPoints(false)
    }
  }

  async function sendEmail() {
    if (!supportsSelectableTelemetryFields) {
      setError('The API must be restarted with the latest update before it can honor the selected fields.')
      return
    }
    const currentDraft = buildDraftFromCurrentState()
    if (!currentDraft) return
    if (includedFieldCount === 0) {
      setError('Include at least one telemetry field before sending the profile suggestion.')
      return
    }
    setSending(true)
    setError('')
    setMessage('')
    try {
      const result = await submitTelemetryProfileProposal(apiBaseUrl, currentDraft.request)
      if (result?.accepted) {
        setMessage('The profile suggestion was accepted by the configured email provider for delivery to ' + TELEMETRY_PROFILE_SUPPORT_EMAIL + '.')
      } else {
        setError('The email provider did not accept the message. Copy the prepared fields below and send them manually.')
      }
    } catch (cause) {
      setError((cause instanceof Error ? cause.message + ' ' : '') + 'Copy the prepared fields below and send them manually.')
    } finally {
      setSending(false)
    }
  }

  async function downloadArchive() {
    if (!supportsSelectableTelemetryFields) {
      setError('The API must be restarted with the latest update before it can honor the selected fields.')
      return
    }
    const currentDraft = buildDraftFromCurrentState()
    if (!currentDraft) return
    if (includedFieldCount === 0) {
      setError('Include at least one telemetry field before downloading the profile suggestion.')
      return
    }
    setDownloadingArchive(true)
    setError('')
    try {
      const result = await downloadTelemetryProfileProposalArchive(apiBaseUrl, currentDraft.request)
      const objectUrl = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = result.fileName || currentDraft.fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      setMessage('Downloaded ' + (result.fileName || draft.fileName) + '. Attach it to the prepared email.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare the ZIP archive.')
    } finally {
      setDownloadingArchive(false)
    }
  }

  async function copyValue(label, value) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyStatus(label + ' copied.')
    } catch {
      setCopyStatus('Clipboard access was blocked. Select and copy the ' + label.toLowerCase() + ' field.')
    }
  }

  function handleDeviceChange(event) {
    setDeviceId(event.target.value)
    clearPrepared()
  }

  function handleFieldToggle(path, included) {
    setExcludedPositionFields((current) => {
      const next = new Set(current)
      if (included) next.delete(path)
      else next.add(path)
      return Array.from(next)
    })
  }

  return (
    <div className="modal-backdrop telemetry-profile-submission-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="telemetry-profile-submission" role="dialog" aria-modal="true" aria-labelledby="telemetry-profile-submission-title">
        <header className="modal-header">
          <div>
            <p className="profile-mapping-kicker">Help improve shared device support</p>
            <h2 id="telemetry-profile-submission-title">Suggest this profile</h2>
          </div>
          <button type="button" className="small secondary" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p>Send the current profile and a sample of tracking points to {TELEMETRY_PROFILE_SUPPORT_EMAIL} for review. Shared profiles are updated by support after validation.</p>
        {profile.isDraft && <p className="telemetry-profile-privacy">This includes your unsaved profile draft. Sending it does not save or publish those changes in the shared system.</p>}
        <p className="telemetry-profile-privacy">The proposed profile and every telemetry field are included by default. Support will use this information only to create or update shared device profiles. The sample can contain identifiers and exact locations; after loading the points, turn off any fields you do not want to share. Your note is also sent, so avoid adding personal details there.</p>

        <div className="telemetry-profile-submission-fields">
          <label>Device used for the sample
            <select value={deviceId} onChange={handleDeviceChange} disabled={devices.length === 0}>
              {devices.length === 0 && <option value="">No devices available</option>}
              {devices.map((device) => <option key={device.id} value={String(device.id)}>{device.name || ('Device ' + device.id)}</option>)}
            </select>
          </label>
          <label>From
            <input type="date" value={fromDate} max={throughDate || undefined} onChange={(event) => { setFromDate(event.target.value); clearPrepared() }} />
          </label>
          <label>Through
            <input type="date" value={throughDate} min={fromDate || undefined} onChange={(event) => { setThroughDate(event.target.value); clearPrepared() }} />
          </label>
        </div>
        <label className="telemetry-profile-note">Note for support
          <textarea value={note} maxLength={2000} rows={3} placeholder="What did you observe? Which fields seem useful?" onChange={(event) => setNote(event.target.value)} />
        </label>
        {emailStatus?.contactName && emailStatus?.contactEmail
          ? <label className="telemetry-profile-gps-choice telemetry-profile-contact-choice">
            <input type="checkbox" checked={includeSenderDetails} onChange={(event) => setIncludeSenderDetails(event.target.checked)} />
            <span>Include my name and email address ({emailStatus.contactName}, {emailStatus.contactEmail}) in the request</span>
          </label>
          : <p className="telemetry-profile-privacy">Your account does not have both a contact name and email address saved, so the request will not identify you.</p>}
        <div className="telemetry-profile-gather-actions">
          <div className="telemetry-profile-submission-actions">
            <button type="button" onClick={prepareEmail} disabled={loadingPoints || sending || devices.length === 0 || !profileIsValid}>
              {loadingPoints ? 'Loading tracking points…' : positions.length ? 'Reload tracking points' : 'Load tracking points and prepare email'}
            </button>
            <span>{dateSpan > 0 ? dateSpan + ' day' + (dateSpan === 1 ? '' : 's') + ' selected' : 'Choose a valid date range'}</span>
          </div>
          {draft && supportsSelectableTelemetryFields && (emailStatus?.ready || statusError) && <button type="button" onClick={sendEmail} disabled={sending || includedFieldCount === 0}>
            {sending ? 'Sending…' : 'Send to support'}
          </button>}
        </div>

        {telemetryFields.length > 0 && <fieldset className="telemetry-profile-field-selection">
          <legend>Telemetry fields included in each point</legend>
          <div className="telemetry-profile-field-selection-toolbar">
            <span>{includedFieldCount.toLocaleString()} of {telemetryFields.length.toLocaleString()} fields included</span>
            <div>
              <button type="button" className="small secondary" onClick={() => setExcludedPositionFields([])}>Include all</button>
              <button type="button" className="small secondary" onClick={() => setExcludedPositionFields(telemetryFields.map((field) => field.path))}>Exclude all</button>
            </div>
          </div>
          <div className="telemetry-profile-field-grid">
            {telemetryFields.map((field) => {
              const included = !excludedFieldSet.has(field.path)
              return <label className="telemetry-profile-field-toggle" key={field.path} title={field.label}>
                <input type="checkbox" role="switch" checked={included} aria-label={'Include ' + field.label} onChange={(event) => handleFieldToggle(field.path, event.target.checked)} />
                <span>{field.label}</span>
              </label>
            })}
          </div>
          {includedFieldCount === 0 && <p className="telemetry-profile-field-empty">Turn on at least one field to send useful telemetry.</p>}
        </fieldset>}

        {statusError && <div className="profile-mapping-notice">The app could not verify email setup or field-selection support. Copy-ready email fields remain available, but sending and ZIP downloads require a verified API connection.</div>}
        {emailStatus && !supportsSelectableTelemetryFields && <div className="profile-mapping-error" role="alert">The API needs to be restarted with the latest update before it can honor these field switches. Sending and ZIP downloads are disabled until then.</div>}
        {emailStatus && !emailStatus.ready && <div className="profile-mapping-notice">App email ({emailStatus.provider || 'provider'}) is unavailable{emailStatus.missingSettings?.length ? ': ' + emailStatus.missingSettings.join(', ') : ''}. Load the tracking points, then open “Send it yourself” to download the ZIP and copy the email fields.</div>}
        {error && <div className="profile-mapping-error" role="alert">{error}</div>}
        {message && <div className="profile-mapping-notice" role="status">{message}</div>}

        {draft && <details className="telemetry-profile-manual-send">
          <summary>Send it yourself (manual email)</summary>
          <section className="telemetry-profile-email-preview" aria-label="Prepared manual email">
          <div className="telemetry-profile-email-heading">
            <strong>Email to support</strong>
            <span>{totalPointCount.toLocaleString()} points included</span>
          </div>
          <div className="telemetry-profile-copy-field">
            <label htmlFor="telemetry-profile-email-to">To</label>
            <input id="telemetry-profile-email-to" readOnly value={draft.to} />
            <button type="button" className="small secondary" onClick={() => copyValue('To', draft.to)}>Copy</button>
          </div>
          <div className="telemetry-profile-copy-field">
            <label htmlFor="telemetry-profile-email-subject">Subject</label>
            <input id="telemetry-profile-email-subject" readOnly value={draft.subject} />
            <button type="button" className="small secondary" onClick={() => copyValue('Subject', draft.subject)}>Copy</button>
          </div>
          <div className="telemetry-profile-copy-field telemetry-profile-copy-body">
            <label htmlFor="telemetry-profile-email-body">Body</label>
            <textarea id="telemetry-profile-email-body" readOnly rows={11} value={draft.body} />
            <button type="button" className="small secondary" onClick={() => copyValue('Body', draft.body)}>Copy</button>
          </div>
          {copyStatus && <p className="telemetry-profile-copy-status" role="status">{copyStatus}</p>}
          <button type="button" className="secondary" onClick={downloadArchive} disabled={downloadingArchive || sending || includedFieldCount === 0 || !supportsSelectableTelemetryFields}>
            {downloadingArchive ? 'Preparing ZIP…' : 'Download selected data ZIP'}
          </button>
          </section>
        </details>}

        <footer className="telemetry-profile-submission-footer">
          <button type="button" className="secondary" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'
import {
  fetchEmailAlertHistory,
  fetchEmailAlertPreferences,
  fetchEmailProviderStatus,
  fetchEmailSenderSettings,
  fetchProviderAccounts,
  checkEmailProviderAccount,
  requestEmailAlertVerification,
  retryUncertainEmailAlert,
  saveEmailAlertPreferences,
  saveEmailSenderSettings,
  saveProviderAccount,
  fetchVehicleEmailProviderAssignments,
  saveVehicleEmailProviderAssignment,
  sendEmailTest,
  verifyEmailAlertCode,
} from '../lib/traccarScopeApi'

const EVENT_LABELS = {
  maximum_speed: 'Maximum speed',
  hard_braking: 'Hard braking',
  hard_acceleration: 'Hard acceleration',
  long_idle: 'Long idle',
}

const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const toTime = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const toMinute = (time) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

const fromOtherEmailAccount = (account) => {
  const setting = (name) => account.settings?.[name] || account.settings?.[name[0].toLowerCase() + name.slice(1)] || ''
  return {
    id: account.id, revision: account.revision, provider: account.provider, name: account.name,
    enabled: account.enabled, isDefault: account.isDefault, from: setting('From'),
    fromEmail: setting('FromEmail'), fromName: setting('FromName'),
    secretConfigured: account.secretConfigured || {},
  }
}

export default function EmailAlertsSettings({ baseUrl, vehicleAuth, vehicles }) {
  const [draft, setDraft] = useState(null)
  const [savedEmail, setSavedEmail] = useState('')
  const [verified, setVerified] = useState(false)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState([])
  const [providerStatus, setProviderStatus] = useState(null)
  const [senderMailbox, setSenderMailbox] = useState('')
  const [retryingId, setRetryingId] = useState(null)
  const [providerAccounts, setProviderAccounts] = useState([])
  const [graphAccount, setGraphAccount] = useState(null)
  const [graphSecret, setGraphSecret] = useState('')
  const [clearGraphSecret, setClearGraphSecret] = useState(false)
  const [otherEmailAccount, setOtherEmailAccount] = useState(null)
  const [otherEmailSecrets, setOtherEmailSecrets] = useState({})
  const [clearOtherEmailSecrets, setClearOtherEmailSecrets] = useState({})
  const [vehicleEmailAccounts, setVehicleEmailAccounts] = useState({})

  useEffect(() => {
    if (!vehicleAuth?.authenticated) return
    let active = true
    fetchEmailAlertPreferences(baseUrl)
      .then((value) => {
        if (!active) return
        setDraft({
          email: value.email || '',
          enabled: Boolean(value.enabled),
          eventTypes: value.eventTypes || [],
          vehicleIds: value.vehicleIds || [],
          dailyLimit: value.dailyLimit || 10,
          quietStartMinute: value.quietStartMinute ?? null,
          quietEndMinute: value.quietEndMinute ?? null,
          quietDeliveryMode: value.quietDeliveryMode || 'suppress',
          timeZoneId: value.timeZoneId || localTimeZone,
        })
        setSavedEmail(value.email || '')
        setVerified(Boolean(value.verified))
        setMessage('')
      })
      .catch((error) => { if (active) setMessage(error.message) })
    fetchEmailAlertHistory(baseUrl)
      .then((rows) => { if (active) setHistory(rows) })
      .catch(() => {})
    if (vehicleAuth?.role === 'admin') {
      fetchEmailProviderStatus(baseUrl)
        .then((status) => { if (active) setProviderStatus(status) })
        .catch(() => {})
      fetchEmailSenderSettings(baseUrl)
        .then((settings) => { if (active) setSenderMailbox(settings.defaultSenderUserId || '') })
        .catch(() => {})
      fetchProviderAccounts(baseUrl)
        .then((accounts) => {
          if (!active) return
          setProviderAccounts(accounts)
          const selected = accounts.find((account) => account.provider === 'Graph' && account.isDefault)
            || accounts.find((account) => account.provider === 'Graph')
          setGraphAccount(selected ? {
            id: selected.id,
            revision: selected.revision,
            name: selected.name,
            tenantId: selected.settings.tenantId || selected.settings.TenantId || '',
            clientId: selected.settings.clientId || selected.settings.ClientId || '',
            enabled: selected.enabled,
            isDefault: selected.isDefault,
            secretConfigured: Boolean(selected.secretConfigured?.ClientSecret),
          } : null)
          const other = accounts.find((account) => ['Resend', 'Brevo'].includes(account.provider) && account.isDefault)
            || accounts.find((account) => ['Resend', 'Brevo'].includes(account.provider))
          if (other) setOtherEmailAccount(fromOtherEmailAccount(other))
        })
        .catch((error) => { if (active) setMessage(error.message) })
      fetchVehicleEmailProviderAssignments(baseUrl)
        .then((assignments) => { if (active) setVehicleEmailAccounts(assignments) })
        .catch((error) => { if (active) setMessage(error.message) })
    }
    return () => { active = false }
  }, [baseUrl, vehicleAuth?.authenticated, vehicleAuth?.username, vehicleAuth?.role])

  const save = async () => {
    setBusy(true)
    setMessage('')
    try {
      const result = await saveEmailAlertPreferences(baseUrl, draft)
      setSavedEmail(draft.email.trim())
      setVerified(Boolean(result.verified))
      setMessage(result.verified ? 'Email alert preferences saved.' : 'Preferences saved. Verify this email address before alerts can send.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const sendCode = async () => {
    setBusy(true)
    setMessage('')
    try {
      await requestEmailAlertVerification(baseUrl)
      setMessage(`Verification code sent to ${savedEmail}. It expires in 15 minutes.`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    setMessage('')
    try {
      await verifyEmailAlertCode(baseUrl, code.trim())
      setVerified(true)
      setCode('')
      setMessage('Email address verified. Selected alerts can now send.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async () => {
    setBusy(true)
    setMessage('')
    try {
      await sendEmailTest(baseUrl, draft.email.trim())
      setMessage(`The provider accepted a test email for ${draft.email.trim()}. Check that inbox.`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const saveSenderMailbox = async () => {
    setBusy(true)
    setMessage('')
    try {
      const saved = await saveEmailSenderSettings(baseUrl, senderMailbox.trim())
      setSenderMailbox(saved.defaultSenderUserId || '')
      await refreshProviderStatus()
      setMessage('Graph sender mailbox saved.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const startGraphAccount = (account = null) => {
    setGraphSecret('')
    setClearGraphSecret(false)
    setGraphAccount(account ? {
      id: account.id,
      revision: account.revision,
      name: account.name,
      tenantId: account.settings.tenantId || account.settings.TenantId || '',
      clientId: account.settings.clientId || account.settings.ClientId || '',
      enabled: account.enabled,
      isDefault: account.isDefault,
      secretConfigured: Boolean(account.secretConfigured?.ClientSecret),
    } : { id: null, revision: null, name: '', tenantId: '', clientId: '', enabled: true, isDefault: false, secretConfigured: false })
  }

  const saveGraphAccount = async () => {
    if (!graphAccount) return
    setBusy(true)
    setMessage('')
    try {
      const secrets = {}
      if (graphSecret) secrets.ClientSecret = graphSecret
      else if (clearGraphSecret) secrets.ClientSecret = ''
      const saveResult = await saveProviderAccount(baseUrl, {
        provider: 'Graph',
        name: graphAccount.name,
        enabled: graphAccount.enabled,
        isDefault: graphAccount.isDefault,
        revision: graphAccount.revision,
        settings: { TenantId: graphAccount.tenantId, ClientId: graphAccount.clientId },
        secrets,
      }, graphAccount.id)
      setGraphSecret('')
      setClearGraphSecret(false)
      const accounts = await fetchProviderAccounts(baseUrl)
      setProviderAccounts(accounts)
      const saved = accounts.find((account) => account.id === (graphAccount.id || saveResult.id))
        || accounts.find((account) => account.provider === 'Graph' && account.isDefault)
      startGraphAccount(saved || null)
      await refreshProviderStatus()
      setMessage('Graph account saved. Its secret is stored encrypted by the API.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const checkGraphAccount = async () => {
    if (!graphAccount?.id) return
    setBusy(true)
    setMessage('Checking Microsoft Entra credentials…')
    try {
      const result = await checkEmailProviderAccount(baseUrl, graphAccount.id)
      setMessage(result.message)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const startOtherEmailAccount = (account = null, provider = 'Resend') => {
    setOtherEmailSecrets({})
    setClearOtherEmailSecrets({})
    setOtherEmailAccount(account ? fromOtherEmailAccount(account) : {
      id: null, revision: null, provider, name: '', enabled: true, isDefault: false,
      from: '', fromEmail: '', fromName: '', secretConfigured: {},
    })
  }

  const saveOtherEmailAccount = async () => {
    if (!otherEmailAccount) return
    setBusy(true)
    setMessage('')
    try {
      const secretNames = otherEmailAccount.provider === 'Resend' ? ['ApiKey', 'WebhookSecret'] : ['ApiKey', 'WebhookToken']
      const secrets = {}
      for (const key of secretNames) {
        if (otherEmailSecrets[key]) secrets[key] = otherEmailSecrets[key]
        else if (clearOtherEmailSecrets[key]) secrets[key] = ''
      }
      const settings = otherEmailAccount.provider === 'Resend'
        ? { From: otherEmailAccount.from }
        : { FromEmail: otherEmailAccount.fromEmail, FromName: otherEmailAccount.fromName }
      const result = await saveProviderAccount(baseUrl, {
        provider: otherEmailAccount.provider, name: otherEmailAccount.name, enabled: otherEmailAccount.enabled,
        isDefault: otherEmailAccount.isDefault, revision: otherEmailAccount.revision, settings, secrets,
      }, otherEmailAccount.id)
      setOtherEmailSecrets({})
      setClearOtherEmailSecrets({})
      const accounts = await fetchProviderAccounts(baseUrl)
      setProviderAccounts(accounts)
      const saved = accounts.find((account) => account.id === (otherEmailAccount.id || result.id))
      setOtherEmailAccount(saved ? fromOtherEmailAccount(saved) : null)
      await refreshProviderStatus()
      setMessage(`${otherEmailAccount.provider} account saved. Secrets are stored encrypted by the API.`)
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const saveVehicleEmailAccount = async (vehicleId, accountId) => {
    setBusy(true)
    setMessage('')
    try {
      await saveVehicleEmailProviderAssignment(baseUrl, vehicleId, accountId)
      setVehicleEmailAccounts((current) => {
        const next = { ...current }
        if (accountId) next[vehicleId] = accountId
        else delete next[vehicleId]
        return next
      })
      setMessage('Vehicle email provider account saved. New alerts for this vehicle will use it.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleValue = (key, value) => setDraft((current) => ({
    ...current,
    [key]: current[key].includes(value)
      ? current[key].filter((item) => item !== value)
      : [...current[key], value],
  }))

  const refreshHistory = async () => {
    try {
      setHistory(await fetchEmailAlertHistory(baseUrl))
    } catch (error) {
      setMessage(error.message)
    }
  }

  const retryAfterReview = async (item) => {
    const itemType = item.reason?.startsWith('Graph digest') ? 'digest' : 'alert'
    const confirmed = window.confirm(`Check the Graph sender mailbox Sent Items first. If this ${itemType} is not there, queue one retry now?`)
    if (!confirmed) return
    setRetryingId(item.id)
    try {
      await retryUncertainEmailAlert(baseUrl, item.id)
      setMessage('Retry queued. The email worker will process it shortly.')
      await refreshHistory()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setRetryingId(null)
    }
  }

  const refreshProviderStatus = async () => {
    try {
      setProviderStatus(await fetchEmailProviderStatus(baseUrl))
    } catch (error) {
      setMessage(error.message)
    }
  }

  return <div className="profile-editor">
    <h4>Email Alerts</h4>
    {!vehicleAuth?.authenticated && <p className="profile-editor-help">Sign in to set up email alerts.</p>}
    {vehicleAuth?.authenticated && !draft && <p className="profile-editor-help">{message ? 'Email alert preferences are unavailable.' : 'Loading email alert preferences…'}</p>}
    {draft && <>
      {providerStatus && <p className="profile-editor-help">
        Email provider: {providerStatus.provider} ({providerStatus.configurationSource || 'database'}) — {providerStatus.ready ? 'configured; send a test to check delivery' : 'needs settings'}
        {providerStatus.missingSettings?.length > 0 ? ` (missing ${providerStatus.missingSettings.join(', ')})` : ''}
      </p>}
      {vehicleAuth?.role === 'admin' && <div className="actions">
        <button type="button" className="secondary" onClick={refreshProviderStatus}>Refresh Email Provider Status</button>
      </div>}
      {vehicleAuth?.role === 'admin' && <>
        <h5>Microsoft Graph API account</h5>
        <p className="profile-editor-help">Select a default provider account here. Saving changes applies to subsequent requests without an API restart.</p>
        <label>Graph account
          <select value={graphAccount?.id || ''} onChange={(event) => startGraphAccount(providerAccounts.find((account) => account.id === event.target.value) || null)}>
            <option value="">Select account to edit…</option>
            {providerAccounts.filter((account) => account.provider === 'Graph').map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? ' (default)' : ''}{account.enabled ? '' : ' (disabled)'}</option>)}
          </select>
        </label>
        <div className="actions"><button type="button" className="secondary" onClick={() => startGraphAccount()} disabled={busy}>New Graph Account</button></div>
        {graphAccount && <>
          <label>Account name<input type="text" autoComplete="off" value={graphAccount.name} onChange={(event) => setGraphAccount({ ...graphAccount, name: event.target.value })} /></label>
          <label>Tenant ID<input type="text" autoComplete="off" value={graphAccount.tenantId} onChange={(event) => setGraphAccount({ ...graphAccount, tenantId: event.target.value })} /></label>
          <label>Client ID<input type="text" autoComplete="off" value={graphAccount.clientId} onChange={(event) => setGraphAccount({ ...graphAccount, clientId: event.target.value })} /></label>
          <label>Client secret {graphAccount.secretConfigured ? '(configured; enter a value to replace)' : ''}
            <input type="password" autoComplete="new-password" value={graphSecret} onChange={(event) => setGraphSecret(event.target.value)} placeholder={graphAccount.secretConfigured ? 'Saved secret is not shown' : 'Enter client secret'} />
          </label>
          {vehicleAuth?.role === 'admin' && ['disabled', 'graph'].includes(providerStatus?.provider?.toLowerCase()) && <>
            <label>Graph sender mailbox
              <input type="email" name="graph-sender-mailbox" autoComplete="off" value={senderMailbox} onChange={(event) => setSenderMailbox(event.target.value)} placeholder="alerts@example.com" />
            </label>
            <p className="profile-editor-help">This mailbox sends alerts unless a vehicle has its own sender set in Vehicle Catalog. The Graph app must have permission to send from each selected mailbox.</p>
            <div className="actions"><button type="button" className="secondary" onClick={saveSenderMailbox} disabled={busy}>Save Graph Sender Mailbox</button></div>
          </>}
          {graphAccount.secretConfigured && <label className="checkbox-row"><input type="checkbox" checked={clearGraphSecret} onChange={(event) => setClearGraphSecret(event.target.checked)} />Clear saved client secret</label>}
          <label className="checkbox-row"><input type="checkbox" checked={graphAccount.enabled} onChange={(event) => setGraphAccount({ ...graphAccount, enabled: event.target.checked })} />Enable this account</label>
          <label className="checkbox-row"><input type="checkbox" checked={graphAccount.isDefault} onChange={(event) => setGraphAccount({ ...graphAccount, isDefault: event.target.checked })} />Use as default email provider account</label>
          <div className="actions"><button type="button" className="secondary" onClick={saveGraphAccount} disabled={busy || !graphAccount.name.trim()}>{busy ? 'Saving…' : 'Save Graph Account'}</button></div>
          {graphAccount.id && <div className="actions"><button type="button" className="secondary" onClick={checkGraphAccount} disabled={busy}>Check Graph Credentials</button></div>}
        </>}
      </>}
      {vehicleAuth?.role === 'admin' && <>
        <h5>Resend and Brevo provider accounts</h5>
        <p className="profile-editor-help">These accounts use the same encrypted storage. Only one email account can be the installation default at a time.</p>
        <label>Provider
          <select value={otherEmailAccount?.provider || ''} onChange={(event) => {
            const provider = event.target.value
            const account = providerAccounts.find((item) => item.provider === provider && item.isDefault)
              || providerAccounts.find((item) => item.provider === provider)
            startOtherEmailAccount(account || null, provider || 'Resend')
          }}>
            <option value="">Choose provider…</option><option value="Resend">Resend</option><option value="Brevo">Brevo</option>
          </select>
        </label>
        {otherEmailAccount && <>
          <label>{otherEmailAccount.provider} account
            <select value={otherEmailAccount.id || ''} onChange={(event) => {
              const account = providerAccounts.find((item) => item.id === event.target.value && item.provider === otherEmailAccount.provider)
              startOtherEmailAccount(account || null, otherEmailAccount.provider)
            }}>
              <option value="">New account…</option>
              {providerAccounts.filter((account) => account.provider === otherEmailAccount.provider).map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? ' (default)' : ''}{account.enabled ? '' : ' (disabled)'}</option>)}
            </select>
          </label>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => startOtherEmailAccount(null, 'Resend')} disabled={busy}>New Resend Account</button>
            <button type="button" className="secondary" onClick={() => startOtherEmailAccount(null, 'Brevo')} disabled={busy}>New Brevo Account</button>
          </div>
          <label>Account name<input value={otherEmailAccount.name} onChange={(event) => setOtherEmailAccount({ ...otherEmailAccount, name: event.target.value })} /></label>
          {otherEmailAccount.provider === 'Resend' ? <label>From address<input type="email" name="provider-from-address" autoComplete="off" value={otherEmailAccount.from} onChange={(event) => setOtherEmailAccount({ ...otherEmailAccount, from: event.target.value })} /></label> : <>
            <label>Sender email<input type="email" name="provider-sender-email" autoComplete="off" value={otherEmailAccount.fromEmail} onChange={(event) => setOtherEmailAccount({ ...otherEmailAccount, fromEmail: event.target.value })} /></label>
            <label>Sender name<input value={otherEmailAccount.fromName} onChange={(event) => setOtherEmailAccount({ ...otherEmailAccount, fromName: event.target.value })} /></label>
          </>}
          {['ApiKey', otherEmailAccount.provider === 'Resend' ? 'WebhookSecret' : 'WebhookToken'].map((key) => <div key={key}>
            <label>{key === 'ApiKey' ? 'API key' : key === 'WebhookSecret' ? 'Webhook secret' : 'Webhook token'} {otherEmailAccount.secretConfigured[key] ? '(configured; enter to replace)' : ''}
              <input type="password" autoComplete="new-password" value={otherEmailSecrets[key] || ''} onChange={(event) => setOtherEmailSecrets({ ...otherEmailSecrets, [key]: event.target.value })} placeholder={otherEmailAccount.secretConfigured[key] ? 'Saved secret is not shown' : 'Optional unless required by provider'} />
            </label>
            {otherEmailAccount.secretConfigured[key] && <label className="checkbox-row"><input type="checkbox" checked={Boolean(clearOtherEmailSecrets[key])} onChange={(event) => setClearOtherEmailSecrets({ ...clearOtherEmailSecrets, [key]: event.target.checked })} />Clear saved {key === 'ApiKey' ? 'API key' : 'webhook secret'}</label>}
          </div>)}
          {otherEmailAccount.id && <p className="profile-editor-help">Set the provider’s delivery webhook URL to `/api/email/webhooks/{otherEmailAccount.provider.toLowerCase()}/{otherEmailAccount.id}`. The server validates events with this account’s saved webhook secret or token.</p>}
          <label className="checkbox-row"><input type="checkbox" checked={otherEmailAccount.enabled} onChange={(event) => setOtherEmailAccount({ ...otherEmailAccount, enabled: event.target.checked })} />Enable this account</label>
          <label className="checkbox-row"><input type="checkbox" checked={otherEmailAccount.isDefault} onChange={(event) => setOtherEmailAccount({ ...otherEmailAccount, isDefault: event.target.checked })} />Use as default email provider account</label>
          <div className="actions"><button type="button" className="secondary" onClick={saveOtherEmailAccount} disabled={busy || !otherEmailAccount.name.trim()}>{busy ? 'Saving…' : `Save ${otherEmailAccount.provider} Account`}</button></div>
        </>}
      </>}
      {vehicleAuth?.role === 'admin' && <>
        <h5>Email provider account by vehicle</h5>
        <p className="profile-editor-help">Choose an override for each vehicle, or use the installation default. New alerts retain the selected account when queued; existing alerts keep their original account.</p>
        {vehicles.map((vehicle) => <label key={vehicle.id}>{vehicle.displayName || vehicle.name || vehicle.id}
          <select value={vehicleEmailAccounts[vehicle.id] || ''} disabled={busy} onChange={(event) => saveVehicleEmailAccount(vehicle.id, event.target.value)}>
            <option value="">Use installation default</option>
            {providerAccounts.filter((account) => account.channel === 'email').map((account) => <option key={account.id} value={account.id}>{account.name}{account.enabled ? '' : ' (disabled)'}</option>)}
          </select>
        </label>)}
      </>}

      <p className="profile-editor-help">Email alerts are opt-in. Choose event types and verify the recipient address. Only events recorded within an hour of occurring can create alerts.</p>
      <label className="checkbox-row">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
        Enable email alerts
      </label>
      <label>Alert email address
        <input type="email" name="alert-recipient-address" autoComplete="off" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
      </label>
      {vehicleAuth?.role === 'admin' && providerStatus?.ready && <div className="actions">
        <button type="button" className="secondary" disabled={busy || !draft.email.trim()} onClick={sendTest}>Send Test Email</button>
      </div>}
      <div className="profile-editor-help">{verified && draft.email.trim() === savedEmail ? 'Email address verified.' : 'Email address needs verification.'}</div>
      <h5>Events to email</h5>
      {Object.entries(EVENT_LABELS).map(([eventType, label]) => <label className="checkbox-row" key={eventType}>
        <input type="checkbox" checked={draft.eventTypes.includes(eventType)} onChange={() => toggleValue('eventTypes', eventType)} />{label}
      </label>)}
      <h5>Vehicles</h5>
      <p className="profile-editor-help">Leave every vehicle unchecked to include all vehicles you can access.</p>
      {vehicles.map((vehicle) => <label className="checkbox-row" key={vehicle.id}>
        <input type="checkbox" checked={draft.vehicleIds.includes(vehicle.id)} onChange={() => toggleValue('vehicleIds', vehicle.id)} />
        {vehicle.displayName || vehicle.name || vehicle.id}
      </label>)}
      <label>Maximum emails per day
        <input type="number" min="1" max="50" value={draft.dailyLimit} onChange={(event) => setDraft({ ...draft, dailyLimit: Number(event.target.value) })} />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={draft.quietStartMinute !== null} onChange={(event) => setDraft({
          ...draft,
          quietStartMinute: event.target.checked ? 22 * 60 : null,
          quietEndMinute: event.target.checked ? 7 * 60 : null,
          timeZoneId: event.target.checked ? localTimeZone : draft.timeZoneId,
        })} />Use quiet hours
      </label>
      {draft.quietStartMinute !== null && <>
        <label>During quiet hours
          <select value={draft.quietDeliveryMode} onChange={(event) => setDraft({ ...draft, quietDeliveryMode: event.target.value })}>
            <option value="suppress">Skip alerts</option>
            <option value="digest">Send a digest when quiet hours end</option>
          </select>
        </label>
        <p className="profile-editor-help">{draft.quietDeliveryMode === 'digest' ? 'Digest mode holds alerts until quiet hours end, then sends one email with the events collected for that quiet period.' : 'Skip mode discards alerts that occur during quiet hours.'}</p>
        <div className="settings-grid">
          <label>From<input type="time" value={toTime(draft.quietStartMinute)} onChange={(event) => { if (event.target.value) setDraft({ ...draft, quietStartMinute: toMinute(event.target.value) }) }} /></label>
          <label>Until<input type="time" value={toTime(draft.quietEndMinute)} onChange={(event) => { if (event.target.value) setDraft({ ...draft, quietEndMinute: toMinute(event.target.value) }) }} /></label>
        </div>
        <label>Time zone
          <input type="text" value={draft.timeZoneId} onChange={(event) => setDraft({ ...draft, timeZoneId: event.target.value })} placeholder="America/New_York" />
        </label>
      </>}
      <div className="actions"><button type="button" onClick={save} disabled={busy}>Save Email Alerts</button></div>
      {!verified && savedEmail && draft.email.trim() === savedEmail && <>
        <div className="actions"><button type="button" className="secondary" onClick={sendCode} disabled={busy}>Send Verification Code</button></div>
        <label>Verification code
          <input inputMode="numeric" maxLength="8" value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        <div className="actions"><button type="button" className="secondary" onClick={verify} disabled={busy || !/^\d{8}$/.test(code)}>Verify Email</button></div>
      </>}
      <h5>Recent email delivery</h5>
      <div className="actions"><button type="button" className="secondary" onClick={refreshHistory}>Refresh Delivery History</button></div>
      {history.length === 0 && <p className="profile-editor-help">No email alerts have been queued.</p>}
      {history.length > 0 && <ul>{history.map((item) => <li key={item.id}>
        {item.vehicleName}: {EVENT_LABELS[item.eventType] || item.eventType} — {item.status}
        {item.status === 'accepted' && item.deliveryStatus && item.deliveryStatus !== 'pending' ? ` · ${({ delivered: 'delivered', delayed: 'delivery delayed', bounced: 'bounced', complained: 'marked as spam', failed: 'delivery failed', suppressed: 'suppressed' })[item.deliveryStatus] || item.deliveryStatus}` : ''}
        {item.reason ? ` (${item.reason})` : ''}
        {vehicleAuth?.role === 'admin' && item.canRetryAfterReview && <> <button type="button" className="secondary" disabled={retryingId === item.id} onClick={() => retryAfterReview(item)}>{retryingId === item.id ? 'Queueing…' : 'Retry after Sent Items review'}</button></>}
        <small> · {new Date(item.createdAt).toLocaleString()}</small>
      </li>)}</ul>}
    </>}
    {message && <div className="profile-editor-status">{message}</div>}
  </div>
}

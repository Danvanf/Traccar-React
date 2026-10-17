import { useEffect, useState } from 'react'
import { checkTwilioProviderAccount, fetchProviderAccounts, fetchSmsProviderStatus, fetchVehicleSmsProviderAssignments, importLegacyProviderAccount, saveProviderAccount, saveVehicleSmsProviderAssignment, sendSmsTest } from '../lib/traccarReactApi'

const fromTwilioAccount = (account) => {
  const setting = (name) => account.settings?.[name] || account.settings?.[name[0].toLowerCase() + name.slice(1)] || ''
  return {
    id: account.id, revision: account.revision, name: account.name, enabled: account.enabled, isDefault: account.isDefault,
    accountSid: setting('AccountSid'), apiKeySid: setting('ApiKeySid'), fromNumber: setting('FromNumber'),
    webhookBaseUrl: setting('WebhookBaseUrl'), webhookUsername: setting('WebhookUsername'), testAccountSid: setting('TestAccountSid'),
    secretConfigured: account.secretConfigured || {},
  }
}

const fromTextbeltAccount = (account) => ({
  id: account.id, revision: account.revision, name: account.name, enabled: account.enabled,
  isDefault: account.isDefault, secretConfigured: Boolean(account.secretConfigured?.ApiKey),
})

export default function SmsTestSettings({ baseUrl, vehicles = [] }) {
  const [status, setStatus] = useState(null)
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [providerAccounts, setProviderAccounts] = useState([])
  const [twilioAccount, setTwilioAccount] = useState(null)
  const [twilioSecrets, setTwilioSecrets] = useState({})
  const [clearTwilioSecrets, setClearTwilioSecrets] = useState({})
  const [vehicleSmsAccounts, setVehicleSmsAccounts] = useState({})
  const [textbeltAccount, setTextbeltAccount] = useState(null)
  const [textbeltApiKey, setTextbeltApiKey] = useState('')
  const [clearTextbeltApiKey, setClearTextbeltApiKey] = useState(false)

  useEffect(() => {
    let active = true
    fetchSmsProviderStatus(baseUrl)
      .then((value) => { if (active) setStatus(value) })
      .catch((error) => { if (active) setMessage(error.message) })
    fetchProviderAccounts(baseUrl)
      .then((accounts) => {
        if (!active) return
        setProviderAccounts(accounts)
        const selected = accounts.find((account) => account.provider === 'Twilio' && account.isDefault)
          || accounts.find((account) => account.provider === 'Twilio')
        if (selected) setTwilioAccount(fromTwilioAccount(selected))
        const textbelt = accounts.find((account) => account.provider === 'Textbelt')
        if (textbelt) setTextbeltAccount(fromTextbeltAccount(textbelt))
      })
      .catch((error) => { if (active) setMessage(error.message) })
    fetchVehicleSmsProviderAssignments(baseUrl)
      .then((assignments) => { if (active) setVehicleSmsAccounts(assignments) })
      .catch((error) => { if (active) setMessage(error.message) })
    return () => { active = false }
  }, [baseUrl])

  const startTwilioAccount = (account = null) => {
    setTwilioSecrets({})
    setClearTwilioSecrets({})
    setTwilioAccount(account ? fromTwilioAccount(account) : {
      id: null, revision: null, name: '', enabled: true, isDefault: false,
      accountSid: '', apiKeySid: '', fromNumber: '', webhookBaseUrl: '', webhookUsername: '', testAccountSid: '',
      secretConfigured: {},
    })
  }

  const saveTwilioAccount = async () => {
    if (!twilioAccount) return
    setBusy(true)
    setMessage('')
    try {
      const secrets = {}
      for (const key of ['ApiKeySecret', 'WebhookPassword', 'TestAuthToken']) {
        if (twilioSecrets[key]) secrets[key] = twilioSecrets[key]
        else if (clearTwilioSecrets[key]) secrets[key] = ''
      }
      const result = await saveProviderAccount(baseUrl, {
        provider: 'Twilio', name: twilioAccount.name, enabled: twilioAccount.enabled,
        isDefault: twilioAccount.isDefault, revision: twilioAccount.revision,
        settings: {
          AccountSid: twilioAccount.accountSid, ApiKeySid: twilioAccount.apiKeySid,
          FromNumber: twilioAccount.fromNumber, WebhookBaseUrl: twilioAccount.webhookBaseUrl,
          WebhookUsername: twilioAccount.webhookUsername, TestAccountSid: twilioAccount.testAccountSid,
        },
        secrets,
      }, twilioAccount.id)
      setTwilioSecrets({})
      setClearTwilioSecrets({})
      const accounts = await fetchProviderAccounts(baseUrl)
      setProviderAccounts(accounts)
      startTwilioAccount(accounts.find((account) => account.id === (twilioAccount.id || result.id)) || null)
      setStatus(await fetchSmsProviderStatus(baseUrl))
      setMessage('Twilio account saved. Secrets are stored encrypted by the API.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const checkTwilio = async () => {
    if (!twilioAccount?.id) return
    setBusy(true)
    setMessage('Checking Twilio credentials…')
    try {
      const result = await checkTwilioProviderAccount(baseUrl, twilioAccount.id)
      setMessage(result.authenticated ? `Twilio authenticated the account${result.accountStatus ? ` (${result.accountStatus})` : ''}.` : result.error || 'Twilio account check failed.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const saveVehicleSmsAccount = async (vehicleId, accountId) => {
    setBusy(true)
    setMessage('')
    try {
      await saveVehicleSmsProviderAssignment(baseUrl, vehicleId, accountId)
      setVehicleSmsAccounts((current) => {
        const next = { ...current }
        if (accountId) next[vehicleId] = accountId
        else delete next[vehicleId]
        return next
      })
      setMessage('Vehicle SMS provider account saved. New SMS alerts for this vehicle will use it.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const saveTextbeltAccount = async () => {
    if (!textbeltAccount) return
    setBusy(true)
    setMessage('')
    try {
      const secrets = {}
      if (textbeltApiKey) secrets.ApiKey = textbeltApiKey
      else if (clearTextbeltApiKey) secrets.ApiKey = ''
      const result = await saveProviderAccount(baseUrl, {
        provider: 'Textbelt', name: textbeltAccount.name, enabled: textbeltAccount.enabled,
        isDefault: textbeltAccount.isDefault, revision: textbeltAccount.revision, settings: {}, secrets,
      }, textbeltAccount.id)
      setTextbeltApiKey('')
      setClearTextbeltApiKey(false)
      const accounts = await fetchProviderAccounts(baseUrl)
      setProviderAccounts(accounts)
      const saved = accounts.find((account) => account.id === (textbeltAccount.id || result.id))
      setTextbeltAccount(saved ? fromTextbeltAccount(saved) : null)
      setStatus(await fetchSmsProviderStatus(baseUrl))
      setMessage('Textbelt account saved. Its API key is stored encrypted by the API.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const importLegacySms = async () => {
    setBusy(true)
    setMessage('')
    try {
      const imported = await importLegacyProviderAccount(baseUrl, 'sms')
      const accounts = await fetchProviderAccounts(baseUrl)
      setProviderAccounts(accounts)
      const account = accounts.find((item) => item.id === imported.id)
      if (account?.provider === 'Twilio') startTwilioAccount(account)
      if (account?.provider === 'Textbelt') setTextbeltAccount(fromTextbeltAccount(account))
      setStatus(await fetchSmsProviderStatus(baseUrl))
      setMessage(imported.alreadyImported
        ? 'This legacy SMS configuration was already imported; its saved values were left unchanged.'
        : 'Legacy SMS settings imported as a disabled account. Review it, then enable and select it when ready.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const send = async () => {
    setBusy(true)
    setMessage('')
    try {
      await sendSmsTest(baseUrl, phone.trim(), consent)
      setMessage('The SMS provider accepted the test message. This does not confirm handset delivery.')
      setConsent(false)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="profile-editor">
    <h4>SMS Test</h4>
    <div className="actions"><button type="button" className="secondary" onClick={importLegacySms} disabled={busy}>Import Legacy SMS Settings</button></div>
    <h5>Twilio provider account</h5>
    <p className="profile-editor-help">Database account settings take priority over SMS environment variables and apply without an API restart.</p>
    <label>Twilio account
      <select value={twilioAccount?.id || ''} onChange={(event) => startTwilioAccount(providerAccounts.find((account) => account.id === event.target.value) || null)}>
        <option value="">Select account to edit…</option>
        {providerAccounts.filter((account) => account.provider === 'Twilio').map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? ' (default)' : ''}{account.enabled ? '' : ' (disabled)'}</option>)}
      </select>
    </label>
    <div className="actions"><button type="button" className="secondary" onClick={() => startTwilioAccount()} disabled={busy}>New Twilio Account</button></div>
    {twilioAccount && <>
      <label>Account name<input value={twilioAccount.name} onChange={(event) => setTwilioAccount({ ...twilioAccount, name: event.target.value })} /></label>
      <label>Account SID<input value={twilioAccount.accountSid} onChange={(event) => setTwilioAccount({ ...twilioAccount, accountSid: event.target.value })} /></label>
      <label>API key SID<input value={twilioAccount.apiKeySid} onChange={(event) => setTwilioAccount({ ...twilioAccount, apiKeySid: event.target.value })} /></label>
      <label>API key secret {twilioAccount.secretConfigured.ApiKeySecret ? '(configured; enter to replace)' : ''}<input type="password" autoComplete="new-password" value={twilioSecrets.ApiKeySecret || ''} onChange={(event) => setTwilioSecrets({ ...twilioSecrets, ApiKeySecret: event.target.value })} placeholder={twilioAccount.secretConfigured.ApiKeySecret ? 'Saved secret is not shown' : 'Required for Twilio API access'} /></label>
      {twilioAccount.secretConfigured.ApiKeySecret && <label className="checkbox-row"><input type="checkbox" checked={Boolean(clearTwilioSecrets.ApiKeySecret)} onChange={(event) => setClearTwilioSecrets({ ...clearTwilioSecrets, ApiKeySecret: event.target.checked })} />Clear API key secret</label>}
      <label>From number<input value={twilioAccount.fromNumber} onChange={(event) => setTwilioAccount({ ...twilioAccount, fromNumber: event.target.value })} placeholder="+15551234567" /></label>
      <label>Webhook base URL<input value={twilioAccount.webhookBaseUrl} onChange={(event) => setTwilioAccount({ ...twilioAccount, webhookBaseUrl: event.target.value })} placeholder="https://example.com" /></label>
      <label>Webhook username<input value={twilioAccount.webhookUsername} onChange={(event) => setTwilioAccount({ ...twilioAccount, webhookUsername: event.target.value })} /></label>
      <label>Webhook password {twilioAccount.secretConfigured.WebhookPassword ? '(configured; enter to replace)' : ''}<input type="password" autoComplete="new-password" value={twilioSecrets.WebhookPassword || ''} onChange={(event) => setTwilioSecrets({ ...twilioSecrets, WebhookPassword: event.target.value })} placeholder={twilioAccount.secretConfigured.WebhookPassword ? 'Saved secret is not shown' : 'Required for authenticated callbacks'} /></label>
      {twilioAccount.secretConfigured.WebhookPassword && <label className="checkbox-row"><input type="checkbox" checked={Boolean(clearTwilioSecrets.WebhookPassword)} onChange={(event) => setClearTwilioSecrets({ ...clearTwilioSecrets, WebhookPassword: event.target.checked })} />Clear webhook password</label>}
      <p className="profile-editor-help">For STOP/START handling, configure the Twilio number’s inbound webhook at <code>/api/sms/webhooks/twilio/{'{accountId}'}/inbound</code> and use HTTP Basic Authentication with the configured username and password. Outbound delivery status callbacks use the account-specific route automatically.</p>
      <label>Test account SID (optional)<input value={twilioAccount.testAccountSid} onChange={(event) => setTwilioAccount({ ...twilioAccount, testAccountSid: event.target.value })} /></label>
      <label>Test auth token {twilioAccount.secretConfigured.TestAuthToken ? '(configured; enter to replace)' : ''}<input type="password" autoComplete="new-password" value={twilioSecrets.TestAuthToken || ''} onChange={(event) => setTwilioSecrets({ ...twilioSecrets, TestAuthToken: event.target.value })} placeholder={twilioAccount.secretConfigured.TestAuthToken ? 'Saved token is not shown' : 'Optional magic-number testing'} /></label>
      {twilioAccount.secretConfigured.TestAuthToken && <label className="checkbox-row"><input type="checkbox" checked={Boolean(clearTwilioSecrets.TestAuthToken)} onChange={(event) => setClearTwilioSecrets({ ...clearTwilioSecrets, TestAuthToken: event.target.checked })} />Clear test auth token</label>}
      <label className="checkbox-row"><input type="checkbox" checked={twilioAccount.enabled} onChange={(event) => setTwilioAccount({ ...twilioAccount, enabled: event.target.checked })} />Enable this account</label>
      <label className="checkbox-row"><input type="checkbox" checked={twilioAccount.isDefault} onChange={(event) => setTwilioAccount({ ...twilioAccount, isDefault: event.target.checked })} />Use as default SMS provider account</label>
      <div className="actions"><button type="button" className="secondary" onClick={saveTwilioAccount} disabled={busy || !twilioAccount.name.trim()}>{busy ? 'Saving…' : 'Save Twilio Account'}</button>
        {twilioAccount.id && <button type="button" className="secondary" onClick={checkTwilio} disabled={busy}>Check Connection</button>}</div>
    </>}
    <h5>Textbelt provider account</h5>
    <p className="profile-editor-help">Textbelt supports administrator-requested test texts. Automatic alerts currently require Twilio callbacks for opt-out handling and delivery tracking.</p>
    <label>Textbelt account
      <select value={textbeltAccount?.id || ''} onChange={(event) => {
        setTextbeltApiKey('')
        setClearTextbeltApiKey(false)
        const account = providerAccounts.find((item) => item.id === event.target.value && item.provider === 'Textbelt')
        setTextbeltAccount(account ? fromTextbeltAccount(account) : null)
      }}>
        <option value="">Select account to edit…</option>
        {providerAccounts.filter((account) => account.provider === 'Textbelt').map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? ' (default)' : ''}{account.enabled ? '' : ' (disabled)'}</option>)}
      </select>
    </label>
    <div className="actions"><button type="button" className="secondary" onClick={() => { setTextbeltApiKey(''); setClearTextbeltApiKey(false); setTextbeltAccount({ id: null, revision: null, name: '', enabled: true, isDefault: false, secretConfigured: false }) }} disabled={busy}>New Textbelt Account</button></div>
    {textbeltAccount && <>
      <label>Account name<input value={textbeltAccount.name} onChange={(event) => setTextbeltAccount({ ...textbeltAccount, name: event.target.value })} /></label>
      <label>API key {textbeltAccount.secretConfigured ? '(configured; enter to replace)' : ''}<input type="password" autoComplete="new-password" value={textbeltApiKey} onChange={(event) => setTextbeltApiKey(event.target.value)} placeholder={textbeltAccount.secretConfigured ? 'Saved key is not shown' : 'Enter Textbelt API key'} /></label>
      {textbeltAccount.secretConfigured && <label className="checkbox-row"><input type="checkbox" checked={clearTextbeltApiKey} onChange={(event) => setClearTextbeltApiKey(event.target.checked)} />Clear saved API key</label>}
      <label className="checkbox-row"><input type="checkbox" checked={textbeltAccount.enabled} onChange={(event) => setTextbeltAccount({ ...textbeltAccount, enabled: event.target.checked })} />Enable this account</label>
      <label className="checkbox-row"><input type="checkbox" checked={textbeltAccount.isDefault} onChange={(event) => setTextbeltAccount({ ...textbeltAccount, isDefault: event.target.checked })} />Use as default SMS provider account</label>
      <div className="actions"><button type="button" className="secondary" onClick={saveTextbeltAccount} disabled={busy || !textbeltAccount.name.trim()}>{busy ? 'Saving…' : 'Save Textbelt Account'}</button></div>
    </>}
    <h5>Texting service by vehicle</h5>
    <p className="profile-editor-help">Choose a Twilio account override for automatic alerts, or use the installation default. Automatic alerts currently require Twilio for STOP/START handling and delivery tracking; Textbelt is available for administrator-requested test texts.</p>
    {vehicles.map((vehicle) => <label key={vehicle.id}>{vehicle.displayName || vehicle.name || vehicle.id}
      <select value={vehicleSmsAccounts[vehicle.id] || ''} disabled={busy} onChange={(event) => saveVehicleSmsAccount(vehicle.id, event.target.value)}>
        <option value="">Use installation default</option>
        {providerAccounts.filter((account) => account.provider === 'Twilio').map((account) => <option key={account.id} value={account.id}>{account.name}{account.enabled ? '' : ' (disabled)'}</option>)}
      </select>
    </label>)}
    <p className="profile-editor-help">Send one administrator-requested test text to a recipient who has agreed to receive it.</p>
    {status && <p className="profile-editor-help">
      Provider: {status.provider} ({status.configurationSource || 'environment'}) — {status.ready ? 'configured' : 'needs settings'} · installation limit {status.dailyLimit} accepted test text{status.dailyLimit === 1 ? '' : 's'} per day
      {status.missingSettings?.length > 0 ? ` (missing ${status.missingSettings.join(', ')})` : ''}
    </p>}
    {status && <p className="profile-editor-help">
      Automatic alerts: {status.automaticAlertsReady ? 'ready' : 'not configured'}
      {status.automaticAlertsMissingSettings?.length > 0 ? ` (missing ${status.automaticAlertsMissingSettings.join(', ')})` : ''}
    </p>}
    <label>Recipient phone number
      <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15551234567" />
    </label>
    <label className="checkbox-row">
      <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
      I confirm this recipient agreed to receive this test text.
    </label>
    <div className="actions"><button type="button" className="secondary" disabled={!status?.ready || !consent || !phone.trim() || busy} onClick={send}>Send Test Text</button></div>
    {message && <div className="profile-editor-status">{message}</div>}
  </div>
}

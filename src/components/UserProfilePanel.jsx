import { useEffect, useMemo, useState } from 'react'
import { fetchUserProfile, saveUserProfile } from '../lib/vehicleAppApi'

function AccessSource({ direct, groups = [], administrator = false }) {
  if (administrator) return <small className="user-profile-access-source">Administrator access</small>
  const sources = [
    ...(direct ? ['Direct access'] : []),
    ...groups.map((group) => `Group: ${group}`),
  ]
  return <small className="user-profile-access-source">{sources.join(' · ') || 'Access assigned by your administrator'}</small>
}

function AccessSection({ title, entries, emptyText, renderEntry }) {
  return (
    <section className="user-profile-access-section">
      <h3>{title} <span>{entries.length}</span></h3>
      {entries.length === 0
        ? <p className="user-profile-empty">{emptyText}</p>
        : <ul>{entries.map(renderEntry)}</ul>}
    </section>
  )
}

export default function UserProfilePanel({ baseUrl, devices = [], onClose }) {
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetchUserProfile(baseUrl)
      .then((result) => {
        if (!active) return
        setProfile(result)
        setForm({ firstName: result.firstName || '', lastName: result.lastName || '', email: result.email || '' })
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Could not load your profile.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [baseUrl])

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const deviceNames = useMemo(() => new Map(devices.map((device) => [String(device.id), device.name || device.uniqueId || `Device ${device.id}`])), [devices])
  const isAdministrator = profile?.role?.toLowerCase() === 'admin'
  const deviceAccess = isAdministrator
    ? devices.filter((device) => device.id !== undefined && device.id !== null).map((device) => ({ deviceId: device.id, direct: false, groups: [] }))
    : profile?.devices || []

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await saveUserProfile(baseUrl, form)
      const updated = await fetchUserProfile(baseUrl)
      setProfile(updated)
      setForm({ firstName: updated.firstName || '', lastName: updated.lastName || '', email: updated.email || '' })
      setMessage('Your profile was saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (field) => (event) => {
    setError('')
    setMessage('')
    setForm((current) => ({ ...current, [field]: event.target.value }))
  }

  return (
    <div className="user-profile-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="user-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="user-profile-title">
        <header className="user-profile-header">
          <div>
            <h2 id="user-profile-title">Your profile</h2>
            <p>Manage your contact details and review your current access.</p>
          </div>
          <button type="button" className="secondary user-profile-close" onClick={onClose} aria-label="Close profile">×</button>
        </header>

        {loading && <p className="user-profile-notice" role="status">Loading profile…</p>}
        {error && <p className="user-profile-notice error" role="alert">{error}</p>}

        {profile && <>
          <div className="user-profile-account-summary">
            <div><span>Username</span><strong>{profile.username}</strong></div>
            <div><span>Role</span><strong>{profile.role || 'User'}</strong></div>
            <div><span>Account</span><strong>{profile.active ? 'Active' : 'Inactive'}</strong></div>
            <div><span>New device access</span><strong>{profile.autoAccessNewDevices ? 'Automatic' : 'Assigned by administrator'}</strong></div>
          </div>

          <form className="user-profile-form" onSubmit={save}>
            <h3>Contact details</h3>
            <label>First name<input value={form.firstName} onChange={updateField('firstName')} maxLength={100} autoComplete="given-name" disabled={loading || saving} /></label>
            <label>Last name<input value={form.lastName} onChange={updateField('lastName')} maxLength={100} autoComplete="family-name" disabled={loading || saving} /></label>
            <label className="user-profile-email-field">Email address<input type="email" value={form.email} onChange={updateField('email')} maxLength={320} autoComplete="email" disabled={loading || saving} /></label>
            <p className="user-profile-form-hint">Email alert delivery addresses are managed separately in Settings.</p>
            <div className="user-profile-form-footer">
              <span role="status">{message}</span>
              <button type="submit" disabled={loading || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>

          <div className="user-profile-access-grid">
            <AccessSection title="Groups" entries={profile.groups || []} emptyText="You are not a member of any groups." renderEntry={(group) => (
              <li key={group.id}>
                <strong>{group.name}</strong>
                <small>{group.autoAccessNewDevices ? 'Includes automatic access to new devices' : 'Access assigned by group administrator'}</small>
              </li>
            )} />
            <AccessSection title="Vehicles" entries={profile.vehicles || []} emptyText="No vehicles are assigned to your account or groups." renderEntry={(vehicle) => (
              <li key={vehicle.id}>
                <strong>{vehicle.displayName}</strong>
                <AccessSource direct={vehicle.direct} groups={vehicle.groups} administrator={isAdministrator} />
                {!vehicle.active && <small className="user-profile-inactive">Inactive vehicle</small>}
              </li>
            )} />
            <AccessSection title="Devices" entries={deviceAccess} emptyText="No devices are assigned to your account or groups." renderEntry={(device) => (
              <li key={device.deviceId}>
                <strong>{deviceNames.get(String(device.deviceId)) || `Device ${device.deviceId}`}</strong>
                <AccessSource direct={device.direct} groups={device.groups} administrator={isAdministrator} />
              </li>
            )} />
          </div>
          <p className="user-profile-access-note">Access assignments are managed by your administrator. Contact them if something is missing.</p>
        </>}
      </section>
    </div>
  )
}

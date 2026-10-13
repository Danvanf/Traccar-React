import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SPEED_BANDS } from '../lib/speedBands'
import { DEFAULT_MAP_POPUP_FIELDS, DEFAULT_STATUS_CARD_FIELDS, STATUS_CARD_FIELDS, normalizeStatusCardFields } from '../lib/statusCardFields'
import { fetchVehicleEmailSender, fetchVehicleSpeedBands, saveVehicleEmailSender, saveVehicleSpeedBands as persistVehicleSpeedBands } from '../lib/vehicleAppApi'
import AdminAccessPanel from './AdminAccessPanel'
import EmailAlertsSettings from './EmailAlertsSettings'
import SmsTestSettings from './SmsTestSettings'
import SmsAlertsSettings from './SmsAlertsSettings'
import { getMappingPropertyDifferences, getProfileMappingDifferences } from '../lib/profileImport'
import { addSettingsFieldTips } from '../lib/settingsFieldTips'

function formatProfileDifferenceValue(value) {
  if (value === undefined) return '—'
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function BundlePidCheckbox({ checked, indeterminate, onChange, label }) {
  const inputRef = useRef(null)
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])
  return <input ref={inputRef} className="profile-bundle-diff-select" type="checkbox" aria-label={label} aria-checked={indeterminate ? 'mixed' : checked} checked={checked} onChange={onChange} />
}

function SettingsModal({
  isPickingLocation,
  startLocationPicker,
  settings,
  updateSetting,
  closeModal,
  refreshDevices,
  profileOptions,
  bundledProfileOptions = [],
  onDiscoverBundledProfiles,
  updateCurrentProfileFromBundle,
  createProfileFromBundle,
  selectedProfileId,
  setSelectedProfileId,
  profileName,
  setProfileName,
  profileAttributesJson,
  setProfileAttributesJson,
  profileEditorStatus,
  profileStorageNotice,
  profileStorageCanSave = true,
  profileSyncStatus,
  onOpenProfileMappingEditor,
  saveProfileEdits,
  createProfileFromEditor,
  deleteSelectedProfile,
  bindingDevices,
  bindingVehicles,
  vehicleEditId,
  selectVehicleForEdit,
  vehicleName,
  setVehicleName,
  vehicleVin,
  setVehicleVin,
  vehicleYear,
  setVehicleYear,
  vehicleMake,
  setVehicleMake,
  vehicleModel,
  setVehicleModel,
  vehicleNotes,
  setVehicleNotes,
  vehicleProfileId,
  setVehicleProfileId,
  vehicleDeviceId,
  setVehicleDeviceId,
  vehicleEffectiveFrom,
  setVehicleEffectiveFrom,
  vehicleEditorStatus,
  saveVehicle,
  statusCardFieldsByVehicle,
  onPreviewStatusCardFields,
  mapPopupFieldsByVehicle,
  onPreviewMapPopupFields,
  saveStatusCardFields,
  filterBindingsToSelectedDevice,
  setFilterBindingsToSelectedDevice,
  bindingDeviceId,
  setBindingDeviceId,
  bindingVehicleId,
  setBindingVehicleId,
  bindingEffectiveFrom,
  setBindingEffectiveFrom,
  bindingStatus,
  activeBindings,
  isBindingBusy,
  refreshBindings,
  saveBinding,
  deleteBindingById,
  saveBindingAndRetryImport,
  showRetryAction,
  importRecovery,
  clearImportRecovery,
  enrichmentStatus,
  namedPlaces,
  placeVehicleId,
  placeEditId,
  beginEditNamedPlace,
  cancelEditNamedPlace,
  setPlaceVehicleId,
  placeName,
  setPlaceName,
  placeLatitude,
  setPlaceLatitude,
  placeLongitude,
  setPlaceLongitude,
  placeRadiusYards,
  setPlaceRadiusYards,
  placeType,
  setPlaceType,
  placeTrackName,
  setPlaceTrackName,
  placeNotes,
  setPlaceNotes,
  saveNamedPlace,
  deleteNamedPlaceById,
  tripTags,
  tagVehicleId,
  setTagVehicleId,
  tagName,
  setTagName,
  tagColor,
  setTagColor,
  saveTripTag,
  deleteTripTagById,
  bouncieClientId,
  setBouncieClientId,
  bouncieClientSecret,
  setBouncieClientSecret,
  bouncieRedirectUri,
  setBouncieRedirectUri,
  bouncieAuthorizationUrl,
  bouncieImportFrom,
  setBouncieImportFrom,
  bouncieImportThrough,
  setBouncieImportThrough,
  bouncieStatus,
  bouncieCoverage,
  bouncieBusy,
  connectBouncie,
  startBouncieImport,
  cancelBouncieImport,
  continueBouncieImport,
  forgetBouncieCredentials,
  restoreBouncieConnection,
  vehicleApiBaseUrl,
  vehicleAuth,
}) {
  const modalRef = useRef(null)
  const [speedBandVehicleId, setSpeedBandVehicleId] = useState(vehicleEditId || bindingVehicles[0]?.id || '')
  const [speedBands, setSpeedBands] = useState(DEFAULT_SPEED_BANDS)
  const [speedBandCopySourceId, setSpeedBandCopySourceId] = useState('')
  const [speedBandStatus, setSpeedBandStatus] = useState('')
  const [cardFields, setCardFields] = useState(DEFAULT_STATUS_CARD_FIELDS)
  const [mapPopupFields, setMapPopupFields] = useState(DEFAULT_MAP_POPUP_FIELDS)
  const [cardFieldsStatus, setCardFieldsStatus] = useState('')
  const [vehicleEmailSender, setVehicleEmailSender] = useState('')
  const [vehicleEmailSenderStatus, setVehicleEmailSenderStatus] = useState('')
  const [bundledProfileDialogOpen, setBundledProfileDialogOpen] = useState(false)
  const [bundledProfilesFound, setBundledProfilesFound] = useState([])
  const [bundledProfileStep, setBundledProfileStep] = useState('list')
  const [selectedBundledProfile, setSelectedBundledProfile] = useState(null)
  const [bundledProfileDiffs, setBundledProfileDiffs] = useState([])
  const [selectedBundledProperties, setSelectedBundledProperties] = useState({})
  const selectedStatusProfile = profileOptions.find((profile) => profile.id === vehicleProfileId)
  const statusCardFieldOptions = STATUS_CARD_FIELDS.map((field) => {
    const mapping = Object.entries(selectedStatusProfile?.attributeMap || {}).find(([, info]) => info?.statusCardField === field)
    return mapping ? [field, mapping[1].label || field] : null
  }).filter(Boolean)
  const trackNameSuggestions = [...new Map((namedPlaces || [])
    .map((place) => String(place.trackName || '').trim())
    .filter(Boolean)
    .map((name) => [name.toLocaleLowerCase(), name])).values()]
    .sort((a, b) => a.localeCompare(b))
  useEffect(() => {
    const root = modalRef.current
    if (!root) return undefined
    addSettingsFieldTips(root)
    const observer = new MutationObserver(() => addSettingsFieldTips(root))
    observer.observe(root, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  const openBundledProfileSearch = () => {
    const found = (onDiscoverBundledProfiles?.() || bundledProfileOptions)
      .filter((profile) => profile && typeof profile.id === 'string' && profile.attributeMap && typeof profile.attributeMap === 'object')
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
    setBundledProfilesFound(found)
    setSelectedBundledProfile(null)
    setBundledProfileStep('list')
    setBundledProfileDialogOpen(true)
  }
  const showBundledProfileActions = (profile) => {
    setSelectedBundledProfile(profile)
    setBundledProfileStep('actions')
  }
  const compareBundledProfileWithCurrent = () => {
    if (!selectedBundledProfile) return
    const current = profileOptions.find((profile) => profile.id === selectedProfileId)
    const differences = getProfileMappingDifferences(current?.attributeMap || {}, selectedBundledProfile.attributeMap || {})
    setBundledProfileDiffs(differences)
    setSelectedBundledProperties(Object.fromEntries(differences.map((item) => [
      item.key,
      getMappingPropertyDifferences(item.current, item.source).map((property) => property.property),
    ])))
    setBundledProfileStep('diff')
  }
  const applyBundledProfileChanges = () => {
    if (!selectedBundledProfile || !selectedPropertyChangeCount) return
    updateCurrentProfileFromBundle?.(selectedBundledProfile, selectedBundledProperties)
    setBundledProfileDialogOpen(false)
  }
  const makeBundledProfileCopy = () => {
    if (!selectedBundledProfile) return
    createProfileFromBundle?.(selectedBundledProfile)
    setBundledProfileDialogOpen(false)
  }
  const totalPropertyChangeCount = bundledProfileDiffs.reduce((total, difference) => total + getMappingPropertyDifferences(difference.current, difference.source).length, 0)
  const selectedPropertyChangeCount = Object.values(selectedBundledProperties).reduce((total, properties) => total + properties.length, 0)
  const selectAllBundledProperties = (select) => setSelectedBundledProperties(Object.fromEntries(bundledProfileDiffs.map((difference) => [
    difference.key,
    select ? getMappingPropertyDifferences(difference.current, difference.source).map((item) => item.property) : [],
  ])))
  useEffect(() => {
    const panels = Array.from(document.querySelectorAll('.settings-modal .profile-editor'))
    panels.forEach((panel) => {
      const heading = panel.querySelector('h4')
      if (!heading || panel.dataset.collapsibleReady) return
      panel.dataset.collapsibleReady = 'true'
      panel.classList.add('settings-panel-collapsed')
      heading.setAttribute('role', 'button')
      heading.setAttribute('tabindex', '0')
      const toggle = () => panel.classList.toggle('settings-panel-collapsed')
      heading.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle() } })
    })
    if (localStorage.getItem('openSpeedBandsPanel') === 'true') {
      const speedPanel = panels.find((panel) => panel.querySelector('h4')?.textContent.trim() === 'Speed Bands')
      speedPanel?.classList.remove('settings-panel-collapsed')
      localStorage.removeItem('openSpeedBandsPanel')
    }
    if (localStorage.getItem('openVehicleCatalogPanel') === 'true') {
      const vehiclePanel = panels.find((panel) => panel.querySelector('h4')?.textContent.trim() === 'Vehicle Catalog')
      vehiclePanel?.classList.remove('settings-panel-collapsed')
      localStorage.removeItem('openVehicleCatalogPanel')
    }
    if (localStorage.getItem('openDeviceProtocolProfilePanel') === 'true') {
      const profilePanel = panels.find((panel) => panel.querySelector('h4')?.textContent.trim() === 'Device Protocol Profile Editor')
      profilePanel?.classList.remove('settings-panel-collapsed')
      profilePanel?.scrollIntoView({ block: 'center' })
      localStorage.removeItem('openDeviceProtocolProfilePanel')
    }
    return () => panels.forEach((panel) => { panel.dataset.collapsibleReady = '' })
  }, [])
  useEffect(() => {
    if (!importRecovery && !showRetryAction) return
    const panels = Array.from(document.querySelectorAll('.settings-modal .profile-editor'))
    const vehiclePanel = panels.find((panel) => panel.querySelector('h4')?.textContent.trim() === 'Vehicle Catalog')
    vehiclePanel?.classList.remove('settings-panel-collapsed')
    vehiclePanel?.scrollIntoView({ block: 'nearest' })
  }, [importRecovery, showRetryAction])
  useEffect(() => {
    setSpeedBandVehicleId(vehicleEditId || bindingVehicles[0]?.id || '')
    setSpeedBandCopySourceId('')
    try {
      const saved = JSON.parse(localStorage.getItem('traccarVehicleSpeedBands') || '{}')
      setSpeedBands(saved[vehicleEditId] || DEFAULT_SPEED_BANDS)
    } catch { setSpeedBands(DEFAULT_SPEED_BANDS) }
  }, [bindingVehicles, vehicleEditId])
  useEffect(() => {
    if (!speedBandVehicleId) return undefined
    let active = true
    try {
      const saved = JSON.parse(localStorage.getItem('traccarVehicleSpeedBands') || '{}')
      setSpeedBands(saved[speedBandVehicleId] || DEFAULT_SPEED_BANDS)
    } catch { setSpeedBands(DEFAULT_SPEED_BANDS) }
    if (vehicleApiBaseUrl) fetchVehicleSpeedBands(vehicleApiBaseUrl, speedBandVehicleId).then((payload) => {
      if (active && payload?.bands) setSpeedBands(payload.bands)
    }).catch(() => {})
    return () => { active = false }
  }, [speedBandVehicleId, vehicleApiBaseUrl])
  useEffect(() => {
      setCardFields(normalizeStatusCardFields(statusCardFieldsByVehicle?.[vehicleEditId] || DEFAULT_STATUS_CARD_FIELDS))
    setCardFieldsStatus('')
  }, [statusCardFieldsByVehicle, vehicleEditId])
  useEffect(() => {
    setMapPopupFields(normalizeStatusCardFields(mapPopupFieldsByVehicle?.[vehicleEditId] || DEFAULT_MAP_POPUP_FIELDS))
  }, [mapPopupFieldsByVehicle, vehicleEditId])
  useEffect(() => {
    setVehicleEmailSender('')
    setVehicleEmailSenderStatus('')
    if (vehicleAuth?.role !== 'admin' || !vehicleEditId || !vehicleApiBaseUrl) return undefined
    let active = true
    fetchVehicleEmailSender(vehicleApiBaseUrl, vehicleEditId)
      .then((value) => { if (active) setVehicleEmailSender(value.senderUserId || '') })
      .catch((error) => { if (active) setVehicleEmailSenderStatus(error.message) })
    return () => { active = false }
  }, [vehicleAuth?.role, vehicleApiBaseUrl, vehicleEditId])
  const saveSpeedBands = async () => {
    if (!speedBandVehicleId) return
    try {
      const saved = JSON.parse(localStorage.getItem('traccarVehicleSpeedBands') || '{}')
      localStorage.setItem('traccarVehicleSpeedBands', JSON.stringify({ ...saved, [speedBandVehicleId]: speedBands }))
      if (vehicleApiBaseUrl) await persistVehicleSpeedBands(vehicleApiBaseUrl, speedBandVehicleId, speedBands)
      window.dispatchEvent(new CustomEvent('vehicle-speed-bands-updated', { detail: { vehicleId: speedBandVehicleId, bands: speedBands } }))
      setSpeedBandStatus('Speed bands saved for this vehicle.')
    } catch (error) {
      setSpeedBandStatus(error instanceof Error ? error.message : 'Unable to save speed bands.')
    }
  }
  const copySpeedBands = async () => {
    if (!speedBandVehicleId || !speedBandCopySourceId || speedBandCopySourceId === speedBandVehicleId) return
    const source = bindingVehicles.find((vehicle) => vehicle.id === speedBandCopySourceId)
    if (!source || !window.confirm(`Copy speed bands from ${source.displayName}? The current editor values will be replaced; save to keep the copy.`)) return
    try {
      let copied = null
      if (vehicleApiBaseUrl) {
        const payload = await fetchVehicleSpeedBands(vehicleApiBaseUrl, speedBandCopySourceId)
        copied = payload?.bands || null
      }
      if (!copied) {
        const saved = JSON.parse(localStorage.getItem('traccarVehicleSpeedBands') || '{}')
        copied = saved[speedBandCopySourceId] || null
      }
      if (!Array.isArray(copied) || copied.length === 0) throw new Error('The source vehicle has no saved speed bands.')
      setSpeedBands(copied.map((band) => ({ ...band })))
      setSpeedBandStatus(`Copied speed bands from ${source.displayName}. Save to apply them to ${bindingVehicles.find((vehicle) => vehicle.id === speedBandVehicleId)?.displayName || 'this vehicle'}.`)
    } catch (error) {
      setSpeedBandStatus(error.message || 'Unable to copy speed bands.')
    }
  }
  const toggleCardField = (field) => {
    const nextFields = cardFields.includes(field)
      ? cardFields.filter((item) => item !== field)
      : [...cardFields, field]
    setCardFields(nextFields)
    if (vehicleEditId) onPreviewStatusCardFields?.(vehicleEditId, nextFields)
  }
  const toggleMapPopupField = (field) => {
    const nextFields = mapPopupFields.includes(field)
      ? mapPopupFields.filter((item) => item !== field)
      : [...mapPopupFields, field]
    setMapPopupFields(nextFields)
    if (vehicleEditId) onPreviewMapPopupFields?.(vehicleEditId, nextFields)
  }
  const saveCardFields = async () => {
    if (!vehicleEditId) return
    try {
      await saveStatusCardFields(vehicleEditId, cardFields, mapPopupFields)
      setCardFieldsStatus('Status card and map popup fields saved for this vehicle.')
    } catch (error) {
      setCardFieldsStatus(error instanceof Error ? error.message : 'Unable to save status card fields.')
    }
  }
  const saveVehicleEmailSenderSetting = async () => {
    if (!vehicleEditId || !vehicleApiBaseUrl) return
    try {
      const result = await saveVehicleEmailSender(vehicleApiBaseUrl, vehicleEditId, vehicleEmailSender.trim())
      setVehicleEmailSender(result.senderUserId || '')
      setVehicleEmailSenderStatus(result.senderUserId ? 'Vehicle sender mailbox saved.' : 'Vehicle override cleared; the default sender will be used.')
    } catch (error) {
      setVehicleEmailSenderStatus(error.message || 'Unable to save vehicle sender mailbox.')
    }
  }
  const updateSpeedBand = (index, changes) => setSpeedBands((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item))
  const sortSpeedBands = (bands) => [...bands].sort((a, b) => (a.upperMph == null ? Infinity : a.upperMph) - (b.upperMph == null ? Infinity : b.upperMph))
  const addSpeedBand = () => setSpeedBands((current) => {
    if (current.length >= 10) return current
    const finite = current.filter((band) => band.upperMph != null)
    const previous = finite.at(-1)?.upperMph || 20
    const next = Math.max(previous + 1, previous + Math.ceil((160 - previous) / 2))
    const colors = ['#2a9d8f', '#78c346', '#7c3aed', '#f4a261', '#000000']
    return sortSpeedBands([...current.filter((band) => band.upperMph != null), { upperMph: next, color: colors[current.length % colors.length] }, { ...current.at(-1), upperMph: null }])
  })
  const deleteSpeedBand = (index) => {
    if (speedBands.length <= 1 || !window.confirm('Delete this speed band?')) return
    setSpeedBands((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      if (index === current.length - 1) next[next.length - 1] = { ...next[next.length - 1], upperMph: null }
      return sortSpeedBands(next)
    })
  }
  const renderSpeedBand = (band, index) => {
    const start = index === 0 ? 0 : speedBands[index - 1].upperMph
    return <div className="speed-band-editor-grid" key={index}>
      <span className="speed-band-start">{start ?? 0}</span>
      <span className="settings-field-tip-host" data-field-tip={`Upper speed limit in mph for this color band. The final band has no upper limit.`}>
        <input className="speed-band-limit" aria-label={`Upper speed limit for band starting at ${start ?? 0} mph`} aria-description="Upper speed limit in mph for this color band. The final band has no upper limit." type="number" min={start + 1} value={band.upperMph ?? ''} disabled={index === speedBands.length - 1} onChange={(event) => updateSpeedBand(index, { upperMph: Number(event.target.value) || null })} />
      </span>
      <span className="settings-field-tip-host" data-field-tip="Color used for speeds in this band on the map and reports.">
        <input className="speed-band-color" aria-label={`Color for speed band starting at ${start ?? 0} mph`} aria-description="Color used for speeds in this band on the map and reports." type="color" value={band.color} onChange={(event) => updateSpeedBand(index, { color: event.target.value })} />
      </span>
      <button type="button" className="small danger" onClick={() => deleteSpeedBand(index)} disabled={speedBands.length <= 1}>Delete</button>
    </div>
  }
  const toVehicleLabel = (vehicle) => {
    if (!vehicle) {
      return 'Unknown vehicle'
    }

    const shortId = String(vehicle.id || '').slice(0, 8)
    return shortId ? `${vehicle.displayName} (${shortId})` : vehicle.displayName
  }

  return (
    <div className="settings-backdrop" style={isPickingLocation ? { display: 'none' } : undefined} onClick={closeModal}>
      <section ref={modalRef} className="settings-modal" onClick={(event) => {
        event.stopPropagation()
        const heading = event.target.closest('.profile-editor > h4')
        if (heading) heading.parentElement.classList.toggle('settings-panel-collapsed')
      }}>
        <h3>Settings</h3>
        <AdminAccessPanel baseUrl={vehicleApiBaseUrl} isAdmin={vehicleAuth?.role === 'admin'} vehicles={bindingVehicles} devices={bindingDevices} />
        {importRecovery && (
          <div className="settings-conflict-banner" role="status" aria-live="polite">
            <div className="settings-conflict-banner-header">
              <strong>{importRecovery.title || 'Trip import conflict'}</strong>
              <span>HTTP 409</span>
            </div>
            <div>{importRecovery.detail || 'The server blocked this import to preserve existing trip history.'}</div>
            <div className="settings-conflict-banner-facts">
              {importRecovery.code && <span>Cause: {importRecovery.code}</span>}
              {importRecovery.traccarDeviceId && <span>Device ID: {importRecovery.traccarDeviceId}</span>}
              {(importRecovery.startedAtLabel || importRecovery.endedAtLabel) && (
                <span>Incoming Window: {importRecovery.startedAtLabel || '?'} to {importRecovery.endedAtLabel || '?'}</span>
              )}
              {importRecovery.incomingSourceIdsLabel && (
                <span>Incoming Source IDs: {importRecovery.incomingSourceIdsLabel}</span>
              )}
              {(importRecovery.firstConflictingTrip?.startedAtLabel || importRecovery.firstConflictingTrip?.endedAtLabel) && (
                <span>
                  Saved Window ({importRecovery.firstConflictingTrip?.idShort || 'trip'}): {importRecovery.firstConflictingTrip?.startedAtLabel || '?'} to {importRecovery.firstConflictingTrip?.endedAtLabel || '?'}
                </span>
              )}
              {importRecovery.firstConflictingTrip?.sourceIdsLabel && (
                <span>Saved Source IDs: {importRecovery.firstConflictingTrip.sourceIdsLabel}</span>
              )}
              {Array.isArray(importRecovery.conflictingTripIdsShort) && importRecovery.conflictingTripIdsShort.length > 0 && (
                <span>
                  Conflicting Trip IDs: {importRecovery.conflictingTripIdsShort.slice(0, 3).join(', ')}
                  {importRecovery.conflictingTripIdsShort.length > 3 ? ` (+${importRecovery.conflictingTripIdsShort.length - 3} more)` : ''}
                </span>
              )}
            </div>
            {Array.isArray(importRecovery.steps) && importRecovery.steps.length > 0 && (
              <ol>
                {importRecovery.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
              </ol>
            )}
            <div className="actions two-up">
              <button type="button" className="secondary" onClick={clearImportRecovery}>Dismiss Import Guidance</button>
            </div>
          </div>
        )}
        <div className="profile-editor">
        <h4>General</h4>
        <label>
          API Base URL
          <input
            type="text"
            value={settings.apiBaseUrl}
            onChange={(event) => updateSetting('apiBaseUrl', event.target.value)}
            placeholder="/api or http://host:8082/api"
          />
        </label>
        <label>
          Vehicle API Base URL
          <input
            type="text"
            value={settings.vehicleApiBaseUrl || '/vehicle-api'}
            onChange={(event) => updateSetting('vehicleApiBaseUrl', event.target.value)}
            placeholder="/vehicle-api or http://localhost:5124"
          />
        </label>
        <label>
          Username (email)
          <input
            type="text"
            name="traccar-api-username"
            autoComplete="off"
            value={settings.username}
            onChange={(event) => updateSetting('username', event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="traccar-api-password"
            autoComplete="off"
            value={settings.password}
            onChange={(event) => updateSetting('password', event.target.value)}
          />
        </label>
        <div className="settings-grid">
          <label>
            Poll Interval (ms)
            <input
              type="number"
              min="1000"
              step="1000"
              value={settings.pollIntervalMs}
              onChange={(event) => updateSetting('pollIntervalMs', Number(event.target.value) || 5000)}
            />
          </label>
          <label>
            Realtime Hours
            <input
              type="number"
              min="1"
              max="24"
              value={settings.realtimeHours}
              onChange={(event) => updateSetting('realtimeHours', Number(event.target.value) || 3)}
            />
          </label>
          <label>
            Movement Threshold (m)
            <input
              type="number"
              min="1"
              value={settings.movementThresholdM}
              onChange={(event) => updateSetting('movementThresholdM', Number(event.target.value) || 20)}
            />
          </label>
          <label>
            Display Units
            <select value={settings.displayUnits || 'imperial'} onChange={(event) => updateSetting('displayUnits', event.target.value)}>
              <option value="imperial">Imperial</option>
              <option value="metric">Metric</option>
            </select>
          </label>
          <label>
            Theme
            <select value={settings.theme} onChange={(event) => updateSetting('theme', event.target.value)}>
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Device Source
            <select
              value={settings.useBackendVehicleCatalog ? 'backend' : 'traccar'}
              onChange={(event) => updateSetting('useBackendVehicleCatalog', event.target.value === 'backend')}
            >
              <option value="traccar">Traccar /devices (default)</option>
              <option value="backend">Vehicle API /api/vehicles</option>
            </select>
          </label>
        </div>

        </div>
        <hr className="settings-divider" />

        <EmailAlertsSettings baseUrl={vehicleApiBaseUrl} vehicleAuth={vehicleAuth} vehicles={bindingVehicles} />
        <SmsAlertsSettings baseUrl={vehicleApiBaseUrl} vehicleAuth={vehicleAuth} vehicles={bindingVehicles} />
        {vehicleAuth?.role === 'admin' && <SmsTestSettings baseUrl={vehicleApiBaseUrl} vehicles={bindingVehicles} />}
        <hr className="settings-divider" />

        <div className="profile-editor">
          <h4>Vehicle Catalog</h4>
          <p className="profile-editor-help">Define the app-owned vehicle here. Traccar device names and historical device bindings are managed separately.</p>
          <label>
            Edit vehicle
            <select value={vehicleEditId || ''} onChange={(event) => selectVehicleForEdit(event.target.value)}>
              <option value="">New vehicle</option>
              {bindingVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{toVehicleLabel(vehicle)}</option>)}
            </select>
          </label>
          <div className="settings-grid">
            <label>Name<input value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} /></label>
            <label>VIN<input value={vehicleVin} onChange={(event) => setVehicleVin(event.target.value)} /></label>
            <label>Year<input type="number" value={vehicleYear} onChange={(event) => setVehicleYear(event.target.value)} /></label>
            <label>Make<input value={vehicleMake} onChange={(event) => setVehicleMake(event.target.value)} /></label>
            <label>Model<input value={vehicleModel} onChange={(event) => setVehicleModel(event.target.value)} /></label>
            <label>Device Protocol Profile
              <select value={vehicleProfileId} onChange={(event) => setVehicleProfileId(event.target.value)}>
                <option value="">None (no translation)</option>
                {profileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>
            <label>Traccar Device
              <select value={vehicleDeviceId} onChange={(event) => setVehicleDeviceId(event.target.value)}>
                <option value="">None (unassigned)</option>
                {bindingDevices.map((device) => <option key={device.id} value={device.id}>{device.name} (id {device.id})</option>)}
              </select>
            </label>
            <label>Effective From
              <input type="datetime-local" value={vehicleEffectiveFrom} onChange={(event) => setVehicleEffectiveFrom(event.target.value)} />
            </label>
          </div>
          <label>Notes<textarea rows={3} value={vehicleNotes} onChange={(event) => setVehicleNotes(event.target.value)} /></label>
          {vehicleEditId && vehicleAuth?.role === 'admin' && <div className="profile-editor-subsection">
            <h5>Email sender for this vehicle</h5>
            <p className="profile-editor-help">Leave blank to use the default mailbox in Email Alerts settings. The Graph app must be permitted to send from this mailbox.</p>
            <label>Sender mailbox<input type="email" autoComplete="off" value={vehicleEmailSender} onChange={(event) => setVehicleEmailSender(event.target.value)} placeholder="Use default sender" /></label>
            {vehicleEmailSenderStatus && <div className="profile-editor-status">{vehicleEmailSenderStatus}</div>}
            <div className="actions"><button type="button" className="secondary" onClick={saveVehicleEmailSenderSetting}>Save Vehicle Sender</button></div>
          </div>}
          {vehicleEditorStatus && <div className="profile-editor-status">{vehicleEditorStatus}</div>}
          <div className="actions"><button type="button" onClick={saveVehicle}>Save Vehicle</button></div>
          {vehicleEditId && <>
            <p className="profile-editor-help">The checkbox controls the Vehicle Status card. The switch controls map point popups; enabling it will show the corresponding field in the map point popups.</p>
            <div className="status-card-field-grid" data-vehicle-id={vehicleEditId}>
               {statusCardFieldOptions.map(([field, label]) => <div key={field} className="status-card-field-option">
                 <label className="checkbox-row"><input type="checkbox" aria-checked={cardFields.includes(field)} checked={cardFields.includes(field)} onChange={() => toggleCardField(field)} />{label}</label>
                 <label className="status-card-popup-switch" title={`Show ${label} on map point popups`}>
                   <input type="checkbox" role="switch" aria-label={`Show ${label} on map point popups`} aria-checked={mapPopupFields.includes(field)} checked={mapPopupFields.includes(field)} onChange={() => toggleMapPopupField(field)} />
                   <span className="status-card-popup-switch-track" aria-hidden="true" />
                 </label>
               </div>)}
               {statusCardFieldOptions.length === 0 && <span className="profile-editor-help">Choose a device profile with status fields to configure this card.</span>}
            </div>
            {cardFieldsStatus && <div className="profile-editor-status">{cardFieldsStatus}</div>}
            <div className="actions"><button type="button" className="secondary" onClick={saveCardFields}>Save Status Card Fields</button></div>
          </>}
          <h5>Current Device Assignments</h5>
          <p className="profile-editor-help">These are the current Traccar hardware assignments used to associate trips with Vehicle Catalog records.</p>
          {bindingStatus && <div className="profile-editor-status">{bindingStatus}</div>}
          <div className="actions"><button type="button" className="secondary" onClick={refreshBindings} disabled={isBindingBusy}>Refresh Assignments</button></div>
          <div className="binding-list">
            {bindingDevices.length === 0 && <div className="trip-empty">No Traccar devices found.</div>}
            {bindingDevices.length > 0 && <ul>{bindingDevices.map((device) => {
              const deviceBindings = activeBindings.filter((binding) => Number(binding.traccarDeviceId) === Number(device.id))
              if (deviceBindings.length === 0) return <li key={`unassigned-${device.id}`}><strong>{device.name}</strong><span>Traccar ID: {device.id}</span><span>is unassigned (no vehicle binding)</span></li>
              return deviceBindings.map((binding) => <li key={binding.id}>
                <strong>{device.name}</strong>
                <span>Traccar ID: {device.id}</span>
                <span>maps to {binding.vehicleDisplayName} (binding {String(binding.id).slice(0, 8)})</span>
                <button type="button" className="small danger" onClick={() => deleteBindingById(binding.id)} disabled={isBindingBusy}>Delete</button>
              </li>)
            })}</ul>}
          </div>
        </div>

        <div className="profile-editor">
          <h4>Speed Bands</h4>
          <p className="profile-editor-help">Configure independent Imperial speed colors for this vehicle. Bands are limited to ten.</p>
          <label>Vehicle
            <select value={speedBandVehicleId} onChange={(event) => { setSpeedBandVehicleId(event.target.value); setSpeedBandCopySourceId(''); setSpeedBandStatus('') }}>
              <option value="">Select vehicle</option>
              {bindingVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.displayName}</option>)}
            </select>
          </label>
          {speedBandVehicleId && <>
            <div className="speed-band-copy-row">
              <label>Copy from vehicle
                <select value={speedBandCopySourceId} onChange={(event) => setSpeedBandCopySourceId(event.target.value)}>
                  <option value="">Select source</option>
                  {bindingVehicles.filter((vehicle) => vehicle.id !== speedBandVehicleId).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.displayName}</option>)}
                </select>
              </label>
              <button type="button" className="secondary" onClick={copySpeedBands} disabled={!speedBandCopySourceId}>Copy Bands</button>
            </div>
            {speedBandStatus && <div className="profile-editor-status">{speedBandStatus}</div>}
            <div className="speed-band-columns">{[speedBands.slice(0, Math.ceil(speedBands.length / 2)), speedBands.slice(Math.ceil(speedBands.length / 2))].map((column, columnIndex) => <div className="speed-band-column" key={columnIndex}>
              <div className="speed-band-editor-grid speed-band-editor-heading"><span>Start mph</span><span>Through</span><span className="speed-band-color-heading">Color</span><span /></div>
              {column.map((band) => renderSpeedBand(band, speedBands.indexOf(band)))}
            </div>)}</div>
            <div className="actions"><button type="button" className="secondary" onClick={addSpeedBand} disabled={speedBands.length >= 10}>Add Speed Band</button><button type="button" onClick={saveSpeedBands}>Save Speed Bands</button></div>
          </>}
        </div>

        <hr className="settings-divider" />

        <div className="profile-editor">
          <h4>Named Places ({namedPlaces.length})</h4>
          <p className="profile-editor-help">
            Save reusable map locations per vehicle for enrichment and later trip classification workflows.
          </p>

          <div className="settings-grid">
            <label>
              Vehicle
              <select
                value={placeVehicleId || ''}
                onChange={(event) => setPlaceVehicleId(event.target.value || null)}
              >
                <option value="">(optional) All vehicles</option>
                {bindingVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{toVehicleLabel(vehicle)}</option>
                ))}
              </select>
            </label>

            <label>
              Name
              <input type="text" value={placeName} onChange={(event) => setPlaceName(event.target.value)} placeholder="Home" />
            </label>

            <div className="place-coordinates">
              <label>
                Latitude
                <input type="number" min="-90" max="90" step="0.000001" value={placeLatitude} onChange={(event) => setPlaceLatitude(event.target.value)} />
              </label>
              <button
                type="button"
                className="secondary location-picker-button"
                title="Select position on map"
                aria-label="Select position on map"
                onClick={startLocationPicker}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="7" />
                  <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                </svg>
                <span>Pick on Map</span>
              </button>
              <label>
                Longitude
                <input type="number" min="-180" max="180" step="0.000001" value={placeLongitude} onChange={(event) => setPlaceLongitude(event.target.value)} />
              </label>
            </div>

            <label>
              Radius (yards)
              <input type="number" min="1" step="1" value={placeRadiusYards} onChange={(event) => setPlaceRadiusYards(event.target.value)} />
            </label>

            <label>
              Track role
              <select value={placeType} onChange={(event) => setPlaceType(event.target.value)}>
                <option value="general">General place</option>
                <option value="track_start">Track start</option>
                <option value="track_finish">Track finish</option>
                <option value="track_start_finish">Track start / finish</option>
                <option value="track_split">Track split / timing point</option>
                <option value="drag_start">Drag start</option>
                <option value="drag_finish">Drag finish</option>
                <option value="track_other">Other track location</option>
              </select>
            </label>

            <label>
              Track or course name
              <input
                type="text"
                list="named-place-track-name-options"
                name="track-course-name"
                autoComplete="off"
                value={placeTrackName}
                onChange={(event) => setPlaceTrackName(event.target.value)}
                placeholder="Optional venue or circuit"
                aria-describedby="named-place-track-name-help"
              />
              <datalist id="named-place-track-name-options">
                {trackNameSuggestions.map((name) => <option key={name} value={name} />)}
              </datalist>
            </label>
          </div>

          <p id="named-place-track-name-help" className="profile-editor-help">
            Multiple named places are supported. Radius is entered in yards and converted to meters for map use. Track names suggest existing saved tracks, and new names are allowed.
          </p>

          {placeEditId && (
            <div className="profile-editor-status">Edit mode is active for selected named place.</div>
          )}

          <label>
            Notes
            <input type="text" value={placeNotes} onChange={(event) => setPlaceNotes(event.target.value)} placeholder="Optional notes" />
          </label>

          <div className="actions two-up">
            <button type="button" onClick={saveNamedPlace}>Save Named Place</button>
            {placeEditId
              ? <button type="button" className="secondary" onClick={cancelEditNamedPlace}>Cancel Edit</button>
              : <button type="button" className="secondary" onClick={refreshBindings}>Refresh Lists</button>}
          </div>

          <div className="binding-list">
            {namedPlaces.length === 0 && <div className="trip-empty">No named places yet.</div>}
            {namedPlaces.length > 0 && (
              <table className="binding-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Scope</th>
                    <th>Location</th>
                    <th>Radius</th>
                    <th>Role</th>
                    <th>Track</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {namedPlaces.map((place) => {
                    const scopedVehicle = place.vehicleId
                      ? bindingVehicles.find((vehicle) => vehicle.id === place.vehicleId)
                      : null
                    const scopeLabel = scopedVehicle ? toVehicleLabel(scopedVehicle) : (place.vehicleId ? 'Vehicle' : 'All')

                    return (
                      <tr key={place.id}>
                        <td><strong>{place.name}</strong></td>
                        <td>{scopeLabel}</td>
                        <td>{place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}</td>
                        <td>{Math.round((Number(place.radiusMeters) || 0) * 1.093613)} yd</td>
                        <td>{String(place.placeType || 'general').replaceAll('_', ' ')}</td>
                        <td>{place.trackName || '—'}</td>
                        <td>
                          <button type="button" className="small secondary" onClick={() => beginEditNamedPlace(place)}>
                            Edit
                          </button>
                          <button type="button" className="small danger" onClick={() => deleteNamedPlaceById(place.id)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <hr className="settings-divider" />

        <div className="profile-editor">
          <h4>Trip Tags</h4>
          <p className="profile-editor-help">
            Create reusable tags for trips. Tag assignment UI will use these labels in follow-on steps.
          </p>

          <div className="settings-grid">
            <label>
              Vehicle
              <select
                value={tagVehicleId || ''}
                onChange={(event) => setTagVehicleId(event.target.value || null)}
              >
                <option value="">(optional) Global</option>
                {bindingVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{toVehicleLabel(vehicle)}</option>
                ))}
              </select>
            </label>

            <label>
              Tag Name
              <input type="text" value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="Commute" />
            </label>

            <label>
              Color
              <input type="color" value={tagColor || '#2563eb'} onChange={(event) => setTagColor(event.target.value)} />
            </label>
          </div>

          <div className="actions two-up">
            <button type="button" onClick={saveTripTag}>Save Trip Tag</button>
            <button type="button" className="secondary" onClick={refreshBindings}>Refresh Lists</button>
          </div>

          {tripTags.length > 0 && (
            <div className="binding-list">
              <ul>
                {tripTags.map((tag) => (
                  <li key={tag.id}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="color-dot" style={{ background: tag.color || '#777' }} /><strong>{tag.name}</strong>{tag.color ? ` (${tag.color})` : ''}</span>
                    <button type="button" className="small danger" onClick={() => deleteTripTagById(tag.id)}>Delete</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {enrichmentStatus && <div className="profile-editor-status">{enrichmentStatus}</div>}

        <hr className="settings-divider" />

        <div className="profile-editor">
          <h4>Device Protocol Profile Editor</h4>
          <p className="profile-editor-help">
            Profiles describe how a device protocol exposes telemetry. The vehicle selects which profile it uses, while the mappings and unit conversions remain device/protocol-specific. Choose “None (no profile)” for devices without a supported protocol profile.
          </p>

          <label>
            Selected Profile
            <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} disabled={!profileStorageCanSave}>
              {profileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>

          <div className="profile-bundle-row">
            <button type="button" className="secondary" onClick={openBundledProfileSearch} disabled={!profileStorageCanSave}>Find Available Device Profiles</button>
            <span className="profile-editor-help">Checks the JSON definitions shipped in <code>device-profiles</code>.</span>
          </div>

          <label>
            Profile Name
            <input type="text" value={profileName} onChange={(event) => setProfileName(event.target.value)} disabled={!profileStorageCanSave} />
          </label>

          <label>
            Field Mappings and Conversions JSON
            <textarea
              value={profileAttributesJson}
              onChange={(event) => setProfileAttributesJson(event.target.value)}
              rows={10}
              disabled={!profileStorageCanSave}
            />
          </label>
          <div className="profile-mapping-open-row">
            <button id="open-device-protocol-profile-editor" type="button" className="secondary" onClick={onOpenProfileMappingEditor}>Open Visual Field Mapping Editor</button>
          </div>
          <p className="profile-editor-help">Each field may define its label and display units, source/canonical units, <code>canonicalScale</code> and optional <code>canonicalOffset</code> (raw × scale + offset), AVL ID, semantic <code>quantity</code>, optional <code>statusCardField</code>, sentinels, precision, and a legacy conversion. Canonical mappings convert to the user's Imperial or Metric preference. Reports and the status card use the assigned profile's labels and units. AVL 12/13 remain raw until their meaning is confirmed. Only set source/canonical units when confirmed against Traccar data.</p>

          {profileStorageNotice && <div className="profile-editor-status" role="status">{profileStorageNotice}</div>}
          {profileSyncStatus && <div className="profile-editor-status" role="status">{profileSyncStatus}</div>}
          {profileEditorStatus && <div className="profile-editor-status">{profileEditorStatus}</div>}

          <div className="actions three-up">
            <button type="button" onClick={saveProfileEdits} disabled={!profileStorageCanSave}>Save Profile</button>
            <button type="button" className="secondary" onClick={createProfileFromEditor} disabled={!profileStorageCanSave}>Create New Profile</button>
            <button type="button" className="danger" onClick={deleteSelectedProfile} disabled={!profileStorageCanSave}>Delete Profile</button>
          </div>

          {bundledProfileDialogOpen && (
            <div className="profile-bundle-backdrop">
              <section className="profile-bundle-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-bundle-title">
                <header className="profile-bundle-header">
                  <div>
                    <p className="profile-editor-help">Packaged device definitions</p>
                    <h3 id="profile-bundle-title">{bundledProfileStep === 'list' ? 'Available Device Profiles' : bundledProfileStep === 'actions' ? 'Use Device Profile' : 'Review Profile Differences'}</h3>
                  </div>
                  <button type="button" className="secondary" onClick={() => setBundledProfileDialogOpen(false)}>Close</button>
                </header>

                {bundledProfileStep === 'list' && (
                  <>
                    <p className="profile-editor-help">Choose a definition included with the app. The current profile will only change after you review and apply selected fields.</p>
                    {bundledProfilesFound.length ? (
                      <ul className="profile-bundle-list">
                        {bundledProfilesFound.map((profile) => (
                          <li key={profile.id}>
                            <div><strong>{profile.name || profile.id}</strong><code>{profile.id}</code><span>{Object.keys(profile.attributeMap || {}).length} mapped fields</span></div>
                            <button type="button" onClick={() => showBundledProfileActions(profile)}>Choose</button>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="profile-editor-status">No packaged device profiles were found in <code>device-profiles</code>.</p>}
                  </>
                )}

                {bundledProfileStep === 'actions' && selectedBundledProfile && (
                  <>
                    <p className="profile-editor-help">Definition: <strong>{selectedBundledProfile.name || selectedBundledProfile.id}</strong> ({selectedBundledProfile.id})</p>
                    <p className="profile-editor-help">Current profile: <strong>{profileOptions.find((profile) => profile.id === selectedProfileId)?.name || 'None selected'}</strong></p>
                    <div className="profile-bundle-actions">
                      <button type="button" onClick={compareBundledProfileWithCurrent} disabled={!profileStorageCanSave || !selectedProfileId}>Update Current Profile</button>
                      <button type="button" className="secondary" onClick={makeBundledProfileCopy} disabled={!profileStorageCanSave}>Create New Profile</button>
                      <button type="button" className="secondary" onClick={() => setBundledProfileStep('list')}>Back to Profiles</button>
                    </div>
                    <p className="profile-editor-help">Updating compares each field independently. You choose which additions, changes, and removals to apply.</p>
                  </>
                )}

                {bundledProfileStep === 'diff' && selectedBundledProfile && (
                  <>
                    <p className="profile-editor-help">Select properties within each PID. A checked property copies or removes only that property; unchecked properties are preserved.</p>
                    <div className="profile-bundle-selection-tools">
                      <span>{selectedPropertyChangeCount} of {totalPropertyChangeCount} mapping changes selected</span>
                      <div>
                        <button type="button" className="small secondary" onClick={() => selectAllBundledProperties(true)}>Select All</button>
                        <button type="button" className="small secondary" onClick={() => selectAllBundledProperties(false)}>Select None</button>
                      </div>
                    </div>
                    {bundledProfileDiffs.length ? (
                      <div className="profile-bundle-diffs">
                        {bundledProfileDiffs.map((difference) => {
                          const propertyDiffs = getMappingPropertyDifferences(difference.current, difference.source)
                          const selectedProperties = selectedBundledProperties[difference.key] || []
                          const selectedCount = propertyDiffs.filter((item) => selectedProperties.includes(item.property)).length
                          const allSelected = propertyDiffs.length > 0 && selectedCount === propertyDiffs.length
                          const partlySelected = selectedCount > 0 && !allSelected
                          return (
                            <article key={difference.key} className="profile-bundle-diff">
                              <div className="profile-bundle-diff-identity">
                                <label className="profile-bundle-diff-identity-line">
                                  <BundlePidCheckbox
                                    label={`Select all changed properties for ${difference.key}`}
                                    checked={allSelected}
                                    indeterminate={partlySelected}
                                    onChange={(event) => setSelectedBundledProperties((current) => ({
                                      ...current,
                                      [difference.key]: event.target.checked ? propertyDiffs.map((item) => item.property) : [],
                                    }))}
                                  />
                                  <strong className="profile-bundle-diff-key">{difference.key}</strong>
                                  <span className="profile-bundle-diff-label">{difference.source?.label || difference.current?.label || 'Unlabeled field'}</span>
                                </label>
                                <span className={`profile-bundle-diff-kind ${difference.change}`}>{difference.change}</span>
                              </div>
                              <div className="profile-bundle-diff-properties">
                                {propertyDiffs.map((item) => {
                                  const before = formatProfileDifferenceValue(item.current)
                                  const after = formatProfileDifferenceValue(item.source)
                                  return (
                                    <label className="profile-bundle-diff-property" key={item.property} title={`${item.property}: ${before} → ${after}`}>
                                      <strong className="profile-bundle-diff-property-name">{item.property}</strong>
                                      <code>{before}</code>
                                      <span aria-hidden="true">→</span>
                                      <input
                                        type="checkbox"
                                        aria-label={`Apply ${item.property} change for ${difference.key}`}
                                        checked={selectedProperties.includes(item.property)}
                                        onChange={(event) => setSelectedBundledProperties((current) => {
                                          const properties = current[difference.key] || []
                                          return {
                                            ...current,
                                            [difference.key]: event.target.checked
                                              ? [...properties, item.property]
                                              : properties.filter((property) => property !== item.property),
                                          }
                                        })}
                                      />
                                      <code>{after}</code>
                                    </label>
                                  )
                                })}
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    ) : <p className="profile-editor-status">The selected profile already matches this packaged definition.</p>}
                    <div className="profile-bundle-actions">
                      <button type="button" onClick={applyBundledProfileChanges} disabled={!profileStorageCanSave || !selectedPropertyChangeCount}>Apply Selected Changes</button>
                      <button type="button" className="secondary" onClick={() => setBundledProfileStep('actions')}>Back</button>
                      <button type="button" className="secondary" onClick={() => setBundledProfileDialogOpen(false)}>Cancel</button>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </div>

        <div className="profile-editor">
          <h4>Bouncie REST Import</h4>
          <p className="profile-editor-help">
            Connect a Bouncie account to backfill its trip history. Connect opens Bouncie's normal sign-in and consent window, then the registered callback completes the exchange automatically. Imports run sequentially in small windows to avoid stressing Bouncie.
          </p>
          <div className="settings-grid">
            <label>OAuth Client ID<input type="text" value={bouncieClientId} onChange={(event) => setBouncieClientId(event.target.value)} autoComplete="off" /></label>
            <label>Client Secret<input type="password" value={bouncieClientSecret} onChange={(event) => setBouncieClientSecret(event.target.value)} autoComplete="new-password" placeholder={!bouncieStatus?.connected && bouncieStatus?.storedCredentials ? 'Only enter if changed in Bouncie' : undefined} /></label>
            <label>Redirect URL<input type="url" value={bouncieRedirectUri} onChange={(event) => setBouncieRedirectUri(event.target.value)} /></label>
          </div>
          <div className="actions two-up">
            <button type="button" onClick={connectBouncie} disabled={bouncieBusy || (!bouncieStatus?.storedCredentials && (!bouncieClientId || !bouncieClientSecret || !bouncieRedirectUri))}>{bouncieStatus?.storedCredentials && !bouncieStatus?.connected ? 'Reconnect with Bouncie' : 'Connect with Bouncie'}</button>
            <span className="profile-editor-status">{bouncieStatus?.connected ? `Connected${bouncieStatus.userLabel ? ` as ${bouncieStatus.userLabel}` : ''}` : 'Not connected'}</span>
          </div>
          {bouncieAuthorizationUrl && !bouncieStatus?.connected && <p className="profile-editor-help">If the popup was blocked, <a href={bouncieAuthorizationUrl} target="_blank" rel="noreferrer">open the Bouncie authorization window</a>.</p>}
          {bouncieStatus?.connected && <p className="profile-editor-help">The client secret is intentionally blank after a successful exchange. It is stored only by the API in encrypted form. To replace the connection, use “Forget Stored Bouncie Connection” and connect again.</p>}
          {!bouncieStatus?.connected && bouncieStatus?.storedCredentials && <p className="profile-editor-help">Bouncie rejected the stored refresh token. Reconnect opens a fresh consent exchange using the encrypted client secret already stored by the API. Enter a secret here only after changing it in Bouncie’s developer portal.</p>}
          {!bouncieStatus?.connected && !bouncieStatus?.storedCredentials && <p className="profile-editor-help">No encrypted Bouncie connection is stored yet. Enter the real client secret and connect; the authorization code is handled by the callback window.</p>}
          {Array.isArray(bouncieStatus?.vehicles) && bouncieStatus.vehicles.length > 0 && (
            <div className="profile-editor-help">
              <div>Found {bouncieStatus.vehicles.length} Bouncie vehicle(s). Only vehicles matched to the existing Vehicle Catalog will be imported.</div>
              <ul>
                {bouncieStatus.vehicles.map((vehicle) => <li key={vehicle.imei}>{vehicle.displayName || 'Unnamed vehicle'}{vehicle.vin ? ` — VIN ${vehicle.vin}` : ''}{vehicle.imei ? ` — IMEI ${vehicle.imei}` : ''}</li>)}
              </ul>
            </div>
          )}
          <div className="settings-grid">
            <label>Import From<input type="date" value={bouncieImportFrom} onChange={(event) => setBouncieImportFrom(event.target.value)} /></label>
            <label>Import Through<input type="date" value={bouncieImportThrough} onChange={(event) => setBouncieImportThrough(event.target.value)} /></label>
          </div>
          <div className="actions two-up">
            <button type="button" onClick={startBouncieImport} disabled={bouncieBusy || !bouncieStatus?.connected || ['running', 'awaiting_confirmation'].includes(bouncieStatus?.import?.state)}>Import Bouncie Data</button>
            <button type="button" className="secondary" onClick={cancelBouncieImport} disabled={bouncieBusy || bouncieStatus?.import?.state !== 'running'}>Cancel Import</button>
          </div>
          {bouncieStatus?.import?.state === 'awaiting_confirmation' && (
            <div className="profile-editor-status" role="alert">
              <strong>Continue this import?</strong> {bouncieStatus.import.message}
              <div className="actions two-up">
                <button type="button" onClick={continueBouncieImport} disabled={bouncieBusy}>Continue requested range</button>
                <button type="button" className="secondary" onClick={cancelBouncieImport} disabled={bouncieBusy}>Stop and retry empty dates later</button>
              </div>
            </div>
          )}
          <button type="button" className="small danger" onClick={forgetBouncieCredentials} disabled={bouncieBusy || !bouncieStatus?.connected}>Forget Stored Bouncie Connection</button>
          {bouncieStatus?.import && (
            <div className="profile-editor-status">
              <strong>{bouncieStatus.import.state === 'running' ? 'Import in progress' : bouncieStatus.import.state === 'awaiting_confirmation' ? 'Import paused' : bouncieStatus.import.state}</strong>{bouncieStatus.import.state !== 'awaiting_confirmation' && `: ${bouncieStatus.import.message}`}
              {bouncieStatus.import.totalWindows > 0 && <span> ({bouncieStatus.import.completedWindows}/{bouncieStatus.import.totalWindows} windows checked, {bouncieStatus.import.imported || 0} trips imported, {bouncieStatus.import.skipped || 0} already present{bouncieStatus.import.failedWindows ? `, ${bouncieStatus.import.failedWindows} failed` : ''})</span>}
            </div>
          )}
          {Array.isArray(bouncieCoverage) && bouncieCoverage.length > 0 && (
            <div className="profile-editor-status">
              <strong>Backfill coverage</strong>
              <ul>
                {bouncieCoverage.map((coverage) => (
                  <li key={coverage.vehicleImei}>{coverage.vehicleImei}: {coverage.completedWindows} completed windows, {new Date(coverage.firstWindowFrom).toLocaleDateString()} through {new Date(coverage.lastWindowThrough).toLocaleDateString()}</li>
                ))}
              </ul>
            </div>
          )}
          {(bouncieStatus?.import?.unmatchedVehicleDetails || []).length > 0 && (
            <div className="profile-editor-status">
              <strong>Unmatched Bouncie vehicles</strong>
              <ul>
                {bouncieStatus.import.unmatchedVehicleDetails.map((vehicle) => (
                  <li key={vehicle.imei}>{vehicle.displayName || 'Unnamed vehicle'} — VIN {vehicle.vin || 'none'} — IMEI {vehicle.imei}; catalog comparison: {vehicle.make || '?'} {vehicle.model || '?'} {vehicle.year || '?'}. {vehicle.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="actions two-up">
          <button type="button" onClick={closeModal}>Close</button>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await refreshDevices()
              closeModal()
            }}
          >
            Refresh Devices
          </button>
        </div>
      </section>
    </div>
  )
}

export default SettingsModal

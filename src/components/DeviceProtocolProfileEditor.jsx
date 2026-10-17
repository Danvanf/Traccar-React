import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createCarProfile, getAttributeMapValidationIssues, translateAttribute, updateProfileAttributeMapping } from '../lib/carProfiles'
import { getProfileFieldGroups } from '../lib/profileFieldGroups'
import { compatibleTelemetryUnits, getTelemetryUnit, getTelemetryUnitGroups, TELEMETRY_QUANTITY_OPTIONS } from '../lib/telemetryUnits'
import { restoreProfileField } from '../lib/profileHistory'
import TelemetryProfileSubmissionDialog from './TelemetryProfileSubmissionDialog'
import { fetchTelemetryFieldInventory, retryTelemetryFieldInventoryScan } from '../lib/traccarReactApi'
import { mergeTelemetryFieldInventory } from '../lib/telemetryFieldInventory'

const EMPTY_ATTRIBUTE_MAP = Object.freeze({})

function parseMappingJson(value) {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { value: null, error: 'Field mappings must be a JSON object.' }
    const issues = getAttributeMapValidationIssues(parsed)
    return { value: parsed, error: issues[0]?.message || '', issues }
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : 'Field mapping JSON is invalid.' }
  }
}

function describeConversion(mapping, displayUnit) {
  if (typeof mapping.canonicalScale === 'number' && mapping.canonicalUnit) {
    return `Received values are converted and shown as ${displayUnit || mapping.canonicalUnit}.`
  }
  if (mapping.conversion) return `An existing conversion rule is used${displayUnit ? `; values display as ${displayUnit}` : ''}.`
  return mapping.units ? `Values are shown without a conversion, as ${mapping.units}.` : 'Values are shown as received; unit unknown.'
}

function preview(profile, key, value) {
  if (value.trim() === '') return 'Enter a raw sample value.'
  const result = translateAttribute(profile, key, value)
  if (result.status === 'sentinel') return 'Marked as a sentinel / unavailable value.'
  if (result.status === 'invalid') return 'Invalid for the selected mapping.'
  if (result.value === null || result.value === undefined) return 'No value.'
  return `${result.value}${result.unit ? ` ${result.unit}` : ''}`
}

function mappingForSourceUnit(mapping, value) {
  if (value === '__unknown') {
    const next = { ...mapping, sourceUnitStatus: 'unknown' }
    delete next.sourceUnit
    delete next.canonicalUnit
    delete next.canonicalScale
    delete next.canonicalOffset
    delete next.displayUnit
    delete next.units
    return next
  }
  if (value === '__none') {
    const next = { ...mapping, sourceUnitStatus: 'none' }
    delete next.sourceUnit
    delete next.canonicalUnit
    delete next.canonicalScale
    delete next.canonicalOffset
    delete next.displayUnit
    delete next.units
    return next
  }
  const unit = getTelemetryUnit(value)
  if (!unit) return mapping
  return {
    ...mapping,
    sourceUnitStatus: 'known',
    sourceUnit: unit.symbol,
    quantity: unit.quantity,
    canonicalUnit: unit.canonicalUnit,
    canonicalScale: unit.scale,
    canonicalOffset: unit.offset,
    units: unit.symbol,
  }
}

export default function DeviceProtocolProfileEditor({
  profileId,
  profileName,
  profileAttributesJson,
  setProfileAttributesJson,
  displayUnits = 'imperial',
  canSave = true,
  serverSyncEnabled = false,
  storageNotice = '',
  syncStatus = '',
  editorStatus = '',
  submissionDevices = [],
  submissionDefaultDeviceId,
  submissionApiBaseUrl,
  fetchSubmissionPositions,
  profileSchemaVersion = 1,
  saveProfile,
  loadRevisions,
  onBackToSettings,
  onSaveAndClose,
}) {
  const [activeGroup, setActiveGroup] = useState('all')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedKey, setSelectedKey] = useState(null)
  const [showJson, setShowJson] = useState(false)
  const [backPrompt, setBackPrompt] = useState(false)
  const [sampleValue, setSampleValue] = useState('')
  const [sentinelDraft, setSentinelDraft] = useState('')
  const [fieldKeyDraft, setFieldKeyDraft] = useState('')
  const [localStatus, setLocalStatus] = useState('')
  const [closeAfterSync, setCloseAfterSync] = useState(false)
  const [revisionHistory, setRevisionHistory] = useState([])
  const [inventoryDeviceId, setInventoryDeviceId] = useState(() => String(submissionDefaultDeviceId ?? ''))
  const [fieldInventory, setFieldInventory] = useState(null)
  const [inventoryError, setInventoryError] = useState('')
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [submissionOpen, setSubmissionOpen] = useState(false)
  const [savedJson, setSavedJson] = useState(profileAttributesJson)
  const syncStartedRef = useRef(false)
  const screenRef = useRef(null)
  const backTriggerRef = useRef(null)
  const titleRef = useRef(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  useEffect(() => {
    if (backPrompt) {
      const frame = window.requestAnimationFrame(() => screenRef.current?.querySelector('.profile-mapping-confirm button:not(:disabled)')?.focus())
      return () => window.cancelAnimationFrame(frame)
    }
    if (backTriggerRef.current) {
      const frame = window.requestAnimationFrame(() => {
        backTriggerRef.current?.focus()
        backTriggerRef.current = null
      })
      return () => window.cancelAnimationFrame(frame)
    }
    return undefined
  }, [backPrompt])

  useEffect(() => {
    if (!closeAfterSync) return
    if (syncStatus.startsWith('Synchronizing')) {
      syncStartedRef.current = true
      return
    }
    if (syncStartedRef.current) {
      setCloseAfterSync(false)
      onSaveAndClose()
    }
  }, [closeAfterSync, onSaveAndClose, syncStatus])

  useEffect(() => {
    if (!inventoryDeviceId && submissionDefaultDeviceId != null) setInventoryDeviceId(String(submissionDefaultDeviceId))
  }, [inventoryDeviceId, submissionDefaultDeviceId])

  useEffect(() => {
    if (!inventoryDeviceId || !submissionApiBaseUrl) { setFieldInventory(null); return undefined }
    let active = true
    setInventoryLoading(true)
    setInventoryError('')
    setFieldInventory(null)
    fetchTelemetryFieldInventory(submissionApiBaseUrl, inventoryDeviceId).then((inventory) => {
      if (active) setFieldInventory(inventory)
    }).catch((error) => {
      if (active) setInventoryError(error instanceof Error ? error.message : 'Could not load the vehicle field inventory.')
    }).finally(() => { if (active) setInventoryLoading(false) })
    return () => { active = false }
  }, [inventoryDeviceId, submissionApiBaseUrl])

  useEffect(() => {
    if (!inventoryDeviceId || !submissionApiBaseUrl || !['queued', 'scanning'].includes(fieldInventory?.status)) return undefined
    let active = true
    let timer = null
    const poll = async () => {
      try {
        const nextInventory = await fetchTelemetryFieldInventory(submissionApiBaseUrl, inventoryDeviceId)
        if (!active) return
        setFieldInventory(nextInventory)
        if (['queued', 'scanning'].includes(nextInventory.status)) timer = window.setTimeout(poll, 3000)
      } catch (error) {
        if (active) {
          setInventoryError(error instanceof Error ? error.message : 'Could not refresh the vehicle field inventory.')
          timer = window.setTimeout(poll, 5000)
        }
      }
    }
    timer = window.setTimeout(poll, 3000)
    return () => { active = false; if (timer) window.clearTimeout(timer) }
  }, [fieldInventory?.status, inventoryDeviceId, submissionApiBaseUrl])

  async function updateVehicleInventory() {
    if (!inventoryDeviceId || !submissionApiBaseUrl) return
    setInventoryLoading(true)
    setInventoryError('')
    try { setFieldInventory(await retryTelemetryFieldInventoryScan(submissionApiBaseUrl, inventoryDeviceId)) }
    catch (error) { setInventoryError(error instanceof Error ? error.message : 'Could not update the vehicle field inventory.') }
    finally { setInventoryLoading(false) }
  }

  const parsed = useMemo(() => parseMappingJson(profileAttributesJson), [profileAttributesJson])
  const attributeMap = parsed.value || EMPTY_ATTRIBUTE_MAP
  const inventoryRows = useMemo(() => mergeTelemetryFieldInventory(attributeMap, fieldInventory?.fields || []), [attributeMap, fieldInventory?.fields])
  const inventoryAttributeMap = useMemo(() => Object.fromEntries(inventoryRows.map(({ key, mapping }) => [key, mapping])), [inventoryRows])
  const { groups, fields: groupedFields } = useMemo(() => getProfileFieldGroups(inventoryAttributeMap), [inventoryAttributeMap])
  const fields = useMemo(() => {
    const inventoryByKey = new Map(inventoryRows.map((entry) => [entry.key, entry]))
    return groupedFields.map((field) => ({ ...field, ...inventoryByKey.get(field.key) }))
  }, [groupedFields, inventoryRows])
  const dirty = profileAttributesJson !== savedJson
  const selectedField = fields.find((field) => field.key === selectedKey) || null
  const selectedMapping = selectedField?.mapping || null
  const selectedSourceUnit = getTelemetryUnit(selectedMapping?.sourceUnit)
  const sourceUnitChoice = selectedSourceUnit?.symbol || (selectedMapping?.sourceUnitStatus === 'none' ? '__none' : '__unknown')
  const customSourceUnit = selectedMapping?.sourceUnit && !selectedSourceUnit ? selectedMapping.sourceUnit : null
  const displayChoices = compatibleTelemetryUnits(selectedSourceUnit?.quantity || selectedMapping?.quantity)
  const unitProfile = useMemo(() => createCarProfile({ id: profileId, name: profileName, attributeMap }, displayUnits), [attributeMap, displayUnits, profileId, profileName])
  const imperialProfile = useMemo(() => createCarProfile({ id: profileId, name: profileName, attributeMap }, 'imperial'), [attributeMap, profileId, profileName])
  const metricProfile = useMemo(() => createCarProfile({ id: profileId, name: profileName, attributeMap }, 'metric'), [attributeMap, profileId, profileName])

  const visibleFields = fields.filter(({ key, mapping, group }) => {
    if (activeGroup !== 'all' && group.id !== activeGroup) return false
    if (filter === 'unmapped' && String(mapping.label || '').trim()) return false
    if (filter === 'conversion' && !mapping.conversion && typeof mapping.canonicalScale !== 'number') return false
    if (filter === 'status' && !mapping.statusCardField) return false
    const query = search.trim().toLocaleLowerCase()
    if (!query) return true
    const haystack = [key, mapping.label, mapping.avlId, mapping.quantity, mapping.units, mapping.sourceUnit, mapping.canonicalUnit, mapping.sourceGroup, group.label].join(' ').toLocaleLowerCase()
    return haystack.includes(query)
  })

  function writeMap(next) {
    setProfileAttributesJson(JSON.stringify(next, null, 2))
    setLocalStatus('')
  }

  function updateField(key, property, value) {
    if (!parsed.value) return
    const editableMap = Object.hasOwn(parsed.value, key) ? parsed.value : { ...parsed.value, [key]: {} }
    writeMap(updateProfileAttributeMapping(editableMap, key, property, value))
  }

  function updateMapping(key, mapping) {
    if (!parsed.value) return
    writeMap({ ...parsed.value, [key]: mapping })
  }

  function addField() {
    const key = fieldKeyDraft.trim()
    if (!key) { setLocalStatus('Enter the Traccar attribute key first.'); return }
    if (Object.hasOwn(attributeMap, key)) { setLocalStatus(`The profile already contains ${key}.`); return }
    writeMap({ ...attributeMap, [key]: { label: '' } })
    setSelectedKey(key)
    setActiveGroup('all')
    setFieldKeyDraft('')
    setLocalStatus(`Added ${key}. Add its label and mapping details before saving.`)
  }

  function removeField(key) {
    if (!window.confirm(`Remove the ${key} mapping from this profile? Existing Traccar records will keep their raw values.`)) return
    const next = { ...attributeMap }
    delete next[key]
    writeMap(next)
    setSelectedKey(null)
    setLocalStatus(`Removed ${key} from the profile draft.`)
  }

  async function showRevisionHistory() {
    setHistoryOpen((value) => !value)
    if (revisionHistory.length || !loadRevisions) return
    setHistoryLoading(true)
    try {
      setRevisionHistory(await loadRevisions(profileId))
    } catch (error) {
      setLocalStatus(error instanceof Error ? error.message : 'Could not load profile history.')
    } finally {
      setHistoryLoading(false)
    }
  }

  function restoreFieldFromRevision(revision) {
    if (!selectedKey || !canSave || dirty) return
    const priorMap = revision.attributeMap || revision.AttributeMap || {}
    const nextMap = restoreProfileField(attributeMap, priorMap, selectedKey)
    const nextJson = JSON.stringify(nextMap, null, 2)
    setProfileAttributesJson(nextJson)
    const result = saveProfile({ attributesJson: nextJson, changeKind: 'undo' })
    if (!result?.ok) {
      setLocalStatus(result?.message || 'Could not restore this field.')
      return
    }
    setSavedJson(nextJson)
    setLocalStatus(`${selectedKey} restored from revision ${revision.revision}.`)
  }

  function save(closeAfter = false) {
    const result = saveProfile({ attributesJson: profileAttributesJson })
    if (!result?.ok) {
      setLocalStatus(result?.message || 'Correct the profile errors before saving.')
      return false
    }
    setSavedJson(profileAttributesJson)
    setLocalStatus('Profile saved. Server synchronization status is shown below.')
    if (closeAfter) {
      if (serverSyncEnabled) {
        syncStartedRef.current = syncStatus.startsWith('Synchronizing')
        setCloseAfterSync(true)
      } else onSaveAndClose()
    }
    return true
  }

  const backToSettings = useCallback((event) => {
    if (dirty) {
      backTriggerRef.current = event?.currentTarget || document.activeElement
      setBackPrompt(true)
    }
    else onBackToSettings()
  }, [dirty, onBackToSettings])

  useEffect(() => {
    function handleEditorKeys(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (backPrompt) setBackPrompt(false)
        else backToSettings()
        return
      }
      if (event.key !== 'Tab') return

      const scope = backPrompt
        ? screenRef.current?.querySelector('.profile-mapping-confirm')
        : screenRef.current
      const focusable = scope?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleEditorKeys)
    return () => document.removeEventListener('keydown', handleEditorKeys)
  }, [backPrompt, backToSettings])

  function discardAndReturn() {
    setProfileAttributesJson(savedJson)
    setBackPrompt(false)
    onBackToSettings()
  }

  function focusValidationIssue(issue) {
    if (!issue?.key) return
    const target = fields.find((field) => field.key === issue.key)
    setShowJson(false)
    setSearch('')
    setActiveGroup(target?.group.id || 'all')
    setSelectedKey(issue.key)
  }

  function saveAndReturn() {
    if (save(false)) {
      setBackPrompt(false)
      onBackToSettings()
    }
  }

  const selectedDisplayUnit = selectedField ? unitProfile.getAttributeUnit(selectedKey) : ''

  return (
    <div ref={screenRef} className="profile-mapping-screen" role="dialog" aria-modal="true" aria-labelledby="profile-mapping-title">
      <header className="profile-mapping-header">
        <div>
          <p className="profile-mapping-kicker">Device Protocol Profile</p>
          <h1 id="profile-mapping-title" ref={titleRef} tabIndex={-1}>{profileName || 'Unnamed profile'}</h1>
          <div className="profile-mapping-profile-id">{profileId} · {fields.length} fields{dirty ? ' · Unsaved changes' : ''}</div>
        </div>
        <div className="profile-mapping-header-actions">
          <button type="button" className="secondary" onClick={backToSettings}>Back to Settings</button>
          <button type="button" className="secondary" onClick={() => setSubmissionOpen(true)} disabled={!parsed.value || !fetchSubmissionPositions}>Suggest Profile</button>
          <button type="button" className="secondary" onClick={() => save(false)} disabled={!canSave || !dirty || Boolean(parsed.error)}>Save</button>
          <button type="button" onClick={() => save(true)} disabled={!canSave || !dirty || Boolean(parsed.error)}>Save and Close</button>
        </div>
      </header>

      <div className="profile-mapping-toolbar">
        <label className="profile-mapping-search">Search fields
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Label, Traccar key, AVL ID, unit…" />
        </label>
        <label>Show
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All fields</option>
            <option value="unmapped">Unlabeled fields</option>
            <option value="conversion">Fields with conversions</option>
            <option value="status">Status card fields</option>
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => setShowJson((value) => !value)}>{showJson ? 'Visual fields' : 'Advanced / JSON'}</button>
        {loadRevisions && <button type="button" className="secondary" onClick={showRevisionHistory} disabled={!serverSyncEnabled}>{historyOpen ? 'Hide history' : 'Version history'}</button>}
      </div>

      <section className="profile-mapping-notice profile-mapping-inventory" aria-label="Vehicle field inventory">
        <div className="profile-mapping-inventory-controls">
          <label>Observed on vehicle
            <select value={inventoryDeviceId} onChange={(event) => setInventoryDeviceId(event.target.value)} disabled={!submissionDevices.length}>
              {submissionDevices.map((device) => <option key={device.id} value={String(device.id)}>{device.name || device.uniqueId || ('Device ' + device.id)}</option>)}
            </select>
          </label>
          <div className="profile-mapping-inventory-status" role="status">
            {!inventoryDeviceId ? 'Choose a vehicle to load its observed fields.' : inventoryLoading && !fieldInventory ? 'Loading field inventory…' : inventoryError || (
              fieldInventory?.status === 'queued' ? 'History scan queued…' :
              fieldInventory?.status === 'scanning' ? 'Scanning history… ' + (fieldInventory.progressPercent == null ? '' : Math.round(fieldInventory.progressPercent) + '%') :
              fieldInventory?.status === 'error' ? fieldInventory.error || 'The history scan failed.' :
              fieldInventory?.status === 'complete' ? fieldInventory.fields.length + ' observed fields, scanned through ' + (fieldInventory.generatedAt ? new Date(fieldInventory.generatedAt).toLocaleString() : 'the latest available history') + '.' :
              'Observed Traccar fields are added here without changing the saved profile.'
            )}
          </div>
          <button type="button" className="small secondary" onClick={updateVehicleInventory} disabled={!inventoryDeviceId || inventoryLoading || ['queued', 'scanning'].includes(fieldInventory?.status)}>
            {fieldInventory?.status === 'error' ? 'Retry scan' : 'Update inventory'}
          </button>
        </div>
        <small>Only field names, value types, counts, and first/last-seen times are kept in this inventory; position values and locations are not saved.</small>
      </section>

      {historyOpen && <section className="profile-mapping-notice profile-mapping-history" aria-label="Profile version history">
        <strong>Version history</strong>
        <p>Choose a revision to restore the selected field. This creates a new revision and leaves the rest of the profile unchanged.</p>
        {historyLoading ? <p>Loading revisions…</p> : revisionHistory.length === 0 ? <p>No saved revisions are available.</p> : (
          <ul>
            {revisionHistory.map((revision) => {
              const revisionMap = revision.attributeMap || revision.AttributeMap || {}
              const hasField = selectedKey && Object.hasOwn(revisionMap, selectedKey)
              const sameMapping = selectedKey && JSON.stringify(revisionMap[selectedKey]) === JSON.stringify(attributeMap[selectedKey])
              return <li key={`${revision.id}-${revision.revision}`}>
                <span>Revision {revision.revision} · {revision.changeKind || 'saved'} · effective {revision.effectiveAt ? new Date(revision.effectiveAt).toLocaleString() : 'time unavailable'}{revision.createdAt ? ` · recorded ${new Date(revision.createdAt).toLocaleString()}` : ''}</span>
                {selectedKey && <button type="button" className="small secondary" disabled={!canSave || dirty || sameMapping} onClick={() => restoreFieldFromRevision(revision)}>
                  {hasField ? `Restore ${selectedKey} from this revision` : `Remove ${selectedKey} mapping`}
                </button>}
              </li>
            })}
          </ul>
        )}
      </section>}

      {storageNotice && <div className="profile-mapping-notice" role="status">{storageNotice}</div>}
      {editorStatus && <div className="profile-mapping-notice" role="status">{editorStatus}</div>}
      {syncStatus && <div className="profile-mapping-notice" role="status">{syncStatus}</div>}
      {parsed.error && <div className="profile-mapping-error" role="alert">
        <p>Fix the profile mapping issues before saving.</p>
        {parsed.issues?.length ? <ul>{parsed.issues.map((issue, index) => (
          <li key={`${issue.key || 'profile'}-${index}`}>
            {issue.key
              ? <button type="button" className="profile-mapping-validation-link" onClick={() => focusValidationIssue(issue)}>{issue.key}: {issue.message}</button>
              : issue.message}
          </li>
        ))}</ul> : <p>{parsed.error}</p>}
      </div>}
      {localStatus && <div className="profile-mapping-notice" role="status">{localStatus}</div>}

      {showJson ? (
        <section className="profile-mapping-json-panel" aria-label="Advanced JSON editor">
          <p>Changes here update the same profile draft used by the visual editor. Unknown properties are preserved.</p>
          <textarea value={profileAttributesJson} onChange={(event) => setProfileAttributesJson(event.target.value)} disabled={!canSave} spellCheck="false" aria-label="Field mapping JSON" />
        </section>
      ) : (
        <div className="profile-mapping-workspace">
          <nav className="profile-mapping-groups" aria-label="Telemetry systems">
            <button type="button" className={activeGroup === 'all' ? 'active' : ''} onClick={() => setActiveGroup('all')}>
              All / Search <span>{fields.length}</span>
            </button>
            {groups.map((group) => {
              const count = fields.filter((field) => field.group.id === group.id).length
              if (!count) return null
              return <button type="button" key={group.id} className={activeGroup === group.id ? 'active' : ''} onClick={() => setActiveGroup(group.id)}>{group.label}<span>{count}</span></button>
            })}
            <div className="profile-mapping-add-field">
              <label htmlFor="profile-mapping-new-key">Add Traccar key</label>
              <input id="profile-mapping-new-key" value={fieldKeyDraft} disabled={!canSave} onChange={(event) => setFieldKeyDraft(event.target.value)} placeholder="io999 or customKey" onKeyDown={(event) => { if (event.key === 'Enter') addField() }} />
              <button type="button" className="small secondary" onClick={addField} disabled={!canSave}>Add field</button>
            </div>
          </nav>

          <section className="profile-mapping-results" aria-label="Profile fields">
            <div className="profile-mapping-results-heading"><h2>{activeGroup === 'all' ? 'All systems' : groups.find((group) => group.id === activeGroup)?.label}</h2><span>{visibleFields.length} field(s)</span></div>
            <div className="profile-mapping-card-grid">
              {visibleFields.map(({ key, mapping, group, origin, observation }) => {
                const label = String(mapping.label || '').trim()
                const unit = unitProfile.getAttributeUnit(key)
                const hasValidationIssues = parsed.issues?.some((issue) => issue.key === key)
                return (
                  <button type="button" className={`profile-mapping-card${selectedKey === key ? ' selected' : ''}`} key={key} onClick={() => { setSelectedKey(key); setSampleValue(''); setSentinelDraft(JSON.stringify(mapping.sentinelValues || [])) }} aria-pressed={selectedKey === key}>
                    <span className="profile-mapping-card-title">{label || key}</span>
                    <span className="profile-mapping-card-key">{key}{mapping.avlId !== undefined ? ` · AVL ${mapping.avlId}` : ''}</span>
                    <span className="profile-mapping-card-conversion">{describeConversion(mapping, unit)}</span>
                    <span className="profile-mapping-badges">
                      {!label && <span className="profile-mapping-badge warning">Unmapped</span>}
                      {origin === 'observed' && <span className="profile-mapping-badge warning">Observed on vehicle</span>}
                      {observation && <span className="profile-mapping-badge muted">{observation.positionCount ?? 0} points</span>}
                      {hasValidationIssues && <span className="profile-mapping-badge warning">Needs attention</span>}
                      {mapping.sourceGroup && <span className="profile-mapping-badge">{mapping.sourceGroup}</span>}
                      {mapping.statusCardField && <span className="profile-mapping-badge">Status card</span>}
                      <span className="profile-mapping-badge muted">{group.label}</span>
                    </span>
                  </button>
                )
              })}
              {visibleFields.length === 0 && <p className="profile-mapping-empty">No fields match this view.</p>}
            </div>
          </section>

          {selectedField && selectedMapping && (
            <aside className="profile-mapping-inspector" aria-label={`Edit ${selectedKey}`}>
              <div className="profile-mapping-inspector-header">
                <div><span className="profile-mapping-kicker">{selectedKey}</span><h2>{selectedMapping.label || selectedKey}</h2></div>
                <button type="button" className="small secondary" onClick={() => setSelectedKey(null)} aria-label="Close field details">Close</button>
              </div>
              {parsed.issues?.filter((issue) => issue.key === selectedKey).map((issue, index) => (
                <p className="profile-mapping-field-error" role="alert" key={`${issue.key}-${index}`}>{issue.message}</p>
              ))}
              <fieldset className="profile-mapping-fields-fieldset" disabled={!canSave}>
              <div className="profile-mapping-form-grid">
                <label>Label<input value={selectedMapping.label || ''} onChange={(event) => updateField(selectedKey, 'label', event.target.value)} /></label>
                <label>Value type
                  <select value={selectedMapping.valueType || 'number'} onChange={(event) => updateField(selectedKey, 'valueType', event.target.value === 'number' ? undefined : event.target.value)}>
                    <option value="number">Number (default)</option>
                    <option value="text">Text</option>
                    <option value="identifier">Identifier</option>
                  </select>
                </label>
                <label>AVL ID<input type="number" min="0" step="1" value={selectedMapping.avlId ?? ''} onChange={(event) => updateField(selectedKey, 'avlId', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                <label>Source group<input value={selectedMapping.sourceGroup || ''} onChange={(event) => updateField(selectedKey, 'sourceGroup', event.target.value || undefined)} placeholder="obd, tracker, permanent…" /></label>
                <label>Automotive system
                  <select value={selectedMapping.systemGroup || ''} onChange={(event) => updateField(selectedKey, 'systemGroup', event.target.value || undefined)}>
                    <option value="">Suggest from label</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                  </select>
                </label>
                <label>Measurement type
                  <select value={selectedMapping.quantity || ''} onChange={(event) => updateField(selectedKey, 'quantity', event.target.value || undefined)}>
                    <option value="">Choose if known</option>
                    {selectedMapping.quantity && !TELEMETRY_QUANTITY_OPTIONS.some((option) => option.value === selectedMapping.quantity) && <option value={selectedMapping.quantity}>{selectedMapping.quantity} (current)</option>}
                    {TELEMETRY_QUANTITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>Status card field<input value={selectedMapping.statusCardField || ''} onChange={(event) => updateField(selectedKey, 'statusCardField', event.target.value || undefined)} placeholder="Optional stable preference key" /></label>
                <label>Received unit
                  <select value={sourceUnitChoice} onChange={(event) => updateMapping(selectedKey, mappingForSourceUnit(selectedMapping, event.target.value))}>
                    <option value="__unknown">Unknown</option><option value="__none">No unit</option>
                    {getTelemetryUnitGroups().map((group) => <optgroup key={group.quantity} label={group.label}>{group.units.map((unit) => <option key={unit.symbol} value={unit.symbol}>{unit.label}</option>)}</optgroup>)}
                    {customSourceUnit && <option value={customSourceUnit}>{customSourceUnit} (current)</option>}
                  </select>
                </label>
                <label>Show as
                  <select value={selectedMapping.displayUnit || ''} disabled={!displayChoices.length} onChange={(event) => updateField(selectedKey, 'displayUnit', event.target.value || undefined)}>
                    <option value="">Follow display settings</option>{displayChoices.map((unit) => <option key={unit.symbol} value={unit.symbol}>{unit.label}</option>)}
                  </select>
                </label>
                <details className="profile-mapping-advanced profile-mapping-span-two">
                  <summary>Detailed conversion settings</summary>
                  <div className="profile-mapping-form-grid">
                    <label>Conversion multiplier<input type="number" step="any" value={selectedMapping.canonicalScale ?? ''} onChange={(event) => updateField(selectedKey, 'canonicalScale', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                    <label>Conversion offset<input type="number" step="any" value={selectedMapping.canonicalOffset ?? ''} onChange={(event) => updateField(selectedKey, 'canonicalOffset', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                    <label>Reference unit<input value={selectedMapping.canonicalUnit || ''} onChange={(event) => updateField(selectedKey, 'canonicalUnit', event.target.value || undefined)} placeholder="Only for custom conversions" /></label>
                    <label>Legacy conversion<input value={selectedMapping.conversion || ''} onChange={(event) => updateField(selectedKey, 'conversion', event.target.value || undefined)} placeholder="Existing compatibility rule" /></label>
                    <label>Precision<input type="number" min="0" max="12" step="1" value={selectedMapping.precision ?? ''} onChange={(event) => updateField(selectedKey, 'precision', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                    <label className="profile-mapping-span-two">Unavailable sample values (JSON array)
                      <input value={sentinelDraft} onChange={(event) => setSentinelDraft(event.target.value)} onBlur={() => {
                        try {
                          const values = JSON.parse(sentinelDraft)
                          if (!Array.isArray(values)) throw new Error('Sentinels must be an array.')
                          updateField(selectedKey, 'sentinelValues', values.length ? values : undefined)
                          setLocalStatus('')
                        } catch { setLocalStatus('Values must be a valid JSON array.') }
                      }} />
                    </label>
                  </div>
                </details>
              </div>
              </fieldset>

              <section className="profile-mapping-preview" aria-label="Display preview">
                <strong>How this value will display</strong>
                <p>{describeConversion(selectedMapping, selectedDisplayUnit)}</p>
                {selectedMapping.sourceSignedBits && <p>Negative values are decoded from signed {selectedMapping.sourceSignedBits}-bit data before unit conversion.</p>}
                {typeof selectedMapping.sourceReference === 'string' && selectedMapping.sourceReference.startsWith('https://') && <p><a href={selectedMapping.sourceReference} target="_blank" rel="noreferrer">Reference for this mapping</a></p>}
                <label>Received sample value<input inputMode="decimal" value={sampleValue} onChange={(event) => setSampleValue(event.target.value)} placeholder="Enter a sample value" /></label>
                <div className="profile-mapping-preview-values">
                  <span>Received<strong>{sampleValue.trim() ? `${sampleValue}${selectedMapping.sourceUnit ? ` ${selectedMapping.sourceUnit}` : ''}` : '—'}</strong></span>
                  <span>Your display<strong>{preview(unitProfile, selectedKey, sampleValue)}</strong></span>
                  <span>Imperial<strong>{preview(imperialProfile, selectedKey, sampleValue)}</strong></span>
                  <span>Metric<strong>{preview(metricProfile, selectedKey, sampleValue)}</strong></span>
                </div>
              </section>
              {Object.hasOwn(attributeMap, selectedKey) && <button type="button" className="small danger" onClick={() => removeField(selectedKey)} disabled={!canSave}>Remove mapping</button>}
            </aside>
          )}
        </div>
      )}

      {backPrompt && (
        <div className="profile-mapping-confirm-backdrop" role="presentation">
          <section className="profile-mapping-confirm" role="dialog" aria-modal="true" aria-labelledby="profile-mapping-unsaved-title">
            <h2 id="profile-mapping-unsaved-title">Unsaved profile changes</h2>
            <p>Save the field mapping draft before returning to Settings?</p>
            <div className="profile-mapping-header-actions">
              <button type="button" onClick={saveAndReturn} disabled={!canSave || Boolean(parsed.error)}>Save and Return</button>
              <button type="button" className="danger" onClick={discardAndReturn}>Discard Changes</button>
              <button type="button" className="secondary" onClick={() => setBackPrompt(false)}>Keep Editing</button>
            </div>
          </section>
        </div>
      )}
      {submissionOpen && <TelemetryProfileSubmissionDialog
        profile={{
          id: profileId,
          name: profileName,
          schemaVersion: profileSchemaVersion,
          attributeMap: parsed.value || {},
          isDraft: dirty,
        }}
        devices={submissionDevices}
        defaultDeviceId={submissionDefaultDeviceId}
        apiBaseUrl={submissionApiBaseUrl}
        fetchDevicePositions={fetchSubmissionPositions}
        onClose={() => setSubmissionOpen(false)}
      />}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createCarProfile, getAttributeMapValidationIssues, translateAttribute, updateProfileAttributeMapping } from '../lib/carProfiles'
import { getProfileFieldGroups } from '../lib/profileFieldGroups'

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
    const offset = Number(mapping.canonicalOffset || 0)
    const formula = `raw × ${mapping.canonicalScale}${offset ? ` + ${offset}` : ''} → ${mapping.canonicalUnit}`
    return `${formula}${displayUnit && displayUnit !== mapping.canonicalUnit ? ` → ${displayUnit}` : ''}`
  }
  if (mapping.conversion) return `${mapping.conversion} → ${displayUnit || mapping.units || 'value'}`
  return mapping.units ? `Raw value · ${mapping.units}` : 'Raw value · unit not set'
}

function preview(profile, key, value) {
  if (value.trim() === '') return 'Enter a raw sample value.'
  const result = translateAttribute(profile, key, value)
  if (result.status === 'sentinel') return 'Marked as a sentinel / unavailable value.'
  if (result.status === 'invalid') return 'Invalid for the selected mapping.'
  if (result.value === null || result.value === undefined) return 'No value.'
  return `${result.value}${result.unit ? ` ${result.unit}` : ''}`
}

function previewCanonical(profile, key, value, mapping) {
  if (value.trim() === '') return 'Enter a raw sample value.'
  if (typeof mapping.canonicalScale !== 'number' || !mapping.canonicalUnit) return 'Not defined for this legacy or raw mapping.'
  const result = translateAttribute(profile, key, value)
  if (result.status === 'sentinel') return 'Unavailable sentinel.'
  if (result.status === 'invalid' || !Number.isFinite(result.canonicalValue)) return 'Invalid for the selected mapping.'
  return `${result.canonicalValue}${mapping.canonicalUnit ? ` ${mapping.canonicalUnit}` : ''}`
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
  saveProfile,
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

  const parsed = useMemo(() => parseMappingJson(profileAttributesJson), [profileAttributesJson])
  const attributeMap = parsed.value || EMPTY_ATTRIBUTE_MAP
  const { groups, fields } = useMemo(() => getProfileFieldGroups(attributeMap), [attributeMap])
  const dirty = profileAttributesJson !== savedJson
  const selectedField = fields.find((field) => field.key === selectedKey) || null
  const selectedMapping = selectedField?.mapping || null
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
    writeMap(updateProfileAttributeMapping(parsed.value, key, property, value))
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
      </div>

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
              {visibleFields.map(({ key, mapping, group }) => {
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
                <label>Quantity<input value={selectedMapping.quantity || ''} onChange={(event) => updateField(selectedKey, 'quantity', event.target.value || undefined)} placeholder="temperature, fuel_pressure…" /></label>
                <label>Status card field<input value={selectedMapping.statusCardField || ''} onChange={(event) => updateField(selectedKey, 'statusCardField', event.target.value || undefined)} placeholder="Optional stable preference key" /></label>
                <label>Source unit<input value={selectedMapping.sourceUnit || ''} onChange={(event) => updateField(selectedKey, 'sourceUnit', event.target.value || undefined)} placeholder="Only when known" /></label>
                <label>Canonical unit<input value={selectedMapping.canonicalUnit || ''} onChange={(event) => updateField(selectedKey, 'canonicalUnit', event.target.value || undefined)} placeholder="Physical base unit" /></label>
                <label>Canonical scale<input type="number" step="any" value={selectedMapping.canonicalScale ?? ''} onChange={(event) => updateField(selectedKey, 'canonicalScale', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                <label>Canonical offset<input type="number" step="any" value={selectedMapping.canonicalOffset ?? ''} onChange={(event) => updateField(selectedKey, 'canonicalOffset', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                <label>Display unit fallback<input value={selectedMapping.units || ''} onChange={(event) => updateField(selectedKey, 'units', event.target.value || undefined)} /></label>
                <label>Legacy conversion<input value={selectedMapping.conversion || ''} onChange={(event) => updateField(selectedKey, 'conversion', event.target.value || undefined)} placeholder="Select a supported conversion" /></label>
                <label>Precision<input type="number" min="0" max="12" step="1" value={selectedMapping.precision ?? ''} onChange={(event) => updateField(selectedKey, 'precision', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                <label className="profile-mapping-span-two">Sentinel values (JSON array)
                  <input value={sentinelDraft} onChange={(event) => setSentinelDraft(event.target.value)} onBlur={() => {
                    try {
                      const values = JSON.parse(sentinelDraft)
                      if (!Array.isArray(values)) throw new Error('Sentinels must be an array.')
                      updateField(selectedKey, 'sentinelValues', values.length ? values : undefined)
                      setLocalStatus('')
                    } catch { setLocalStatus('Sentinel values must be a valid JSON array.') }
                  }} />
                </label>
              </div>
              </fieldset>

              <section className="profile-mapping-preview" aria-label="Conversion preview">
                <strong>Conversion preview</strong>
                <p>{describeConversion(selectedMapping, selectedDisplayUnit)}</p>
                <label>Raw sample<input inputMode="decimal" value={sampleValue} onChange={(event) => setSampleValue(event.target.value)} placeholder="Enter a sample value" /></label>
                <div className="profile-mapping-preview-values">
                  <span>Raw<strong>{sampleValue.trim() ? `${sampleValue}${selectedMapping.sourceUnit ? ` ${selectedMapping.sourceUnit}` : ''}` : '—'}</strong></span>
                  <span>Canonical<strong>{previewCanonical(unitProfile, selectedKey, sampleValue, selectedMapping)}</strong></span>
                  <span>Imperial<strong>{preview(imperialProfile, selectedKey, sampleValue)}</strong></span>
                  <span>Metric<strong>{preview(metricProfile, selectedKey, sampleValue)}</strong></span>
                </div>
              </section>
              <button type="button" className="small danger" onClick={() => removeField(selectedKey)} disabled={!canSave}>Remove mapping</button>
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
    </div>
  )
}

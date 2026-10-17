import { useState } from 'react'
import { compatibleTelemetryUnits, getTelemetryUnit, getTelemetryUnitGroups, TELEMETRY_QUANTITY_OPTIONS } from '../lib/telemetryUnits'
import { formatTelemetrySample } from '../lib/telemetrySamples'

function unitSelectionFor(mapping) {
  // Preserve custom legacy units as the selected "current" option instead of
  // making a configured source unit look unknown in the editor.
  if (mapping?.sourceUnit) return mapping.sourceUnit
  if (mapping?.sourceUnitStatus === 'none') return '__none'
  return '__unknown'
}

function mappingForUnit(mapping, value) {
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
    const next = { ...mapping, sourceUnitStatus: 'none', quantity: mapping.quantity || 'count' }
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
  const next = {
    ...mapping,
    sourceUnitStatus: 'known',
    sourceUnit: unit.symbol,
    quantity: unit.quantity,
    canonicalUnit: unit.canonicalUnit,
    canonicalScale: unit.scale,
    canonicalOffset: unit.offset,
    units: unit.symbol,
  }
  return next
}

export default function TelemetryFieldEditor({
  profile,
  candidateMappings = [],
  fieldKey,
  vehicleLabel = '',
  deviceLabel = '',
  deviceModel = '',
  matchContext = {},
  sampleValue = null,
  personalLabel = '',
  suggestionsDismissed = false,
  canEditShared = false,
  canEditSourceMapping = false,
  traccarDeviceId = null,
  sourceMappingHistory = [],
  supportsSharedMapping = true,
  sharedProfileVehicleCount = 0,
  onSavePersonalLabel,
  onSaveSharedMapping,
  onSaveSourceMapping,
  onUndoSourceMapping,
  onDismissSuggestion,
  onDismissAllSuggestions,
  onRestoreDismissedSuggestions,
  onClose,
}) {
  const existingMapping = profile?.getAttributeInfo?.(fieldKey) || {}
  const [draftLabel, setDraftLabel] = useState(personalLabel || existingMapping.label || '')
  const [draftMapping, setDraftMapping] = useState({ ...existingMapping, label: existingMapping.label || '' })
  const [personalBusy, setPersonalBusy] = useState(false)
  const [sharedBusy, setSharedBusy] = useState(false)
  const [scopeConfirmed, setScopeConfirmed] = useState(false)
  const [mappingScope, setMappingScope] = useState(canEditSourceMapping ? 'tracker' : 'shared')
  const [status, setStatus] = useState('')
  const [canUndoDismissal, setCanUndoDismissal] = useState(false)
  const [showTextSample, setShowTextSample] = useState(false)
  const sourceUnitChoice = unitSelectionFor(draftMapping)
  const selectedUnit = getTelemetryUnit(draftMapping.sourceUnit)
  const quantity = selectedUnit?.quantity || draftMapping.quantity || ''
  const displayChoices = compatibleTelemetryUnits(quantity)
  const existingUnit = draftMapping.sourceUnit && !selectedUnit ? draftMapping.sourceUnit : null
  const samplePresentation = formatTelemetrySample(fieldKey, draftMapping, sampleValue, { revealText: showTextSample })
  const updateUnit = (value) => {
    setDraftMapping((current) => mappingForUnit(current, value))
  }

  const selectCandidate = (candidate) => {
    if (candidate.catalogSuggestion) {
      setDraftLabel(candidate.mapping.label || '')
      setStatus('This saves the catalog label as your personal description. It does not change shared mappings or values.')
      return
    }
    setDraftMapping((current) => ({ ...current, ...candidate.mapping, label: candidate.mapping.label || current.label || '' }))
    if (candidate.mapping.label) setDraftLabel(candidate.mapping.label)
    setStatus(`Suggested from ${candidate.profileName}. Confirm the source and units before applying it to this profile.`)
  }

  const savePersonal = async () => {
    setPersonalBusy(true)
    setStatus('')
    try {
      const result = await onSavePersonalLabel(draftLabel.trim())
      setStatus(result?.message || 'Personal description saved.')
    } catch (error) {
      setStatus(`Saved on this device; account sync failed. ${error instanceof Error ? error.message : ''}`.trim())
    } finally {
      setPersonalBusy(false)
    }
  }

  const dismissSuggestion = async (profileId) => {
    try {
      const result = await onDismissSuggestion?.(profileId)
      setCanUndoDismissal(true)
      setStatus(result?.message || 'Suggestion dismissed.')
    } catch (error) {
      setStatus(`Suggestion dismissed on this device; account sync failed. ${error instanceof Error ? error.message : ''}`.trim())
    }
  }

  const dismissAllSuggestions = async () => {
    try {
      const result = await onDismissAllSuggestions?.()
      setCanUndoDismissal(true)
      setStatus(result?.message || 'The field will remain unknown.')
    } catch (error) {
      setStatus(`Suggestions dismissed on this device; account sync failed. ${error instanceof Error ? error.message : ''}`.trim())
    }
  }

  const restoreDismissedSuggestions = async () => {
    try {
      const result = await onRestoreDismissedSuggestions?.()
      setCanUndoDismissal(false)
      setStatus(result?.message || 'Dismissed suggestions restored.')
    } catch (error) {
      setStatus(`Unable to restore suggestions. ${error instanceof Error ? error.message : ''}`.trim())
    }
  }

  const saveShared = async () => {
    if (mappingScope === 'tracker' ? (!canEditSourceMapping || !traccarDeviceId) : (!canEditShared || !profile?.id)) return
    setSharedBusy(true)
    setStatus('')
    try {
      const next = { ...draftMapping, label: draftMapping.label.trim() }
      if (!next.label) delete next.label
      if (!next.quantity) delete next.quantity
      if (!next.displayUnit) delete next.displayUnit
      const result = mappingScope === 'tracker'
        ? await onSaveSourceMapping(next)
        : await onSaveSharedMapping(profile.id, fieldKey, next)
      if (!result?.ok) {
        setStatus(result?.message || 'The shared mapping could not be saved.')
        return
      }
      setStatus(result.message || (mappingScope === 'tracker' ? 'Tracker mapping saved.' : 'Shared mapping saved.'))
      onClose()
    } catch (error) {
      setStatus(`Shared mapping could not be saved. ${error instanceof Error ? error.message : ''}`.trim())
    } finally {
      setSharedBusy(false)
    }
  }

  const undoSourceMapping = async () => {
    if (!canEditSourceMapping || !sourceMappingHistory.length || !onUndoSourceMapping) return
    setSharedBusy(true)
    setStatus('')
    try {
      const result = await onUndoSourceMapping()
      if (!result?.ok) {
        setStatus(result?.message || 'The tracker mapping could not be undone.')
        return
      }
      setStatus(result.message || 'The tracker mapping was restored.')
      onClose()
    } catch (error) {
      setStatus(`Tracker mapping could not be undone. ${error instanceof Error ? error.message : ''}`.trim())
    } finally {
      setSharedBusy(false)
    }
  }

  return (
    <div className="telemetry-field-editor-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="telemetry-field-editor" role="dialog" aria-modal="true" aria-labelledby="telemetry-field-editor-title">
        <header className="telemetry-field-editor-header">
          <div>
            <p className="profile-mapping-kicker">Edit one data element</p>
            <h2 id="telemetry-field-editor-title">{fieldKey}</h2>
            <p>{[vehicleLabel, deviceLabel, profile?.name].filter(Boolean).join(' · ') || 'Current graph source'}</p>
            <p className="telemetry-field-editor-device-model">Traccar configured model: {deviceModel || 'not supplied'}</p>
            <p className="telemetry-field-editor-device-model">Documented-match context: {[matchContext.manufacturer && `manufacturer attribute ${matchContext.manufacturer}`, matchContext.decoderVersion && `Traccar server ${matchContext.decoderVersion}`, matchContext.firmwareConflict ? 'conflicting firmware attributes' : matchContext.firmware ? `firmware attribute ${matchContext.firmware}` : 'firmware not supplied', Object.keys(matchContext.configuration || {}).length ? 'telemetry configuration supplied' : 'telemetry configuration not supplied'].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" className="small secondary" onClick={onClose} aria-label="Close field editor">×</button>
        </header>

        <section className="telemetry-field-editor-card" aria-label="Profile mapping card">
          <div className="profile-mapping-inspector-header">
            <div><span className="profile-mapping-kicker">Profile mapping card</span><h3>{draftMapping.label || `Unmapped ${fieldKey}`}</h3></div>
            {!existingMapping.label && <span className="profile-mapping-badge warning">Unmapped</span>}
          </div>
          <div className="profile-mapping-card-key">{fieldKey}{draftMapping.avlId !== undefined ? ` · AVL ${draftMapping.avlId}` : ''}</div>
          {samplePresentation && <p className="telemetry-field-editor-sample"><strong>Received sample</strong> {samplePresentation.text}{samplePresentation.revealable && <button type="button" className="small secondary telemetry-field-editor-sample-toggle" onClick={() => setShowTextSample((current) => !current)}>{showTextSample ? 'Hide text value' : 'Show text value'}</button>}{!samplePresentation.hidden && typeof sampleValue === 'number' && draftMapping.sourceUnit ? ` ${draftMapping.sourceUnit}` : ''}</p>}
          {draftMapping.sourceSignedBits && <p>Negative values are decoded from signed {draftMapping.sourceSignedBits}-bit data before unit conversion.</p>}
          {typeof draftMapping.sourceReference === 'string' && draftMapping.sourceReference.startsWith('https://') && <p><a href={draftMapping.sourceReference} target="_blank" rel="noreferrer">Reference for this mapping</a></p>}
        </section>

        <section className="telemetry-field-editor-personal">
          <h3>Your description</h3>
          <label>Description shown to you<input autoFocus value={draftLabel} maxLength={120} onChange={(event) => setDraftLabel(event.target.value)} placeholder={`Unmapped ${fieldKey}`} /></label>
          <p className="telemetry-field-editor-guess"><span aria-hidden="true">●</span> A personal description is a guess for your account. It does not change the field's units or values.</p>
          <button type="button" className="small secondary" onClick={savePersonal} disabled={personalBusy || !onSavePersonalLabel}>{personalBusy ? 'Saving…' : 'Save my description'}</button>
        </section>

        {candidateMappings.length > 0 && (
          <section className="telemetry-field-editor-suggestions">
            <h3>Related profile suggestions</h3>
            <p>These labels come from device documentation or other tracker profiles. Catalog labels are saved as your personal description; profile mapping suggestions may include units or conversions to review.</p>
            {candidateMappings.map((candidate) => (
              <div className="telemetry-field-editor-candidate-row" key={candidate.profileId}>
                <button type="button" className="telemetry-field-editor-candidate" onClick={() => selectCandidate(candidate)}>
                  <span><strong>{candidate.mapping.label}</strong><small>{candidate.profileName}{candidate.catalogSuggestion ? '' : ` · ${candidate.mapping.sourceUnit || candidate.mapping.units || 'unit not set'}`} · {candidate.reason}</small></span>
                  <span className="profile-mapping-badge warning">{candidate.catalogSuggestion ? 'Use this label' : 'Suggestion'}</span>
                </button>
                {candidate.references?.length > 0 && <p className="telemetry-field-editor-candidate-sources">Sources: {candidate.references.map((reference, index) => (
                  <span key={`${reference.url}-${index}`}>{index > 0 ? ', ' : ''}<a href={reference.url} target="_blank" rel="noreferrer">{reference.title || 'Documentation'}</a></span>
                ))}</p>}
                <button type="button" className="small secondary" onClick={() => dismissSuggestion(candidate.profileId)}>Dismiss</button>
              </div>
            ))}
            <button type="button" className="small secondary telemetry-field-editor-dismiss-all" onClick={dismissAllSuggestions}>None of these — keep this field unknown</button>
          </section>
        )}

        {suggestionsDismissed && !canUndoDismissal && <div className="telemetry-field-editor-suggestions">
          <p>Suggestions dismissed for this field are hidden.</p>
          <button type="button" className="small secondary" onClick={restoreDismissedSuggestions}>Restore dismissed suggestions</button>
        </div>}

        <details className="telemetry-field-editor-shared" open={canEditShared}>
          <summary>{canEditShared ? 'Shared interpretation (administrator)' : 'Shared interpretation'}</summary>
          {!supportsSharedMapping
            ? <p>GPS speed is derived from location data. Its display units follow the vehicle's unit setting and do not use a protocol-field mapping.</p>
            : !canEditShared
            ? <p>Only administrators can change shared labels, units, and conversions. You can save your own description above.</p>
                : mappingScope === 'shared' && !profile?.id
              ? <p>This graph has no assigned protocol profile. Choose a profile for the vehicle before creating a shared mapping.</p>
              : (
                <div className="telemetry-field-editor-form">
                  {canEditSourceMapping && <fieldset className="telemetry-field-editor-scope-choice"><legend>Where should this interpretation apply?</legend>
                    <label><input type="radio" name="telemetry-mapping-scope" value="tracker" checked={mappingScope === 'tracker'} onChange={() => setMappingScope('tracker')} /> This tracker only (Traccar device {traccarDeviceId})</label>
                    <label><input type="radio" name="telemetry-mapping-scope" value="shared" checked={mappingScope === 'shared'} onChange={() => setMappingScope('shared')} disabled={!profile?.id} /> All trackers using {profile?.name || 'this profile'}</label>
                  </fieldset>}
                  {canEditSourceMapping && sourceMappingHistory.length > 0 && <div className="telemetry-field-editor-history">
                    <p>Tracker mapping revision {sourceMappingHistory.at(-1).revision} was saved {new Date(sourceMappingHistory.at(-1).effectiveAt).toLocaleString()}.</p>
                    {sourceMappingHistory.at(-1).changeKind === 'documented-auto' && <p>Applied from an approved tracker documentation match. It affects data received after this time.</p>}
                    <button type="button" className="small secondary" onClick={undoSourceMapping} disabled={sharedBusy}>Undo last tracker-only change</button>
                  </div>}
                  <label>Shared description<input value={draftMapping.label} maxLength={120} onChange={(event) => setDraftMapping((current) => ({ ...current, label: event.target.value }))} placeholder={`Unmapped ${fieldKey}`} /></label>
                  <label>Value type<select value={draftMapping.valueType || 'number'} onChange={(event) => setDraftMapping((current) => ({ ...current, valueType: event.target.value === 'number' ? undefined : event.target.value }))}>
                    <option value="number">Number</option><option value="text">Text</option><option value="identifier">Identifier</option>
                  </select></label>
                  <label>Measurement type<select value={quantity} onChange={(event) => setDraftMapping((current) => ({ ...current, quantity: event.target.value || undefined }))}>
                    <option value="">Choose if known</option>{TELEMETRY_QUANTITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select></label>
                  <label>Received unit<select value={sourceUnitChoice} onChange={(event) => updateUnit(event.target.value)}>
                    <option value="__unknown">Unknown</option><option value="__none">No unit</option>
                    {getTelemetryUnitGroups().map((group) => <optgroup key={group.quantity} label={group.label}>
                      {group.units.map((unit) => <option key={unit.symbol} value={unit.symbol}>{unit.label}</option>)}
                    </optgroup>)}
                    {existingUnit && <option value={existingUnit}>{existingUnit} (current)</option>}
                  </select></label>
                  <label>Show as<select value={draftMapping.displayUnit || ''} onChange={(event) => setDraftMapping((current) => ({ ...current, displayUnit: event.target.value || undefined }))} disabled={!displayChoices.length}>
                    <option value="">Follow display settings</option>{displayChoices.map((unit) => <option key={unit.symbol} value={unit.symbol}>{unit.label}</option>)}
                  </select></label>
                  <p className="telemetry-field-editor-help">Choose the unit already present in the Traccar API. The app keeps the received value and converts only when displaying it.</p>
                  {mappingScope === 'shared' && sharedProfileVehicleCount > 1 && <label className="telemetry-field-editor-scope"><input type="checkbox" checked={scopeConfirmed} onChange={(event) => setScopeConfirmed(event.target.checked)} /> This shared profile is assigned to {sharedProfileVehicleCount} vehicles. Apply this interpretation to all of them.</label>}
                  <button type="button" onClick={saveShared} disabled={sharedBusy || (mappingScope === 'tracker' ? !onSaveSourceMapping : !onSaveSharedMapping) || (mappingScope === 'shared' && sharedProfileVehicleCount > 1 && !scopeConfirmed)}>{sharedBusy ? 'Saving…' : `Save ${mappingScope === 'tracker' ? 'tracker' : 'shared'} mapping and return to graph`}</button>
                </div>
              )}
        </details>
        {status && <p className="telemetry-field-editor-status" role="status">{status}{canUndoDismissal && <button type="button" className="small secondary" onClick={restoreDismissedSuggestions}>Undo dismissal</button>}</p>}
        <footer><button type="button" className="small secondary" onClick={onClose}>Return to graph</button></footer>
      </section>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { isTelemetryPlaceholderValue } from '../lib/telemetry'
import { DEFAULT_STATUS_CARD_FIELDS, getStatusCardAttributeKeys, normalizeStatusCardFields } from '../lib/statusCardFields'
import { translateAttribute } from '../lib/carProfiles'

function VehicleStatusCard({
  device,
  vehicleId,
  point,
  historyPoints = [],
  profile = null,
  cardFields = DEFAULT_STATUS_CARD_FIELDS,
  style,
  position,
  onPositionChange,
  onPositionCommit,
  collapsed = true,
  onCollapsedChange,
}) {
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const [copyStatus, setCopyStatus] = useState('')

  const clampPosition = useCallback((left, top) => {
    const width = panelRef.current?.offsetWidth || 280
    const height = panelRef.current?.offsetHeight || 100
    const margin = 8
    return {
      left: Math.max(margin, Math.min(left, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)),
    }
  }, [])

  useEffect(() => {
    if (!position) return undefined
    const keepInViewport = () => {
      if (Number.isFinite(position.right)) {
        const width = panelRef.current?.offsetWidth || 280
        const height = panelRef.current?.offsetHeight || 100
        const right = Math.max(8, Math.min(position.right, Math.max(8, window.innerWidth - width - 8)))
        const top = Math.max(8, Math.min(position.top, Math.max(8, window.innerHeight - height - 8)))
        if (right !== position.right || top !== position.top) onPositionCommit({ ...position, right, top })
        return
      }
      const next = clampPosition(position.left, position.top)
      if (next.left !== position.left || next.top !== position.top) onPositionCommit(next)
    }
    keepInViewport()
    window.addEventListener('resize', keepInViewport)
    window.visualViewport?.addEventListener('resize', keepInViewport)
    return () => {
      window.removeEventListener('resize', keepInViewport)
      window.visualViewport?.removeEventListener('resize', keepInViewport)
    }
  }, [clampPosition, onPositionCommit, position])

  const startDragging = useCallback((event) => {
    if (event.button !== 0 || event.target.closest('button, a, input, select, textarea')) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
      position: { left: rect.left, top: rect.top },
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const dragPanel = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return
    drag.moved = true
    const next = clampPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY)
    drag.position = next
    onPositionChange(next)
  }, [clampPosition, onPositionChange])

  const stopDragging = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.moved) {
      onPositionCommit(drag.position)
    }
  }, [onPositionCommit])

  const dragHandleProps = {
    className: 'vehicle-status-header vehicle-status-drag-handle',
    title: 'Drag to move Vehicle Status',
    onPointerDown: startDragging,
    onPointerMove: dragPanel,
    onPointerUp: stopDragging,
    onPointerCancel: stopDragging,
  }

  if (!device) {
    return (
      <div ref={panelRef} className="vehicle-status-card" data-vehicle-id={vehicleId || ''} style={style}>
        <div {...dragHandleProps}><strong>Vehicle Status</strong><span>No mapped vehicle</span></div>
        <div className="vehicle-status-diagnostic">
          No vehicle-mapped device is currently selected. Open Settings and verify Vehicle Catalog and Device Bindings.
        </div>
        <small>No point loaded · 0 known values</small>
      </div>
    )
  }
  const attrs = point?.attributes || {}
  const displayAttrs = Object.fromEntries(Object.entries(attrs).filter(([key, value]) => {
    const historyValues = historyPoints.map((candidate) => candidate.attributes?.[key]).filter((candidate) => candidate !== undefined && candidate !== null && candidate !== '')
    if (isTelemetryPlaceholderValue(key, value, profile)) return false
    if (historyValues.length < 2) return true
    const numbers = historyValues.map(Number).filter(Number.isFinite)
    return numbers.length === 0 || numbers.some((number) => number !== 0 && !isTelemetryPlaceholderValue(key, number, profile))
  }))
  const rawKeyForStatusField = (field) => getStatusCardAttributeKeys(profile, field).find((key) => attrs[key] !== undefined) || null
  const selectedFields = new Set(normalizeStatusCardFields(cardFields))
  const profileValue = (field, key) => {
    if (!key) return ''
    const raw = attrs[key]
    const translated = translateAttribute(profile, key, raw)
    return ['missing', 'sentinel', 'invalid'].includes(translated.status) ? '' : translated.value
  }
  const formatProfileValue = (value) => {
    if (typeof value === 'boolean') return String(value)
    const numeric = Number(value)
    return value !== '' && Number.isFinite(numeric)
      ? numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : value
  }
  const values = [...selectedFields].map((field) => {
    const key = rawKeyForStatusField(field)
    if (!key) return null
    const translated = translateAttribute(profile, key, attrs[key])
    return [field, translated.label, profileValue(field, key), translated.unit.replace('degF', '°F')]
  }).filter(Boolean)
  const isKnown = (value) => value !== undefined && value !== null && value !== ''
  const visibleValues = values.filter(([key, , value]) => selectedFields.has(key) && isKnown(value))
  const known = visibleValues
  const ageMinutes = point ? Math.max(0, Math.round((Date.now() - point.timestamp.getTime()) / 60000)) : null
  const ignition = attrs[rawKeyForStatusField('ignition')]
  const motion = attrs[rawKeyForStatusField('motion')]
  const compactTimestamp = point ? point.timestamp.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) : ''
  const connection = !point ? 'No data loaded' : ageMinutes <= 15 ? 'Recent data' : ageMinutes <= 60 ? 'Stale data' : compactTimestamp
  const active = ignition === true || ignition === 'true' || motion === true || motion === 'true'
  const rpmKeys = getStatusCardAttributeKeys(profile, 'engineRpm')
  const rpmValueFrom = (candidate) => rpmKeys.map((key) => candidate?.attributes?.[key]).find((value) => value !== undefined && value !== null && value !== '')
  const currentRpm = rpmValueFrom(point)
  const lastRpmPoint = [...historyPoints]
    .filter((candidate) => !point || candidate.timestamp <= point.timestamp)
    .sort((a, b) => b.timestamp - a.timestamp)
    .find((candidate) => rpmValueFrom(candidate) !== undefined)
  const rpmGapMinutes = point && lastRpmPoint ? Math.max(0, (point.timestamp - lastRpmPoint.timestamp) / 60000) : null
  const rpmWarning = selectedFields.has('engineRpm') && active && (currentRpm === undefined || currentRpm === null || currentRpm === '') && (!lastRpmPoint || rpmGapMinutes >= 5)
  const engineState = ignition === true || ignition === 'true' ? 'Running' : ignition === false || ignition === 'false' ? 'Off' : null
  const compactValue = (value, unit) => {
    if (!isKnown(value)) return `— ${unit}`
    const numeric = Number(value)
    const formatted = Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { maximumFractionDigits: 1 }) : value
    return `${formatted} ${unit}`
  }
  const compactRows = ['engineRpm', 'throttle', 'maf']
    .filter((field) => selectedFields.has(field))
    .map((field) => values.find(([rowField]) => rowField === field) || [field, field, '', ''])
  const compactRowsWithValues = compactRows.concat(values.filter((row) => !compactRows.some(([field]) => field === row[0])))
  const compactTelemetry = compactRowsWithValues.slice(0, 3).map((row) => compactValue(row[2], row[3] || ''))
  const copyOtherFields = async (event) => {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(JSON.stringify(displayAttrs, null, 2))
      setCopyStatus('Copied')
    } catch {
      setCopyStatus('Copy failed')
    }
    window.setTimeout(() => setCopyStatus(''), 1800)
  }
  const toggleCollapsed = () => onCollapsedChange?.(!collapsed)
  return <div ref={panelRef} className={`vehicle-status-card${collapsed ? ' is-collapsed' : ''}`} data-vehicle-id={vehicleId || ''} data-selected-status-fields={[...selectedFields].join(' ')} style={style}>
    <div {...dragHandleProps}>
      <strong>{device.name}</strong>
      <span>{connection}</span>
      <button type="button" className="vehicle-status-toggle" onClick={toggleCollapsed} aria-expanded={!collapsed} title={collapsed ? 'Expand vehicle status' : 'Collapse vehicle status'}>{collapsed ? '＋' : '−'}</button>
    </div>
      {collapsed ? <div className="vehicle-status-compact-values" aria-label="Selected telemetry values">{compactTelemetry.map((value, index) => <span key={index}>{value}</span>)}</div> : <>
      {visibleValues.length > 0 || (selectedFields.has('ignition') && engineState) ? <div className="vehicle-status-grid">{visibleValues.map(([, label, value, unit]) => <div key={label}><span>{label}</span><strong>{`${formatProfileValue(value)} ${unit}`}</strong></div>)}{selectedFields.has('ignition') && engineState && <div><span>Engine state</span><strong>{engineState}</strong></div>}</div> : null}
      {rpmWarning && <div className="vehicle-status-diagnostic">RPM has not been reported for {lastRpmPoint ? `${Math.round(rpmGapMinutes)} minutes` : 'the loaded history'} while the device appears active; unchanged RPM values are otherwise treated as valid.</div>}
      <div className="vehicle-status-other-fields"><details><summary>Other fields ({Object.keys(displayAttrs).length})</summary><pre>{JSON.stringify(displayAttrs, null, 2)}</pre></details><button type="button" className="vehicle-status-copy" onClick={copyOtherFields} aria-label="Copy other fields to clipboard" title={copyStatus || 'Copy other fields to clipboard'}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="3" width="8" height="10" rx="1"/><path d="M3 11H2V2h8v1"/></svg><span className="vehicle-status-copy-feedback" aria-live="polite">{copyStatus}</span></button></div>
      <small>{point ? `Point: ${point.timestamp.toLocaleString()} · ${ageMinutes} min old` : 'No point loaded'} · {known.length} known values</small>
    </>}
  </div>
}

export default VehicleStatusCard

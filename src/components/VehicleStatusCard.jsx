import { useCallback, useEffect, useRef, useState } from 'react'
import { isTelemetryPlaceholderValue } from '../lib/telemetry'
import { DEFAULT_STATUS_CARD_FIELDS } from '../lib/statusCardFields'

function VehicleStatusCard({
  device,
  point,
  historyPoints = [],
  profile = null,
  cardFields = DEFAULT_STATUS_CARD_FIELDS,
  style,
  position,
  onPositionChange,
  onPositionCommit,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)

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
      const next = clampPosition(position.left, position.top)
      if (next.left !== position.left || next.top !== position.top) onPositionCommit(next)
    }
    keepInViewport()
    window.addEventListener('resize', keepInViewport)
    return () => window.removeEventListener('resize', keepInViewport)
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
      suppressClickRef.current = true
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
      <div ref={panelRef} className="vehicle-status-card" style={style}>
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
  const profileLabel = (key, fallback) => profile?.getAttributeInfo(key)?.label || fallback
  const profileUnit = (key, fallback) => profile?.getAttributeInfo(key)?.units?.replace('degF', '°F') || fallback
  const profileValue = (key, fallback) => profile ? profile.decodeAttributeValue(key, attrs[key] ?? fallback) : (attrs[key] ?? fallback)
  const selectedFields = new Set(Array.isArray(cardFields) ? cardFields : DEFAULT_STATUS_CARD_FIELDS)
  const values = [
    ['fuelLevel', 'Fuel level', attrs.io48 ?? attrs.fuelLevel, '%'],
    ['engineRpm', profileLabel('io36', 'Engine RPM'), profileValue('io36', attrs.rpm), 'rpm'],
    ['power', 'Power', attrs.power ?? attrs.io66, 'V'],
    ['coolant', profileLabel('io32', 'Coolant'), profileValue('io32', attrs.coolant), profileUnit('io32', '°F')],
    ['engineRuntime', profileLabel('io42', 'Engine runtime'), profileValue('io42'), profileUnit('io42', 's')],
    ['maf', profileLabel('io40', 'MAF'), profileValue('io40'), profileUnit('io40', 'g/s')],
    ['intakeAir', profileLabel('io39', 'Intake air'), profileValue('io39'), profileUnit('io39', '°F')],
    ['throttle', profileLabel('io41', 'Throttle'), profileValue('io41'), profileUnit('io41', '%')],
    ['ignition', 'Ignition', attrs.ignition ?? attrs.io239, ''],
    ['obdSpeed', profileLabel('io37', 'OBD speed'), profileValue('io37', attrs.obdSpeed), profileUnit('io37', 'mph')],
    ['gnssSpeed', profileLabel('io24', 'GNSS speed'), profileValue('io24'), profileUnit('io24', 'mph')],
    ['controlVoltage', profileLabel('io51', 'Control voltage'), profileValue('io51'), profileUnit('io51', 'V')],
    ['satellites', profileLabel('sat', 'GNSS satellites'), profileValue('sat'), profileUnit('sat', 'count')],
    ['gnssStatus', profileLabel('io69', 'GNSS status'), profileValue('io69'), profileUnit('io69', '1 = fix OK')],
    ['signalStrength', profileLabel('rssi', 'GSM signal'), profileValue('rssi'), profileUnit('rssi', '0–5')],
    ['trackerBatteryLevel', profileLabel('io113', 'Tracker battery level'), profileValue('io113'), profileUnit('io113', '%')],
    ['batteryVoltage', profileLabel('battery', 'Tracker battery voltage'), profileValue('battery'), profileUnit('battery', 'V')],
    ['batteryCurrent', profileLabel('io68', 'Tracker battery current'), profileValue('io68'), profileUnit('io68', 'A')],
    ['fuelUsed', profileLabel('io12', 'Fuel used (trip)'), profileValue('io12'), profileUnit('io12', 'gal')],
    ['fuelRate', profileLabel('io13', 'Fuel rate'), profileValue('io13'), profileUnit('io13', 'gal/hr')],
    ['barometricPressure', profileLabel('io50', 'Barometric pressure'), profileValue('io50'), profileUnit('io50', 'kPa')],
    ['absoluteLoad', profileLabel('io52', 'Absolute load'), profileValue('io52'), profileUnit('io52', '%')],
    ['timingAdvance', profileLabel('io38', 'Timing advance'), profileValue('io38'), profileUnit('io38', 'deg')],
    ['ambientAir', profileLabel('io53', 'Ambient air temperature'), profileValue('io53'), profileUnit('io53', '°F')],
    ['motion', 'Motion', attrs.motion, ''],
    ['pdop', profileLabel('pdop', 'GNSS PDOP'), profileValue('pdop'), ''],
    ['hdop', profileLabel('hdop', 'GNSS HDOP'), profileValue('hdop'), ''],
    ['operator', profileLabel('operator', 'GSM operator'), profileValue('operator'), ''],
    ['fuelRailPressure', profileLabel('io45', 'Fuel rail pressure'), profileValue('io45'), profileUnit('io45', 'kPa')],
    ['accelerometerX', 'Accelerometer X', attrs.axisX, 'mg'],
    ['accelerometerY', 'Accelerometer Y', attrs.axisY, 'mg'],
    ['accelerometerZ', 'Accelerometer Z', attrs.axisZ, 'mg'],
    ['segmentDistance', profileLabel('distance', 'Segment distance'), profileValue('distance'), profileUnit('distance', 'mi')],
  ]
  const isKnown = (value) => value !== undefined && value !== null && value !== ''
  const visibleValues = values.filter(([key, , value]) => selectedFields.has(key) && isKnown(value))
  const known = visibleValues
  const ageMinutes = point ? Math.max(0, Math.round((Date.now() - point.timestamp.getTime()) / 60000)) : null
  const ignition = attrs.ignition ?? attrs.io239
  const compactTimestamp = point ? point.timestamp.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) : ''
  const connection = !point ? 'No data loaded' : ageMinutes <= 15 ? 'Recent data' : ageMinutes <= 60 ? 'Stale data' : compactTimestamp
  const active = ignition === true || ignition === 'true' || attrs.motion === true || attrs.motion === 'true'
  const currentRpm = attrs.io36 ?? attrs.rpm
  const lastRpmPoint = [...historyPoints].reverse().find((candidate) => {
    const candidateRpm = candidate.attributes?.io36 ?? candidate.attributes?.rpm
    return candidateRpm !== undefined && candidateRpm !== null && candidateRpm !== ''
  })
  const rpmGapMinutes = point && lastRpmPoint ? Math.max(0, (point.timestamp - lastRpmPoint.timestamp) / 60000) : null
  const rpmWarning = active && (currentRpm === undefined || currentRpm === null || currentRpm === '') && (!lastRpmPoint || rpmGapMinutes >= 5)
  const engineState = ignition === true || ignition === 'true' ? 'Running' : ignition === false || ignition === 'false' ? 'Off' : null
  const compactValue = (value, unit) => {
    if (!isKnown(value)) return `— ${unit}`
    const numeric = Number(value)
    const formatted = Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { maximumFractionDigits: 1 }) : value
    return `${formatted} ${unit}`
  }
  const compactTelemetry = [
    compactValue(profileValue('io36', attrs.rpm), 'rpm'),
    compactValue(profileValue('io41'), profileUnit('io41', '%')),
    compactValue(profileValue('io40'), profileUnit('io40', 'g/s')),
  ]
  const toggleCollapsed = () => setCollapsed((value) => !value)
  const handleCardClick = (event) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (event.target.closest('button, details, summary, input, select, textarea, a')) return
    toggleCollapsed()
  }
  return <div ref={panelRef} className={`vehicle-status-card${collapsed ? ' is-collapsed' : ''}`} style={style} onClick={handleCardClick} onKeyDown={(event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
      event.preventDefault()
      toggleCollapsed()
    }
  }} role="button" tabIndex={0} title={collapsed ? 'Click to expand vehicle status' : 'Click to collapse vehicle status'}>
    <div {...dragHandleProps}>
      <strong>{device.name}</strong>
      <span>{connection}</span>
      <button type="button" className="vehicle-status-toggle" onClick={toggleCollapsed} aria-expanded={!collapsed} title={collapsed ? 'Expand vehicle status' : 'Collapse vehicle status'}>{collapsed ? '＋' : '−'}</button>
    </div>
    {collapsed ? <div className="vehicle-status-compact-values" aria-label="RPM, throttle position, and mass air flow">{compactTelemetry.map((value, index) => <span key={index}>{value}</span>)}</div> : <>
      {visibleValues.length > 0 || (selectedFields.has('ignition') && engineState) ? <div className="vehicle-status-grid">{visibleValues.map(([, label, value, unit, convert]) => { const displayValue = convert ? Number(convert(value)).toFixed(1) : value; return <div key={label}><span>{label}</span><strong>{`${displayValue} ${unit}`}</strong></div> })}{selectedFields.has('ignition') && engineState && <div><span>Engine state</span><strong>{engineState}</strong></div>}</div> : null}
      {rpmWarning && <div className="vehicle-status-diagnostic">RPM has not been reported for {lastRpmPoint ? `${Math.round(rpmGapMinutes)} minutes` : 'the loaded history'} while the device appears active; unchanged RPM values are otherwise treated as valid.</div>}
      <details><summary>Other fields ({Object.keys(displayAttrs).length})</summary><pre>{JSON.stringify(displayAttrs, null, 2)}</pre></details>
      <small>{point ? `Point: ${point.timestamp.toLocaleString()} · ${ageMinutes} min old` : 'No point loaded'} · {known.length} known values</small>
    </>}
  </div>
}

export default VehicleStatusCard

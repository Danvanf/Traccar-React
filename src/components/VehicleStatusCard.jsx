import { isTelemetryPlaceholderValue } from '../lib/telemetry'
import { DEFAULT_STATUS_CARD_FIELDS } from '../lib/statusCardFields'

function VehicleStatusCard({ device, point, historyPoints = [], profile = null, cardFields = DEFAULT_STATUS_CARD_FIELDS }) {
  if (!device) {
    return (
      <div className="vehicle-status-card">
        <div className="vehicle-status-header"><strong>Vehicle Status</strong><span>No mapped vehicle</span></div>
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
  ]
  const isKnown = (value) => value !== undefined && value !== null && value !== ''
  const visibleValues = values.filter(([key, , value]) => selectedFields.has(key) && isKnown(value))
  const known = visibleValues
  const ageMinutes = point ? Math.max(0, Math.round((Date.now() - point.timestamp.getTime()) / 60000)) : null
  const ignition = attrs.ignition ?? attrs.io239
  const connection = !point ? 'No data loaded' : ageMinutes <= 15 ? 'Recent data' : ageMinutes <= 60 ? 'Stale data' : 'No recent data'
  const active = ignition === true || ignition === 'true' || attrs.motion === true || attrs.motion === 'true'
  const currentRpm = attrs.io36 ?? attrs.rpm
  const lastRpmPoint = [...historyPoints].reverse().find((candidate) => {
    const candidateRpm = candidate.attributes?.io36 ?? candidate.attributes?.rpm
    return candidateRpm !== undefined && candidateRpm !== null && candidateRpm !== ''
  })
  const rpmGapMinutes = point && lastRpmPoint ? Math.max(0, (point.timestamp - lastRpmPoint.timestamp) / 60000) : null
  const rpmWarning = active && (currentRpm === undefined || currentRpm === null || currentRpm === '') && (!lastRpmPoint || rpmGapMinutes >= 5)
  const engineState = ignition === true || ignition === 'true' ? 'Running' : ignition === false || ignition === 'false' ? 'Off' : null
  return <div className="vehicle-status-card"><div className="vehicle-status-header"><strong>{device.name}</strong><span>{connection}</span></div>{visibleValues.length > 0 || (selectedFields.has('ignition') && engineState) ? <div className="vehicle-status-grid">{visibleValues.map(([, label, value, unit, convert]) => { const displayValue = convert ? Number(convert(value)).toFixed(1) : value; return <div key={label}><span>{label}</span><strong>{`${displayValue} ${unit}`}</strong></div> })}{selectedFields.has('ignition') && engineState && <div><span>Engine state</span><strong>{engineState}</strong></div>}</div> : null}{rpmWarning && <div className="vehicle-status-diagnostic">RPM has not been reported for {lastRpmPoint ? `${Math.round(rpmGapMinutes)} minutes` : 'the loaded history'} while the device appears active; unchanged RPM values are otherwise treated as valid.</div>}<details><summary>Other fields ({Object.keys(displayAttrs).length})</summary><pre>{JSON.stringify(displayAttrs, null, 2)}</pre></details><small>{point ? `Point: ${point.timestamp.toLocaleString()} · ${ageMinutes} min old` : 'No point loaded'} · {known.length} known values</small></div>
}

export default VehicleStatusCard

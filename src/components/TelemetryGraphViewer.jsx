import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { hasMeaningfulTelemetryValue, isTelemetryPlaceholderValue } from '../lib/telemetry'

const SPEED_KEY = '__speedMph'

// Deliberately excluded from the graph for now. Keep this list explicit so
// future telemetry additions can be reviewed before becoming graph series.
const IGNORED_TELEMETRY_KEYS = new Set([
  'hours', 'engineHours',
  'event', 'eventId',
  'distance', 'segmentDistance',
  'odometer',
])

const IGNORED_TELEMETRY_LABELS = 'Engine/Ignition Hours, Event ID, Segment Distance, Teltonika Odometer'

function asPoint(value) {
  if (Array.isArray(value)) {
    const [, , metadata = {}] = value
    return { ...metadata, timestamp: metadata.timestamp instanceof Date ? metadata.timestamp : new Date(metadata.timestamp) }
  }
  return { ...value, timestamp: value.timestamp instanceof Date ? value.timestamp : new Date(value.timestamp) }
}

function numericValue(point, key, profile) {
  if (key === SPEED_KEY) {
    if (Number.isFinite(Number(point.speedMph))) return Number(point.speedMph)
    return Number.isFinite(Number(point.speed)) ? Number(point.speed) * 1.150779 : null
  }
  const raw = point.attributes?.[key]
  if (raw === undefined || raw === null || raw === '' || typeof raw === 'boolean') return null
  const decoded = profile?.decodeAttributeValue(key, raw) ?? raw
  const number = Number(decoded)
  return Number.isFinite(number) ? number : null
}

function labelFor(key, profile) {
  if (key === SPEED_KEY) return 'Speed (mph)'
  return profile?.getAttributeHeader(key)?.replace(/\s*\[attr_[^\]]+\]$/, '') || key
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return ''
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2)
}

function formatElapsedMinutes(value) {
  if (!Number.isFinite(value)) return '0 min'
  return `${Math.round(Math.max(0, value))} min`
}

function TelemetryGraphViewer({ groups, profile = null, title = 'Telemetry Graph', onClose }) {
  const points = useMemo(() => groups.flatMap((group) => group.points.map(asPoint)).filter((point) => !Number.isNaN(point.timestamp?.getTime?.())).sort((a, b) => a.timestamp - b.timestamp), [groups])
  const availableKeys = useMemo(() => {
    const keys = new Set()
    groups.forEach((group) => group.points.forEach((value) => {
      const point = asPoint(value)
      Object.keys(point.attributes || {}).forEach((key) => keys.add(key))
      if (Number.isFinite(Number(point.speedMph)) || Number.isFinite(Number(point.speed))) keys.add(SPEED_KEY)
    }))
    return [...keys].filter((key) => {
      if (IGNORED_TELEMETRY_KEYS.has(key)) return false
      const values = points.map((point) => numericValue(point, key, profile)).filter((value) => value !== null)
      return hasMeaningfulTelemetryValue(values, key, profile)
    }).sort((a, b) => labelFor(a, profile).localeCompare(labelFor(b, profile)))
  }, [groups, points, profile])
  const [selectedKeys, setSelectedKeys] = useState([])
  const [independentScale, setIndependentScale] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [viewRange, setViewRange] = useState({ start: 0, end: 1 })
  const [dragRange, setDragRange] = useState(null)
  const plotWrapRef = useRef(null)
  const pendingScrollRatio = useRef(null)
  const preferenceKey = `traccarTelemetryGraphSeries:${profile?.id || profile?.name || 'default'}`
  const loadedPreferenceKey = useRef('')

  useEffect(() => {
    if (loadedPreferenceKey.current !== preferenceKey) {
      let saved = []
      try {
        const parsed = JSON.parse(localStorage.getItem(preferenceKey) || '[]')
        if (Array.isArray(parsed)) saved = parsed
      } catch { /* use defaults when browser storage is unavailable */ }
      setSelectedKeys(saved.filter((key) => availableKeys.includes(key)).slice(0, 12))
      loadedPreferenceKey.current = preferenceKey
      return
    }
    setSelectedKeys((current) => {
      if (current.length === 0) return availableKeys.slice(0, 3)
      return current.filter((key) => availableKeys.includes(key))
    })
  }, [availableKeys, preferenceKey])

  useEffect(() => {
    if (loadedPreferenceKey.current !== preferenceKey) return
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(selectedKeys))
    } catch { /* browser storage is optional */ }
  }, [preferenceKey, selectedKeys])

  useEffect(() => {
    setViewRange({ start: 0, end: 1 })
    setDragRange(null)
    pendingScrollRatio.current = null
  }, [groups])

  useLayoutEffect(() => {
    const ratio = pendingScrollRatio.current
    const wrapper = plotWrapRef.current
    if (ratio == null || !wrapper) return
    const scrollableWidth = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth)
    const target = left + ratio * innerWidth
    wrapper.scrollLeft = Math.max(0, Math.min(scrollableWidth, target - 30))
    pendingScrollRatio.current = null
  }, [zoom])

  const series = useMemo(() => selectedKeys.map((key, index) => {
    const values = points.map((point) => numericValue(point, key, profile))
    const finite = values.filter((value) => Number.isFinite(value))
    if (finite.length === 0) return null
    return { key, color: ['#35b7aa', '#f6bd60', '#9b5de5', '#ef476f', '#5dade2', '#8bd450'][index % 6], values, min: Math.min(...finite), max: Math.max(...finite) }
  }).filter(Boolean), [points, profile, selectedKeys])

  const globalMin = Math.min(...series.flatMap((item) => [item.min]), 0)
  const globalMax = Math.max(...series.flatMap((item) => [item.max]), 1)
  const chartWidth = 1070 * zoom
  const chartHeight = 420
  const left = 52
  const right = 18
  const top = 20
  const bottom = 34
  const innerWidth = chartWidth - left - right
  const innerHeight = chartHeight - top - bottom
  const visibleSpan = Math.max(.0001, viewRange.end - viewRange.start)
  const totalDurationMinutes = points.length > 1
    ? Math.max(0, (points.at(-1).timestamp - points[0].timestamp) / 60000)
    : 0
  const xFor = (index) => left + (points.length <= 1 ? 0 : ((index / (points.length - 1) - viewRange.start) / visibleSpan) * innerWidth)
  const plotRatioFromPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - rect.left) / rect.width) * chartWidth
    return Math.max(0, Math.min(1, (svgX - left) / innerWidth))
  }
  const beginDrag = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const ratio = plotRatioFromPointer(event)
    setDragRange({ start: ratio, current: ratio })
  }
  const updateDrag = (event) => {
    if (!dragRange) return
    // Read the native event before entering the functional state updater;
    // React clears currentTarget after the handler returns.
    const ratio = plotRatioFromPointer(event)
    setDragRange((current) => current ? { ...current, current: ratio } : null)
  }
  const finishDrag = (event) => {
    if (!dragRange) return
    const current = plotRatioFromPointer(event)
    const startRatio = Math.min(dragRange.start, current)
    const endRatio = Math.max(dragRange.start, current)
    if (endRatio - startRatio > .03) {
      const selectedSpan = endRatio - startRatio
      // Keep the complete original timeline as the scrollable domain. The
      // brush controls magnification; it must not crop away earlier points.
      pendingScrollRatio.current = viewRange.start + startRatio * visibleSpan
      setViewRange({ start: 0, end: 1 })
      setZoom((current) => Math.min(4, Math.max(.75, current / selectedSpan)))
    }
    setDragRange(null)
  }
  const resetView = () => {
    setZoom(1)
    setViewRange({ start: 0, end: 1 })
    setDragRange(null)
    pendingScrollRatio.current = null
    if (plotWrapRef.current) plotWrapRef.current.scrollLeft = 0
  }
  const yFor = (value, item) => {
    const min = independentScale ? item.min : globalMin
    const max = independentScale ? item.max : globalMax
    const ratio = max === min ? 0.5 : (value - min) / (max - min)
    return top + innerHeight - Math.max(0, Math.min(1, ratio)) * innerHeight
  }
  const pointIndexByTimestamp = new Map(points.map((point, index) => [`${point.timestamp.getTime()}|${point.deviceId || ''}`, index]))

  return <div className="telemetry-graph-modal" role="dialog" aria-modal="true" aria-label={title}>
    <div className="telemetry-graph-card">
      <div className="telemetry-graph-header"><div><h2>{title}</h2><small>{points.length} data points · drag across the plot to zoom · double-click to reset</small></div><div className="telemetry-graph-header-actions"><div className="telemetry-graph-zoom" aria-label="Graph zoom controls"><button type="button" className="small secondary" onClick={() => setZoom((current) => Math.max(.75, current - .25))} disabled={zoom <= .75} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button type="button" className="small secondary" onClick={() => setZoom((current) => Math.min(4, current + .25))} disabled={zoom >= 4} aria-label="Zoom in">+</button><button type="button" className="small secondary" onClick={resetView} disabled={zoom === 1 && viewRange.start === 0 && viewRange.end === 1}>Reset</button></div><label className="telemetry-scale-switch"><span>Scale lines independently</span><input type="checkbox" role="switch" checked={independentScale} onChange={(event) => setIndependentScale(event.target.checked)} /><i /></label><button type="button" className="small secondary" onClick={onClose}>Close</button></div></div>
      <div className="telemetry-graph-plot-wrap" ref={plotWrapRef}>{series.length === 0 ? <div className="trip-empty">Select one or more numeric data elements to draw the graph.</div> : <><svg className="telemetry-graph-plot" width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Selected telemetry over time" onDoubleClick={resetView}><line x1={left} x2={left} y1={top} y2={top + innerHeight} stroke="currentColor" opacity=".5" /><line x1={left} x2={left + innerWidth} y1={top + innerHeight} y2={top + innerHeight} stroke="currentColor" opacity=".5" />{[0, .25, .5, .75, 1].map((ratio) => <g key={ratio}><line x1={left} x2={left + innerWidth} y1={top + innerHeight - ratio * innerHeight} y2={top + innerHeight - ratio * innerHeight} stroke="currentColor" opacity=".12" /></g>)}{[0, .25, .5, .75, 1].map((ratio) => <g key={`time-${ratio}`}><line x1={left + ratio * innerWidth} x2={left + ratio * innerWidth} y1={top + innerHeight} y2={top + innerHeight + 6} stroke="currentColor" opacity=".7" /><text x={left + ratio * innerWidth} y={top + innerHeight + 22} textAnchor="middle" fontSize="11" fill="currentColor">{formatElapsedMinutes((viewRange.start + ratio * visibleSpan) * totalDurationMinutes)}</text></g>)}{groups.slice(0, -1).map((group, groupIndex) => { const last = group.points.at(-1); const point = last ? asPoint(last) : null; const index = point ? pointIndexByTimestamp.get(`${point.timestamp.getTime()}|${point.deviceId || ''}`) : null; return index == null ? null : <line key={`separator-${groupIndex}`} x1={xFor(index)} x2={xFor(index)} y1={top} y2={top + innerHeight} stroke="#ffffff" strokeDasharray="4 4" opacity=".5" /> })}{series.map((item) => { const path = item.values.map((value, index) => Number.isFinite(value) ? `${index === 0 ? 'M' : 'L'} ${xFor(index)} ${yFor(value, item)}` : '').filter(Boolean).join(' '); return <path key={item.key} d={path} fill="none" stroke={item.color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /> })}{dragRange && <rect className="telemetry-graph-selection" x={left + Math.min(dragRange.start, dragRange.current) * innerWidth} y={top} width={Math.abs(dragRange.current - dragRange.start) * innerWidth} height={innerHeight} />}{<rect className="telemetry-graph-brush" x={left} y={top} width={innerWidth} height={innerHeight} onPointerDown={beginDrag} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={() => setDragRange(null)} />}</svg><div className="telemetry-graph-y-axis" aria-hidden="true">{[1, .75, .5, .25, 0].map((ratio) => <span key={ratio}>{independentScale ? `${Math.round(ratio * 100)}%` : formatNumber(globalMin + (globalMax - globalMin) * ratio)}</span>)}</div></>}</div>
      <div className="telemetry-graph-legend">{series.map((item) => <span key={item.key} style={{ '--series-color': item.color }}><i />{labelFor(item.key, profile)}: {formatNumber(item.min)}–{formatNumber(item.max)}{independentScale ? ' (normalized)' : ''}<button type="button" className="telemetry-legend-remove" title={`Remove ${labelFor(item.key, profile)}`} aria-label={`Remove ${labelFor(item.key, profile)} from graph`} onClick={() => setSelectedKeys((current) => current.filter((key) => key !== item.key))}>×</button></span>)}</div>
      <div className="telemetry-graph-controls"><strong>Data elements</strong><small className="telemetry-graph-ignored">Ignored for now: {IGNORED_TELEMETRY_LABELS}</small>{availableKeys.length === 0 && <span className="trip-empty">No numeric telemetry is available for this selection.</span>}{availableKeys.map((key) => <label key={key} className="checkbox-row"><input type="checkbox" checked={selectedKeys.includes(key)} onChange={() => setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} /><span>{labelFor(key, profile)}</span></label>)}</div>
    </div>
  </div>
}

export default TelemetryGraphViewer

import { useCallback, useEffect, useRef } from 'react'
import { formatDistance } from '../lib/format'
import PanelResizeHandle from './PanelResizeHandle'

function GraphIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 19V5M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></svg>
}

function TripPanel({
  visibleTrips,
  selectedDayKey,
  selectedDayKeys = [],
  devices,
  selectedTripId,
  focusTrip,
  selectedTrip,
  selectedTripMaxSpeedMph,
  displayUnits = 'imperial',
  tripEditorLoading,
  tripEditorDisabled,
  tripEditorStatus,
  tripEditorTags,
  availableTripTags,
  tagToAdd,
  setTagToAdd,
  addSelectedTripTag,
  removeSelectedTripTag,
  noteDraft,
  setNoteDraft,
  saveSelectedTripNote,
  openTripGraph,
  floatingRef,
  style,
  position,
  onPositionChange,
  onPositionCommit,
  onHide,
  panelHeight,
  onPanelHeightChange,
  onPanelHeightCommit,
}) {
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const setPanelRef = useCallback((node) => {
    panelRef.current = node
    if (typeof floatingRef === 'function') floatingRef(node)
    else if (floatingRef) floatingRef.current = node
  }, [floatingRef])

  const clampPosition = useCallback((left, top) => {
    const panel = panelRef.current
    const width = panel?.offsetWidth || 300
    const height = panel?.offsetHeight || 120
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
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      position: { left: rect.left, top: rect.top },
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [])

  const dragPanel = useCallback((event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    const next = clampPosition(
      event.clientX - dragRef.current.offsetX,
      event.clientY - dragRef.current.offsetY,
    )
    dragRef.current.position = next
    onPositionChange(next)
  }, [clampPosition, onPositionChange])

  const stopDragging = useCallback((event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    const next = dragRef.current.position
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    onPositionCommit(next)
  }, [onPositionCommit])

  const filteredTrips = visibleTrips.filter((trip) => {
    if (!selectedDayKey && selectedDayKeys.length === 0) return true
    const date = trip.start
    const localKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return selectedDayKeys.includes(localKey) || localKey === selectedDayKey
  })
  return (
    <div ref={setPanelRef} className="trip-panel trip-panel-flyout" style={{ ...style, height: 'auto', maxHeight: panelHeight ? `${panelHeight}px` : '70vh' }}>
      <div
        className="trip-panel-heading trip-panel-drag-handle"
        title="Drag to move Trips panel"
        onPointerDown={startDragging}
        onPointerMove={dragPanel}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      ><h2>Trips ({filteredTrips.length})</h2><button type="button" className="small secondary" onClick={onHide} title="Hide Trips panel">×</button></div>
      <div className="trip-list">
        {filteredTrips.slice(0, 60).map((trip) => {
          const deviceName = trip.vehicleName || devices.find((device) => device.id === trip.deviceId)?.name || `Device ${trip.deviceId}`
          return (
            <div key={trip.tripId} className="trip-item-row">
              <button
                type="button"
                className={`trip-item ${selectedTripId === trip.tripId ? 'active' : ''}`}
                onClick={() => focusTrip(trip)}
              >
                <div className="trip-main">{deviceName}</div>
                <div className="trip-meta">
                  <span>{trip.start.toLocaleString()} - {trip.end.toLocaleTimeString()}</span>
                  <span>{Math.round((trip.end - trip.start) / 60000)} min | {formatDistance(trip.distance, displayUnits)} | {Math.round((trip.maxSpeedMph ?? 0) * (displayUnits === 'metric' ? 1.609344 : 1))} {displayUnits === 'metric' ? 'km/h' : 'mph'} | {Math.round(trip.eventCount ?? 0)} events</span>
                </div>
              </button>
              <button type="button" className="trip-graph-button" onClick={() => openTripGraph(trip)} title="Graph this trip" aria-label={`Graph trip for ${trip.start.toLocaleString()}`}><GraphIcon /></button>
            </div>
          )
        })}
        {filteredTrips.length === 0 && <div className="trip-empty">No trips in the selected filter.</div>}
      </div>

      {selectedTrip && (
        <div className="trip-editor">
          <div className="trip-editor-meta">
            {selectedTrip.start.toLocaleString()} - {selectedTrip.end.toLocaleTimeString()}
            {Number.isFinite(selectedTripMaxSpeedMph) && ` · Max: ${(selectedTripMaxSpeedMph * (displayUnits === 'metric' ? 1.609344 : 1)).toFixed(1)} ${displayUnits === 'metric' ? 'km/h' : 'mph'}`}
          </div>
          {tripEditorLoading && <div className="trip-empty">Loading trip metadata...</div>}
          {tripEditorStatus && <div className="trip-empty">{tripEditorStatus}</div>}

          {!tripEditorLoading && (
            <>
              <label>
                Add Tag
                <div className="trip-editor-tag-row">
                  <select disabled={tripEditorDisabled} value={tagToAdd} onChange={(event) => setTagToAdd(event.target.value)}>
                    <option value="">Select tag</option>
                    {availableTripTags.map((tag) => (
                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                    ))}
                  </select>
                  <button type="button" className="small secondary" onClick={addSelectedTripTag} disabled={tripEditorDisabled || !tagToAdd}>Add</button>
                </div>
              </label>

              {tripEditorTags.length > 0 && (
                <div className="trip-editor-tags">
                  {tripEditorTags.map((tag) => (
                    <button key={tag.id} type="button" className="trip-tag-chip" onClick={() => removeSelectedTripTag(tag.id)} disabled={tripEditorDisabled}>
                      {tag.name} ×
                    </button>
                  ))}
                </div>
              )}

              <label>
                Trip Notes
                <textarea
                  disabled={tripEditorDisabled}
                  rows={3}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Add contextual notes for this trip"
                />
              </label>
              <button type="button" className="small" onClick={saveSelectedTripNote} disabled={tripEditorDisabled}>Save Notes</button>
            </>
          )}
        </div>
      )}
      <PanelResizeHandle panelRef={panelRef} minHeight={120} sizeMode="max-height" onHeightChange={onPanelHeightChange} onHeightCommit={onPanelHeightCommit} />
    </div>
  )
}

export default TripPanel

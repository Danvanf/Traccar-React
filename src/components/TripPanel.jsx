import { formatDistance } from '../lib/format'
import { formatEventMeasurement } from '../lib/tripEvents'

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
  tripEditorLoading,
  tripEditorDisabled,
  tripEditorStatus,
  tripEditorTags,
  selectedTripEvents = [],
  focusTripEvent,
  availableTripTags,
  tagToAdd,
  setTagToAdd,
  addSelectedTripTag,
  removeSelectedTripTag,
  noteDraft,
  setNoteDraft,
  saveSelectedTripNote,
  recalculateSelectedTrip,
  openTripGraph,
}) {
  const filteredTrips = visibleTrips.filter((trip) => {
    if (!selectedDayKey && selectedDayKeys.length === 0) return true
    const date = trip.start
    const localKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return selectedDayKeys.includes(localKey) || localKey === selectedDayKey
  })
  return (
    <div className="trip-panel">
      <h2>Trips ({filteredTrips.length})</h2>
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
                  <span>{Math.round((trip.end - trip.start) / 60000)} min | {formatDistance(trip.distance)} | {Math.round(trip.maxSpeedMph ?? 0)} mph | {Math.round(trip.eventCount ?? 0)} events</span>
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
          <div className="trip-editor-heading"><h3>Selected Trip</h3><button type="button" className="trip-graph-button" onClick={() => openTripGraph(selectedTrip)} title="Graph this trip" aria-label="Graph selected trip"><GraphIcon /></button></div>
          <div className="trip-editor-meta">
            {selectedTrip.start.toLocaleString()} - {selectedTrip.end.toLocaleTimeString()}
          </div>
          {Number.isFinite(selectedTripMaxSpeedMph) && (
            <div className="trip-editor-meta">Trip maximum speed: {selectedTripMaxSpeedMph.toFixed(1)} mph</div>
          )}
          {selectedTripEvents.length > 0 && (
            <div className="trip-events-summary">
              <strong>Detected events</strong>
              {selectedTripEvents.map((event) => (
                <button key={event.id} type="button" className="trip-event-link" onClick={() => focusTripEvent(event)}>
                  {event.eventType.replaceAll('_', ' ')} · {event.source} · {new Date(event.occurredAt).toLocaleTimeString()}{event.measuredValue == null ? '' : ` · ${formatEventMeasurement(event)}`}
                </button>
              ))}
            </div>
          )}

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
              <button type="button" className="small secondary" onClick={recalculateSelectedTrip} disabled={tripEditorDisabled}>
                Recalculate Metrics
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default TripPanel

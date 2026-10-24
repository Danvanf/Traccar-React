import { formatDistance } from '../lib/format'

export function filterTripsForSelectedDays(visibleTrips, selectedDayKey, selectedDayKeys) {
  if (!selectedDayKey && selectedDayKeys.length === 0) return visibleTrips
  return visibleTrips.filter((trip) => {
    const date = trip.start
    const localKey = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
    return selectedDayKeys.includes(localKey) || localKey === selectedDayKey
  })
}

function GraphIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 19V5M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></svg>
}

function TripContent({
  selectionMode = false,
  isTripSelected = () => false,
  onToggleTrip,
  visibleTrips,
  selectedDayKey,
  selectedDayKeys = [],
  devices,
  selectedTripId,
  focusTrip,
  displayUnits = 'imperial',
  tripEditor = null,
  openTripGraph,
}) {
  const filteredTrips = filterTripsForSelectedDays(visibleTrips, selectedDayKey, selectedDayKeys)
  const speedFactor = displayUnits === 'metric' ? 1.609344 : 1
  const speedUnit = displayUnits === 'metric' ? 'km/h' : 'mph'

  return <>
    <div className="trip-list">
      {filteredTrips.slice(0, 60).map((trip) => {
        const deviceName = trip.vehicleName || devices.find((device) => device.id === trip.deviceId)?.name || 'Device ' + trip.deviceId
        const tripLabel = 'Graph trip for ' + trip.start.toLocaleString()
        return (
          <div key={trip.tripId} className="trip-item-row">
            {selectionMode && <input type="checkbox" aria-label={`Select trip ${trip.start.toLocaleString()}`} checked={isTripSelected(trip)} onChange={() => onToggleTrip(trip)} />}
            <button
              type="button"
              className={'trip-item ' + (selectedTripId === trip.tripId ? 'active' : '')}
              onClick={() => focusTrip(trip)}
            >
              <div className="trip-main">
                <span>{deviceName}</span>
                <span className="trip-mobile-time-range">{trip.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} - {trip.end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              <div className="trip-meta">
                <span className="trip-date-range">{trip.start.toLocaleString()} - {trip.end.toLocaleTimeString()}</span>
                <span>{Math.round((trip.end - trip.start) / 60000)} min | {formatDistance(trip.distance, displayUnits)} | {Math.round((trip.maxSpeedMph ?? 0) * speedFactor)} {speedUnit} | {Math.round(trip.eventCount ?? 0)} events</span>
              </div>
            </button>
            <button type="button" className="trip-graph-button" onClick={() => openTripGraph(trip)} title="Graph this trip" aria-label={tripLabel}><GraphIcon /></button>
          </div>
        )
      })}
      {filteredTrips.length === 0 && <div className="trip-empty">No trips in the selected filter.</div>}
    </div>
    {tripEditor}
  </>
}

export default TripContent

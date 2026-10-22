import { useEffect, useRef } from 'react'
import { formatEventMeasurement } from '../lib/tripEvents'
import PanelResizeHandle from './PanelResizeHandle'

function eventLabel(value) {
  return String(value || 'event').replaceAll('_', ' ')
}

function NotificationsPanel({ notifications = [], selectedTripEvents = [], onSelectTripEvent, loading = false, error = '', onRetry, rangeLabel = 'Current selection', floating = false, embedded = false, displayUnits = 'imperial', onFloat, height, onHeightChange, onHeightCommit }) {
  const panelRef = useRef(null)
  const selectedEventIds = new Set(selectedTripEvents.map((event) => String(event.id)))
  const otherNotifications = notifications.filter((notification) => !selectedEventIds.has(String(notification.id)))
  const visibleCount = selectedTripEvents.length + otherNotifications.length
  const panelStyle = embedded
    ? { height: 'auto', minHeight: 0, maxHeight: 'none' }
    : height
      ? { height: floating ? '100%' : `${height}px`, minHeight: 0, maxHeight: 'none' }
      : undefined
  useEffect(() => {
    if (embedded) return undefined
    if (visibleCount > 0 && height && height < 140) {
      onHeightChange?.(140)
      onHeightCommit?.(140)
    }
  }, [embedded, height, visibleCount, onHeightChange, onHeightCommit])
  return (
    <section ref={panelRef} className={`notifications-panel${floating ? ' floating-notifications-content' : ''}`} style={panelStyle}>
      <div className={`notifications-header${floating ? ' floating-panel-handle' : ''}`}>
        <div><h2>Notifications</h2><p>Stored trip events · {rangeLabel}</p></div>
        <div className="panel-header-actions"><span className="notifications-count">{visibleCount}</span>{!floating && !embedded && <button type="button" className="small secondary" onClick={onFloat} title="Float Notifications panel" aria-label="Float Notifications">↗</button>}</div>
      </div>
      {loading && <div className="notifications-empty">Loading notifications…</div>}
      {!loading && error && <div className="notifications-empty">
        <p className="error" role="status">Could not load notifications: {error}</p>
        {onRetry && <button type="button" className="secondary" onClick={onRetry}>Retry notifications</button>}
      </div>}
      {!loading && !error && visibleCount === 0 && <div className="notifications-empty">No stored events in this range.</div>}
      {!loading && visibleCount > 0 && (
        <div className="notifications-list">
          {selectedTripEvents.length > 0 && (
            <div className="trip-events-summary">
              <strong>Selected trip · Detected events</strong>
              {selectedTripEvents.map((event) => (
                <button key={event.id} type="button" className="trip-event-link" onClick={() => onSelectTripEvent?.(event)}>
                  {eventLabel(event.eventType)} · {event.source} · {new Date(event.occurredAt).toLocaleTimeString()}{event.measuredValue == null ? '' : ` · ${formatEventMeasurement(event, displayUnits)}`}
                </button>
              ))}
            </div>
          )}
          {otherNotifications.slice(0, 80).map((notification) => {
            const measurement = notification.measuredValue == null ? '' : ` · ${formatEventMeasurement(notification, displayUnits)}`
            return (
              <div className="notification-item" key={notification.id}>
                <div className="notification-main"><strong>{eventLabel(notification.eventType)}</strong><span className="notification-source">{notification.source}</span></div>
                <div className="notification-meta">{notification.vehicleName} · {new Date(notification.occurredAt).toLocaleString()}{measurement}</div>
              </div>
            )
          })}
        </div>
      )}
      <PanelResizeHandle panelRef={panelRef} floating={floating || embedded} minHeight={visibleCount > 0 ? 140 : 72} onHeightChange={onHeightChange} onHeightCommit={onHeightCommit} />
    </section>
  )
}

export default NotificationsPanel

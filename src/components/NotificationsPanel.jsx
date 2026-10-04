import { formatEventMeasurement } from '../lib/tripEvents'

function eventLabel(value) {
  return String(value || 'event').replaceAll('_', ' ')
}

function NotificationsPanel({ notifications = [], loading = false, rangeLabel = 'Current selection' }) {
  return (
    <section className="notifications-panel">
      <div className="notifications-header">
        <div><h2>Notifications</h2><p>Stored trip events · {rangeLabel}</p></div>
        <span className="notifications-count">{notifications.length}</span>
      </div>
      {loading && <div className="notifications-empty">Loading notifications…</div>}
      {!loading && notifications.length === 0 && <div className="notifications-empty">No stored events in this range.</div>}
      {!loading && notifications.length > 0 && (
        <div className="notifications-list">
          {notifications.slice(0, 80).map((notification) => {
            const measurement = notification.measuredValue == null ? '' : ` · ${formatEventMeasurement(notification)}`
            return (
              <div className="notification-item" key={notification.id}>
                <div className="notification-main"><strong>{eventLabel(notification.eventType)}</strong><span className="notification-source">{notification.source}</span></div>
                <div className="notification-meta">{notification.vehicleName} · {new Date(notification.occurredAt).toLocaleString()}{measurement}</div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default NotificationsPanel

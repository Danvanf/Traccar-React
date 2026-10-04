function StatusCard({ status, sessionState, error }) {
  return (
    <div className="status-card">
      <div><strong>Status:</strong> {status}</div>
      <div className="status-line">Traccar API: {sessionState}</div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}

export default StatusCard

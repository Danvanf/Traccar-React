function StatusCard({ status, activeRangeLabel, sessionState, error }) {
  return (
    <div className="status-card">
      <div><strong>Status:</strong> {status}</div>
      {activeRangeLabel && <div className="status-line">{activeRangeLabel}</div>}
      <div className="status-line">Session: {sessionState}</div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}

export default StatusCard

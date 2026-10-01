function DayPanel({ daySummaries, selectedDayKey, setSelectedDayKey }) {
  if (daySummaries.length === 0) {
    return null
  }

  return (
    <div className="day-panel">
      <div className="day-panel-header">
        <h2>Days</h2>
        {selectedDayKey && (
          <button type="button" className="small" onClick={() => setSelectedDayKey(null)}>
            Clear
          </button>
        )}
      </div>
      <div className="day-list">
        {daySummaries.map((day) => (
          <button
            key={day.dayKey}
            type="button"
            className={`day-chip ${selectedDayKey === day.dayKey ? 'active' : ''}`}
            onClick={() => setSelectedDayKey(day.dayKey)}
          >
            <span>{day.dayKey}</span>
            <span>{day.tripCount} trips</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default DayPanel

import { useState } from 'react'

function monthLabel(dayKey) {
  const date = new Date(`${dayKey}T12:00:00`)
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function HistoryNavigator({ daySummaries, selectedDayKey, selectedDayKeys = [], setSelectedDayKey, refreshHistory, loadMonth, onReportDays }) {
  const [selectionMode, setSelectionMode] = useState(false)
  const groups = daySummaries.reduce((months, day) => {
    const month = day.dayKey.slice(0, 7)
    const current = months.get(month) || []
    current.push(day)
    months.set(month, current)
    return months
  }, new Map())

  if (daySummaries.length === 0) {
    return <section className="history-navigator"><div className="history-navigator-header"><h2>History</h2><button type="button" className="small secondary" onClick={refreshHistory}>Refresh</button></div><div className="history-empty">No activity in the current history window.</div></section>
  }

  return (
    <section className="history-navigator">
      <div className="history-navigator-header">
        <div><h2>History</h2><p>Recent days</p></div>
        <button type="button" className="small secondary" onClick={refreshHistory} title="Refresh history">↻</button>
      </div>
        <div className="history-selection-tools">
        <button type="button" className={`small secondary ${selectionMode ? 'active' : ''}`} onClick={() => setSelectionMode((value) => !value)}>{selectionMode ? 'Done' : 'Select days'}</button>
        <button type="button" className="small secondary" onClick={onReportDays} disabled={!selectedDayKey && selectedDayKeys.length === 0}>Graph selected days</button>
      </div>
      <div className="history-month-list">
        {[...groups.entries()].map(([month, days]) => {
          const expanded = days.some((day) => day.dayKey === selectedDayKey) || month === daySummaries[0].dayKey.slice(0, 7)
          return (
            <details key={month} open={expanded} onToggle={(event) => { if (event.currentTarget.open) loadMonth?.(month) }}>
              <summary>{monthLabel(`${month}-01`)} <span>{days.length} days</span></summary>
              <div className="history-day-list">
                {days.map((day) => (
                  <button key={day.dayKey} type="button" className={`history-day ${selectedDayKeys.includes(day.dayKey) || selectedDayKey === day.dayKey ? 'active' : ''}`} onClick={(event) => setSelectedDayKey(day.dayKey, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, toggle: selectionMode })}>
                    <span className="history-day-date"><strong>{new Date(`${day.dayKey}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</strong><small>{new Date(`${day.dayKey}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span>
                    <span className="history-day-summary"><span>{day.tripCount} trips, {Math.round((day.distanceM || 0) / 1609.344)} mi, {Math.round((day.durationSeconds || 0) / 60)} min</span><span>{Math.round(day.maxSpeedMph || 0)} mph, {Math.round(day.eventCount || 0)} events</span></span>
                  </button>
                ))}
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}

export default HistoryNavigator

import { useEffect, useMemo, useState } from 'react'

function monthLabel(dayKey) {
  const date = new Date(`${dayKey}T12:00:00`)
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function monthStatusLabel(status, dayCount, monthSummary) {
  if (monthSummary?.activeDayCount >= 0) return `${monthSummary.activeDayCount} day${monthSummary.activeDayCount === 1 ? '' : 's'}`
  if (status === 'loading') return 'loading...'
  if (status === 'empty') return '0 days'
  if (dayCount > 0) return `${dayCount} day${dayCount === 1 ? '' : 's'}`
  if (status === 'error') return 'retry load'
  return 'not loaded'
}

function HistoryNavigator({
  daySummaries,
  monthKeys = [],
  monthSummaryByKey = {},
  monthLoadState = {},
  selectedDayKey,
  selectedDayKeys = [],
  setSelectedDayKey,
  refreshHistory,
  loadMonth,
  onReportDays,
}) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [expandedYears, setExpandedYears] = useState({})
  const [expandedMonths, setExpandedMonths] = useState({})

  const dayGroups = useMemo(() => daySummaries.reduce((months, day) => {
    const month = day.dayKey.slice(0, 7)
    const current = months.get(month) || []
    current.push(day)
    months.set(month, current)
    return months
  }, new Map()), [daySummaries])

  const effectiveMonthKeys = useMemo(() => {
    if (monthKeys.length > 0) return monthKeys
    return [...dayGroups.keys()].sort((a, b) => b.localeCompare(a))
  }, [dayGroups, monthKeys])

  const yearGroups = useMemo(() => {
    return effectiveMonthKeys.reduce((years, monthKey) => {
      const year = monthKey.slice(0, 4)
      const current = years.get(year) || []
      current.push(monthKey)
      years.set(year, current)
      return years
    }, new Map())
  }, [effectiveMonthKeys])

  const useYearView = effectiveMonthKeys.length >= 12

  useEffect(() => {
    if (effectiveMonthKeys.length === 0) return
    const currentYear = String(new Date().getFullYear())
    const now = new Date()
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const previousMonthKey = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`
    const defaultMonthKeys = [thisMonthKey, previousMonthKey].filter((monthKey) => effectiveMonthKeys.includes(monthKey))
    const fallbackMonthKey = effectiveMonthKeys[0]
    const monthKeysToExpand = defaultMonthKeys.length > 0 ? defaultMonthKeys : [fallbackMonthKey]

    setExpandedMonths((state) => {
      const next = { ...state }
      let changed = false
      monthKeysToExpand.forEach((monthKey) => {
        if (!next[monthKey]) {
          next[monthKey] = true
          changed = true
        }
      })
      return changed ? next : state
    })

    const yearsToExpand = new Set(monthKeysToExpand.map((monthKey) => monthKey.slice(0, 4)))
    if (yearsToExpand.size === 0) {
      yearsToExpand.add(yearGroups.has(currentYear) ? currentYear : fallbackMonthKey.slice(0, 4))
    }

    setExpandedYears((state) => {
      const next = { ...state }
      let changed = false
      yearsToExpand.forEach((year) => {
        if (!next[year]) {
          next[year] = true
          changed = true
        }
      })
      return changed ? next : state
    })
  }, [effectiveMonthKeys, yearGroups])

  if (effectiveMonthKeys.length === 0) {
    return <section className="history-navigator"><div className="history-navigator-header"><h2>History</h2><button type="button" className="small secondary" onClick={refreshHistory}>Refresh</button></div><div className="history-empty">No activity in the current history window.</div></section>
  }

  const renderMonth = (monthKey) => {
    const days = dayGroups.get(monthKey) || []
    const status = monthLoadState[monthKey] || 'idle'
    const monthSummary = monthSummaryByKey[monthKey] || null
    const containsSelectedDay = days.some((day) => day.dayKey === selectedDayKey)
    const expanded = expandedMonths[monthKey] || containsSelectedDay
    return (
      <details
        key={monthKey}
        open={expanded}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open
          setExpandedMonths((previous) => ({ ...previous, [monthKey]: nextOpen }))
          if (nextOpen && (status === 'idle' || status === 'error')) {
            loadMonth?.(monthKey)
          }
        }}
      >
        <summary>{monthLabel(`${monthKey}-01`)} <span>{monthStatusLabel(status, days.length, monthSummary)}</span></summary>
        <div className="history-day-list">
          {days.length > 0 ? days.map((day) => (
            <button key={day.dayKey} type="button" className={`history-day ${selectedDayKeys.includes(day.dayKey) || selectedDayKey === day.dayKey ? 'active' : ''}`} onClick={(event) => setSelectedDayKey(day.dayKey, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, toggle: selectionMode })}>
              <span className="history-day-date"><strong>{new Date(`${day.dayKey}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</strong><small>{new Date(`${day.dayKey}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span>
              <span className="history-day-summary"><span>{day.tripCount} trips, {Math.round((day.distanceM || 0) / 1609.344)} mi, {Math.round((day.durationSeconds || 0) / 60)} min</span><span>{Math.round(day.maxSpeedMph || 0)} mph, {Math.round(day.eventCount || 0)} events</span></span>
            </button>
          )) : <div className="history-empty">{status === 'loading' ? 'Loading month...' : (status === 'empty' ? 'No activity in this month.' : 'Expand to load this month.')}</div>}
        </div>
      </details>
    )
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
        {useYearView
          ? [...yearGroups.entries()].map(([year, months]) => {
            const hasSelectedDay = months.some((monthKey) => (dayGroups.get(monthKey) || []).some((day) => day.dayKey === selectedDayKey))
            const expanded = expandedYears[year] || hasSelectedDay
            return (
              <details
                key={year}
                open={expanded}
                onToggle={(event) => {
                  const nextOpen = event.currentTarget.open
                  setExpandedYears((previous) => ({ ...previous, [year]: nextOpen }))
                }}
              >
                <summary>{year} <span>{months.length} months</span></summary>
                <div className="history-year-months">
                  {months.map((monthKey) => renderMonth(monthKey))}
                </div>
              </details>
            )
          })
          : effectiveMonthKeys.map((monthKey) => renderMonth(monthKey))}
      </div>
    </section>
  )
}

export default HistoryNavigator

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PanelResizeHandle from './PanelResizeHandle'

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
  showTripsButton = false,
  onShowTrips,
  displayUnits = 'imperial',
  floating = false,
  referenceRef,
  onFloat,
  height,
  onHeightChange,
  onHeightCommit,
}) {
  const panelRef = useRef(null)
  const setPanelElement = useCallback((node) => {
    panelRef.current = node
    referenceRef?.(node)
  }, [referenceRef])
  const resizeCallbacksRef = useRef({ height, onHeightChange, onHeightCommit })
  resizeCallbacksRef.current = { height, onHeightChange, onHeightCommit }
  const [selectionMode, setSelectionMode] = useState(false)
  const [expandedYears, setExpandedYears] = useState({})
  const [expandedMonths, setExpandedMonths] = useState({})

  useEffect(() => {
    const node = panelRef.current
    if (floating || !node || typeof ResizeObserver === 'undefined') return undefined
    let timer
    let lastHeight = resizeCallbacksRef.current.height
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      const borderBox = Array.isArray(entry?.borderBoxSize) ? entry.borderBoxSize[0] : entry?.borderBoxSize
      const nextHeight = Math.round(borderBox?.blockSize || entry?.contentRect.height || 0)
      if (nextHeight < 1 || nextHeight === lastHeight) return
      lastHeight = nextHeight
      resizeCallbacksRef.current.onHeightChange?.(nextHeight)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => resizeCallbacksRef.current.onHeightCommit?.(lastHeight), 300)
    })
    observer.observe(node)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [floating])
  const panelStyle = floating ? { height: '100%', minHeight: 0, maxHeight: 'none', resize: 'none' } : (height ? { height: `${height}px` } : undefined)

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
    return <section ref={setPanelElement} style={panelStyle} className={`history-navigator${floating ? ' floating-history-content' : ''}`}><div className={`history-navigator-header${floating ? ' floating-panel-handle' : ''}`}><h2>History</h2><div className="panel-header-actions"><button type="button" className="small secondary" onClick={refreshHistory}>Refresh</button>{!floating && <button type="button" className="small secondary" onClick={onFloat} title="Float History panel" aria-label="Float History">↗</button>}</div></div><div className="history-empty">No activity in the current history window.</div>{showTripsButton && <button type="button" className="small secondary history-show-trips-button" onClick={onShowTrips}>Show Trips</button>}<PanelResizeHandle panelRef={panelRef} floating={floating} onHeightChange={onHeightChange} onHeightCommit={onHeightCommit} /></section>
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
              <span className="history-day-summary"><span>{day.tripCount} trips, {Math.round((day.distanceM || 0) / (displayUnits === 'metric' ? 1000 : 1609.344))} {displayUnits === 'metric' ? 'km' : 'mi'}, {Math.round((day.durationSeconds || 0) / 60)} min</span><span>{Math.round((day.maxSpeedMph || 0) * (displayUnits === 'metric' ? 1.609344 : 1))} {displayUnits === 'metric' ? 'km/h' : 'mph'}, {Math.round(day.eventCount || 0)} events</span></span>
            </button>
          )) : <div className="history-empty">{status === 'loading' ? 'Loading month...' : (status === 'empty' ? 'No activity in this month.' : 'Expand to load this month.')}</div>}
        </div>
      </details>
    )
  }

  return (
    <section ref={setPanelElement} style={panelStyle} className={`history-navigator${floating ? ' floating-history-content' : ''}`}>
      <div className={`history-navigator-header${floating ? ' floating-panel-handle' : ''}`}>
        <div><h2>History</h2><p>Recent days</p></div>
        <div className="panel-header-actions"><button type="button" className="small secondary" onClick={refreshHistory} title="Refresh history">↻</button>{!floating && <button type="button" className="small secondary" onClick={onFloat} title="Float History panel" aria-label="Float History">↗</button>}</div>
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
      {showTripsButton && <button type="button" className="small secondary history-show-trips-button" onClick={onShowTrips}>Show Trips</button>}
      <PanelResizeHandle panelRef={panelRef} floating={floating} onHeightChange={onHeightChange} onHeightCommit={onHeightCommit} />
    </section>
  )
}

export default HistoryNavigator

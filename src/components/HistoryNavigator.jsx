import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PanelResizeHandle from './PanelResizeHandle'

function monthLabel(dayKey) {
  const date = new Date(`${dayKey}T12:00:00`)
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function monthStatusLabel(status, dayCount, monthSummary) {
  if (status === 'loading') return 'loading...'
  if (status === 'error') return 'retry load'
  if (status === 'empty') return '0 days'
  if (monthSummary?.activeDayCount >= 0) return `${monthSummary.activeDayCount} day${monthSummary.activeDayCount === 1 ? '' : 's'}`
  if (dayCount > 0) return `${dayCount} day${dayCount === 1 ? '' : 's'}`
  return 'not loaded'
}

function HistoryNavigator({
  daySummaries,
  loading = false,
  error = '',
  monthKeys = [],
  monthSummaryByKey = {},
  monthLoadState = {},
  selectedDayKey,
  selectedDayKeys = [],
  setSelectedDayKey,
  refreshHistory,
  loadMonth,
  onReportDays,
  daySelectionState = () => false,
  hasBatchSelection = false,
  onToggleDay,
  onReportDay,
  canGraphDay,
  renderDayTrips,
  displayUnits = 'imperial',
  floating = false,
  resizable = true,
  embedded = false,
  referenceRef,
  onFloat,
  compactHeaderActionsTarget = null,
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
  const [expandedDays, setExpandedDays] = useState({})
  const [expandedYears, setExpandedYears] = useState({})
  const [expandedMonths, setExpandedMonths] = useState({})

  useEffect(() => {
    const node = panelRef.current
    if (floating || embedded || !node || typeof ResizeObserver === 'undefined') return undefined
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
  }, [embedded, floating])
  const panelStyle = floating
    ? { height: '100%', minHeight: 0, maxHeight: 'none', resize: 'none' }
    : embedded
      ? { height: 'auto', minHeight: '240px', maxHeight: 'none', resize: 'none' }
      : (height ? { height: `${height}px` } : undefined)

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
    return <section ref={setPanelElement} style={panelStyle} className={`history-navigator${floating ? ' floating-history-content' : ''}`}>
      <div className={`history-navigator-header${floating ? ' floating-panel-handle' : ''}${compactHeaderActionsTarget ? ' compact-history-header' : ''}`}>
        {!compactHeaderActionsTarget && <h2>Recent days</h2>}
        <div className="panel-header-actions">
          <button type="button" className="small secondary" disabled={loading} onClick={refreshHistory}>{error ? 'Retry history' : 'Refresh'}</button>
          {!floating && !embedded && <button type="button" className="small secondary" onClick={onFloat} title="Float History panel" aria-label="Float History">↗</button>}
        </div>
      </div>
      <div className="history-empty" role="status">{loading ? 'Loading history…' : error ? `Could not load history: ${error}` : 'No activity in the current history window.'}</div>
      {resizable && <PanelResizeHandle panelRef={panelRef} floating={floating || embedded} onHeightChange={onHeightChange} onHeightCommit={onHeightCommit} />}
    </section>
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
            loadMonth?.(monthKey)?.catch(() => {})
          }
        }}
      >
        <summary>{monthLabel(`${monthKey}-01`)} <span>{monthStatusLabel(status, days.length, monthSummary)}</span></summary>
        <div className="history-day-list">
          {status === 'error' && <div className="history-empty" role="status">
            <p>Could not load this month.</p>
            <button type="button" className="small secondary" onClick={() => loadMonth?.(monthKey, { force: true })?.catch(() => {})}>Retry {monthLabel(`${monthKey}-01`)}</button>
          </div>}
          {days.length > 0 ? days.map((day) => (
            <div key={day.dayKey} className="history-day-group">
            <div className="history-day-row">
            {selectionMode && <input type="checkbox" aria-label={`Select day ${day.dayKey}`} checked={daySelectionState(day.dayKey) === true} ref={(node) => { if (node) node.indeterminate = daySelectionState(day.dayKey) === 'mixed' }} onChange={() => onToggleDay(day.dayKey)} />}
            <button type="button" className={`history-day ${selectedDayKeys.includes(day.dayKey) || selectedDayKey === day.dayKey ? 'active' : ''}`} aria-expanded={expandedDays[day.dayKey] ?? (selectedDayKey === day.dayKey || selectedDayKeys.includes(day.dayKey))} onClick={(event) => {
              const expanded = expandedDays[day.dayKey] ?? (selectedDayKey === day.dayKey || selectedDayKeys.includes(day.dayKey))
              setExpandedDays((previous) => ({ ...previous, [day.dayKey]: !expanded }))
              if (!expanded || event.ctrlKey || event.metaKey || event.shiftKey) setSelectedDayKey(day.dayKey, { ctrlKey: event.ctrlKey || (selectionMode && !selectedDayKeys.includes(day.dayKey) && selectedDayKey !== day.dayKey), metaKey: event.metaKey, shiftKey: event.shiftKey })
            }}>
              <span className="history-day-date"><strong>{new Date(`${day.dayKey}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</strong><small>{new Date(`${day.dayKey}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span>
              <span className="history-day-summary"><span>{day.tripCount} trips, {Math.round((day.distanceM || 0) / (displayUnits === 'metric' ? 1000 : 1609.344))} {displayUnits === 'metric' ? 'km' : 'mi'}, {Math.round((day.durationSeconds || 0) / 60)} min</span><span>{Math.round((day.maxSpeedMph || 0) * (displayUnits === 'metric' ? 1.609344 : 1))} {displayUnits === 'metric' ? 'km/h' : 'mph'}, {Math.round(day.eventCount || 0)} events</span></span>
            </button>
            <button type="button" className="trip-graph-button history-day-graph" aria-label={`Graph day ${day.dayKey}`} title="Graph this day" disabled={!canGraphDay?.(day.dayKey)} onClick={() => onReportDay?.(day.dayKey)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></svg></button>
            </div>
            {(expandedDays[day.dayKey] ?? (selectedDayKey === day.dayKey || selectedDayKeys.includes(day.dayKey))) && <div className="history-day-trips">{renderDayTrips?.(day.dayKey, selectionMode)}</div>}
            </div>
          )) : status !== 'error' && <div className="history-empty">{status === 'loading' ? 'Loading month...' : (status === 'empty' ? 'No activity in this month.' : 'Expand to load this month.')}</div>}
        </div>
      </details>
    )
  }

  return (
    <section ref={setPanelElement} style={panelStyle} className={`history-navigator${floating ? ' floating-history-content' : ''}`}>
      <div className={`history-navigator-header${floating ? ' floating-panel-handle' : ''}${compactHeaderActionsTarget ? ' compact-history-header' : ''}`}>
        {!compactHeaderActionsTarget && <h2>Recent days</h2>}
        {!compactHeaderActionsTarget && <div className="panel-header-actions"><button type="button" className="small secondary" onClick={refreshHistory} disabled={loading} title="Refresh history" aria-label="Refresh history">↻</button>{!floating && !embedded && <button type="button" className="small secondary" onClick={onFloat} title="Float Trips panel" aria-label="Float Trips">↗</button>}</div>}
      </div>
      {compactHeaderActionsTarget && createPortal(<>
        <button type="button" className="small secondary history-refresh-button" onClick={refreshHistory} disabled={loading} title="Refresh history" aria-label="Refresh history"><svg className="history-refresh-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M19 12a7.5 7.5 0 1 1-2-5" /></svg></button>
        <button type="button" className={`small secondary ${selectionMode ? 'active' : ''}`} onClick={() => setSelectionMode((value) => !value)}>{selectionMode ? 'Done' : 'Select'}</button>
        <button type="button" className="small secondary history-graph-selected" onClick={() => onReportDays(selectionMode)} disabled={selectionMode ? !hasBatchSelection : (!selectedDayKey && selectedDayKeys.length === 0)} title="Graph selected" aria-label="Graph selected"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></svg></button>
      </>, compactHeaderActionsTarget)}
      {loading && <p className="history-empty" role="status">Loading history…</p>}
      {!loading && error && <p className="history-empty error" role="status">Could not load history: {error}</p>}
      {!compactHeaderActionsTarget && <div className="history-selection-tools">
        <button type="button" className={`small secondary ${selectionMode ? 'active' : ''}`} onClick={() => setSelectionMode((value) => !value)}>{selectionMode ? 'Done' : 'Select'}</button>
        <button type="button" className="small secondary" onClick={() => onReportDays(selectionMode)} disabled={selectionMode ? !hasBatchSelection : (!selectedDayKey && selectedDayKeys.length === 0)}>Graph selected</button>
      </div>}
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
      {resizable && <PanelResizeHandle panelRef={panelRef} floating={floating || embedded} onHeightChange={onHeightChange} onHeightCommit={onHeightCommit} />}
    </section>
  )
}

export default HistoryNavigator

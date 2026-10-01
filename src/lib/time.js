export function toLocalInputValue(date) {
  const offsetMs = date.getTimezoneOffset() * 60000
  const local = new Date(date.getTime() - offsetMs)
  return local.toISOString().slice(0, 16)
}

export function getRangeFromMode(mode, realtimeHours, customFrom, customTo) {
  const now = new Date()

  if (mode === 'custom') {
    const from = new Date(customFrom)
    const to = new Date(customTo)

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new Error('Custom range is invalid. Ensure "From" is earlier than "To".')
    }

    return { from, to, label: 'custom range' }
  }

  if (mode === 'realtime') {
    return {
      from: new Date(now.getTime() - realtimeHours * 60 * 60 * 1000),
      to: now,
      label: `realtime +${realtimeHours}h`,
    }
  }

  if (mode === 'today') {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
      to: now,
      label: 'today',
    }
  }

  if (mode === 'yesterday') {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0),
      to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
      label: 'yesterday',
    }
  }

  if (mode === 'week') {
    return {
      from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      to: now,
      label: 'last 7 days',
    }
  }

  if (mode === 'history') {
    return {
      from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      to: now,
      label: 'recent history',
    }
  }

  return {
    from: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    to: now,
    label: 'last 24h',
  }
}

export function toDateInputValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getExportRangePreset(preset, customStartDate, customEndDate) {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)

  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)

  if (preset === 'today') {
    return { start, end, label: 'today' }
  }

  if (preset === 'week') {
    const day = now.getDay()
    const diffToMonday = (day + 6) % 7
    start.setDate(now.getDate() - diffToMonday)
    return { start, end, label: 'this week' }
  }

  if (preset === 'month') {
    start.setDate(1)
    return { start, end, label: 'this month' }
  }

  if (preset === 'year') {
    start.setMonth(0, 1)
    return { start, end, label: 'this year' }
  }

  if (preset === 'all') {
    return { start: new Date(2000, 0, 1), end, label: 'all time' }
  }

  if (preset === 'custom') {
    const customStart = new Date(customStartDate)
    const customEnd = new Date(customEndDate)

    if (Number.isNaN(customStart.getTime()) || Number.isNaN(customEnd.getTime())) {
      throw new Error('Custom export range has invalid dates.')
    }

    customStart.setHours(0, 0, 0, 0)
    customEnd.setHours(23, 59, 59, 999)

    if (customStart > customEnd) {
      throw new Error('Custom export start date must be on or before end date.')
    }

    return { start: customStart, end: customEnd, label: 'custom range' }
  }

  return { start, end, label: 'today' }
}

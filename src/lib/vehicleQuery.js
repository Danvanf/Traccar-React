const DAY_MS = 24 * 60 * 60 * 1000

function localDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dateRangeFromQuery(text, now) {
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\s+(?:to|through|until)\s+(\d{4}-\d{2}-\d{2})\b/)
  if (explicit) {
    if (localDate(new Date(`${explicit[1]}T00:00:00`)) !== explicit[1] || localDate(new Date(`${explicit[2]}T00:00:00`)) !== explicit[2]) {
      return { error: 'Please use real calendar dates in YYYY-MM-DD format.' }
    }
    if (explicit[2] < explicit[1]) return { error: 'The end date must be on or after the start date.' }
    const spanDays = (Date.parse(`${explicit[2]}T00:00:00Z`) - Date.parse(`${explicit[1]}T00:00:00Z`)) / DAY_MS
    if (spanDays > 365) return { error: 'Please ask about a period of one year or less.' }
    return { from: explicit[1], to: explicit[2], label: `${explicit[1]} through ${explicit[2]}` }
  }

  const today = startOfLocalDay(now)
  let from = today
  let to = today
  let label = 'today'
  if (/\b(yesterday|previous day)\b/.test(text)) {
    from = new Date(today.getTime() - DAY_MS)
    to = from
    label = 'yesterday'
  } else if (/\b(last|past)\s+7\s+days?\b/.test(text)) {
    from = new Date(today.getTime() - 6 * DAY_MS)
    label = 'the last 7 days'
  } else if (/\b(last|previous)\s+week\b/.test(text)) {
    const weekday = (today.getDay() + 6) % 7
    to = new Date(today.getTime() - (weekday + 1) * DAY_MS)
    from = new Date(to.getTime() - 6 * DAY_MS)
    label = 'last calendar week'
  } else if (/\b(this|current)\s+week\b/.test(text)) {
    const weekday = (today.getDay() + 6) % 7
    from = new Date(today.getTime() - weekday * DAY_MS)
    label = 'this week to date'
  } else if (/\b(last|previous)\s+month\b/.test(text)) {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    to = new Date(today.getFullYear(), today.getMonth(), 0)
    label = 'last calendar month'
  } else if (/\b(this|current)\s+month\b/.test(text)) {
    from = new Date(today.getFullYear(), today.getMonth(), 1)
    label = 'this month to date'
  } else if (/\b(today|so far today)\b/.test(text)) {
    label = 'today'
  } else if (/\b(yesterday|previous day|last|past)\b/.test(text)) {
    return { error: 'Please specify a time range such as “yesterday,” “last week,” or “last 7 days.”' }
  } else {
    from = new Date(today.getTime() - 6 * DAY_MS)
    label = 'the last 7 days (default)'
  }

  return { from: localDate(from), to: localDate(to), label }
}

function resolveVehicle(text, vehicles) {
  const normalized = (value) => String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const query = normalized(text)
  const matches = (vehicles || [])
    .filter((vehicle) => vehicle?.id && vehicle?.displayName)
    .map((vehicle) => ({ vehicle, name: normalized(vehicle.displayName) }))
    .filter(({ name }) => name && (` ${query} `).includes(` ${name} `))
    .sort((a, b) => b.name.length - a.name.length)
  if (!matches.length) return { vehicle: null }
  const longest = matches[0].name.length
  const best = matches.filter((match) => match.name.length === longest)
  if (best.length > 1) return { ambiguity: best.map(({ vehicle }) => vehicle.displayName) }
  return { vehicle: best[0].vehicle }
}

export function parseVehicleQuestion(question, vehicles = [], now = new Date()) {
  const text = String(question || '').trim()
  const normalized = text.toLocaleLowerCase()
  if (!text) return { error: 'Enter a question about trips or driving activity.' }

  let metric
  if (/\b(max(?:imum)?\s+speed|highest\s+speed|fastest|top\s+speed)\b/.test(normalized)) metric = 'max-speed'
  else if (/\b(event|events|event\s+count|recorded\s+events?|alerts?)\b/.test(normalized)) metric = 'event-count'
  else if (/\b(how\s+many\s+trips?|trip\s+count|number\s+of\s+trips?|trips?)\b/.test(normalized)) metric = 'trip-count'
  else if (/\b(driving\s+time|time\s+driv(?:en|ing)|duration)\b/.test(normalized)) metric = 'driving-time'
  else if (/\b(miles?|kilometers?|kilometres?|\bkm\b|distance|how\s+far|drove|driven|drive)\b/.test(normalized)) metric = 'distance'
  else return { error: 'I can answer questions about trip count, distance, driving time, highest speed, and event count.' }

  const range = dateRangeFromQuery(normalized, now)
  if (range.error) return range
  const resolved = resolveVehicle(text, vehicles)
  if (resolved.ambiguity) return { error: `I found more than one matching vehicle: ${resolved.ambiguity.join(', ')}. Please use a more specific name.` }
  const explicitVehicle = /\bdid\s+(?:the\s+)?(.+?)\s+(?:drive|drove|make|made|travel|go|went|have|had|record|show)\b/i.exec(text)?.[1]
    || /\bfor\s+(?:the\s+)?(.+?)(?=\s+(?:last|this|past|today|yesterday|in|during|over|on|from)\b|[?.!]|$)/i.exec(text)?.[1]
  if (!resolved.vehicle && explicitVehicle && !/^(?:we|i|you|they|all vehicles?|my vehicles?|our vehicles?)$/i.test(explicitVehicle.trim())) {
    return { error: 'I could not match that vehicle to one you can access. Check the vehicle name or ask about all accessible vehicles.' }
  }

  return {
    metric,
    vehicleId: resolved.vehicle?.id || null,
    vehicleName: resolved.vehicle?.displayName || 'all vehicles you can access',
    from: range.from,
    to: range.to,
    rangeLabel: range.label,
  }
}

export function summarizeVehicleReport(report, metric) {
  const totals = new Map()
  for (const row of report?.rows || []) {
    const key = String(row.vehicleId || 'all')
    const current = totals.get(key) || {
      vehicleId: row.vehicleId || null,
      vehicleName: row.vehicleName || 'Vehicle',
      tripCount: 0,
      distanceMeters: 0,
      durationSeconds: 0,
      eventCount: 0,
      maxSpeedMph: null,
    }
    current.tripCount += Number(row.tripCount || 0)
    current.distanceMeters += Number(row.distanceMeters || 0)
    current.durationSeconds += Number(row.durationSeconds || 0)
    current.eventCount += Number(row.eventCount || 0)
    if (row.maxSpeedMph != null) current.maxSpeedMph = Math.max(current.maxSpeedMph ?? -Infinity, Number(row.maxSpeedMph))
    totals.set(key, current)
  }
  return [...totals.values()].map((row) => ({ ...row, value: {
    'trip-count': row.tripCount,
    distance: row.distanceMeters,
    'driving-time': row.durationSeconds,
    'event-count': row.eventCount,
    'max-speed': row.maxSpeedMph,
  }[metric] }))
}

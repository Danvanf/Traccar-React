function parseNumber(value) {
  const number = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(number) ? number : null
}

function parseBouncieDate(value) {
  const date = new Date(String(value || '').trim())
  return Number.isNaN(date.getTime()) ? null : date
}

function parseCoordinates(value) {
  const parts = String(value || '').split(',').map((part) => Number(part.trim()))
  return parts.length === 2 && parts.every(Number.isFinite) ? parts : [null, null]
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1 } else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(field); field = '' } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field); field = ''
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
    } else field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const headers = (rows.shift() || []).map((header) => header.trim())
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])))
}

export function parseBouncieCsv(text, vehicles) {
  const rows = parseCsv(text)
  const results = []
  const unmatched = []
  rows.forEach((source) => {
    const startedAt = parseBouncieDate(source['Start Date/Time'])
    const endedAt = parseBouncieDate(source['End Date/Time'])
    const vehicle = vehicles.find((candidate) => (source.VIN && candidate.vin && candidate.vin.toLowerCase() === source.VIN.toLowerCase())
      || (Number(candidate.year) === Number(source.Year) && String(candidate.make || '').toLowerCase() === String(source.Make || '').toLowerCase() && String(candidate.model || '').toLowerCase() === String(source.Model || '').toLowerCase()))
    if (!vehicle || !startedAt || !endedAt || endedAt < startedAt) {
      unmatched.push(source.Nickname || source.Model || 'Unnamed Bouncie vehicle')
      return
    }
    const maxSpeedMph = parseNumber(source['Max Speed'])
    const [startLatitude, startLongitude] = parseCoordinates(source['Start Location Lat/Lng'])
    const [endLatitude, endLongitude] = parseCoordinates(source['End Location Lat/Lng'])
    const events = []
    if (parseNumber(source['Rapid Acceleration']) > 0) events.push({ eventType: 'hard_acceleration', occurredAt: startedAt.toISOString(), latitude: startLatitude, longitude: startLongitude, measuredValue: null, unit: null, rawEvidence: { source: 'Rapid Acceleration', value: source['Rapid Acceleration'] } })
    if (parseNumber(source['Hard Braking']) > 0) events.push({ eventType: 'hard_braking', occurredAt: startedAt.toISOString(), latitude: startLatitude, longitude: startLongitude, measuredValue: null, unit: null, rawEvidence: { source: 'Hard Braking', value: source['Hard Braking'] } })
    if (maxSpeedMph != null) events.push({ eventType: 'maximum_speed', occurredAt: startedAt.toISOString(), latitude: startLatitude, longitude: startLongitude, measuredValue: maxSpeedMph, unit: 'mph', rawEvidence: { source: 'Max Speed', value: source['Max Speed'] } })
    results.push({
      vehicleId: vehicle.id,
      traccarDeviceId: Number.isFinite(Number(vehicle.traccarDeviceId)) ? Number(vehicle.traccarDeviceId) : null,
      externalKey: [source.VIN || vehicle.id, startedAt.toISOString(), endedAt.toISOString(), source['Start Odometer'], source['End Odometer']].join('|'),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSeconds: Math.round((endedAt - startedAt) / 1000),
      distanceMiles: parseNumber(source['Distance Driven']) || 0,
      averageSpeedMph: parseNumber(source['Average Speed']),
      maxSpeedMph,
      fuelUsedGallons: parseNumber(source['Fuel Used']),
      fuelEconomyMpg: parseNumber(source['Fuel Economy']),
      startLatitude,
      startLongitude,
      endLatitude,
      endLongitude,
      startAddress: source['Start Location'] || null,
      endAddress: source['End Location'] || null,
      sourceData: source,
      events,
    })
  })
  return { rows: results, unmatched }
}

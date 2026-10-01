function escapeCsv(value) {
  if (value === null || value === undefined) {
    return ''
  }

  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

function sanitizeFileNamePart(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function formatLocalTimestamp(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function downloadCsvFile({ fileName, headers, rows }) {
  const csvLines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ]

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function metersToFeet(value) {
  const n = Number(value)
  return Number.isFinite(n) ? (n * 3.28084).toFixed(2) : ''
}

export function buildRangeCsv({ dayKey, deviceName, points, carProfile, headerMode = 'translated' }) {
  const attributeKeys = new Set()

  points.forEach((point) => {
    const attrs = point.attributes || {}
    Object.keys(attrs).forEach((key) => attributeKeys.add(key))
  })

  const sortedAttributeKeys = [...attributeKeys].sort((a, b) => a.localeCompare(b))

  const headers = [
    'timestampIso',
    'timestampLocal',
    'latitude',
    'longitude',
    'speedMph',
    'headingDeg',
    'accuracyFt',
    'altitudeFt',
    ...sortedAttributeKeys.map((key) => {
      if (headerMode === 'teltonika') return key
      if (carProfile) return carProfile.getAttributeHeader(key)
      return `attr_${key}`
    }),
  ]

  const rows = points.map((point) => {
    const attrs = point.attributes || {}
    const speedKnots = Number(point.speed || 0)

    return [
      point.timestamp.toISOString(),
      formatLocalTimestamp(point.timestamp),
      point.latitude,
      point.longitude,
      (speedKnots * 1.150779).toFixed(2),
      point.course ?? '',
      metersToFeet(point.accuracy),
      metersToFeet(point.altitude),
      ...sortedAttributeKeys.map((key) => {
        const raw = attrs[key] ?? ''
        return headerMode === 'teltonika' || !carProfile
          ? raw
          : carProfile.decodeAttributeValue(key, raw)
      }),
    ]
  })

  const safeDevice = sanitizeFileNamePart(deviceName || 'device')
  const safeDay = sanitizeFileNamePart(dayKey)
  const fileName = `traccar-${safeDevice}-range-${safeDay}.csv`

  return { headers, rows, fileName }
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < String(text || '').length; index += 1) {
    const character = text[index]
    const next = text[index + 1]
    if (quoted) {
      if (character === '"' && next === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        value += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(value)
      value = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && next === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }

  if (value !== '' || row.length > 0) {
    row.push(value)
    if (row.some((cell) => cell !== '')) rows.push(row)
  }

  if (rows.length === 0) return { headers: [], rows: [] }
  const headers = rows[0].map((header, index) => {
    const normalized = String(header || '').trim()
    return index === 0 ? normalized.replace(/^\uFEFF/, '') : normalized
  })
  return { headers, rows: rows.slice(1).map((cells) => headers.map((_, index) => cells[index] ?? '')) }
}

function numberOrNull(value) {
  if (value == null || String(value).trim() === '') return null
  const number = Number(String(value).trim())
  return Number.isFinite(number) ? number : null
}

/**
 * Reads the CSV produced by buildRangeCsv. This restores raw positions into
 * the current session; the caller supplies the target Traccar device because
 * the spreadsheet export intentionally does not embed a database device id.
 */
export function parseAppPositionCsv(text, deviceId) {
  const parsed = parseCsv(text)
  const required = ['timestampIso', 'latitude', 'longitude', 'speedMph', 'headingDeg', 'accuracyFt', 'altitudeFt']
  const headerSet = new Set(parsed.headers)
  if (!required.every((header) => headerSet.has(header))) {
    return { rows: [], format: 'unknown', error: 'This file is not a Traccar React position export.' }
  }

  const rows = parsed.rows.map((cells) => {
    const source = Object.fromEntries(parsed.headers.map((header, index) => [header, cells[index]]))
    const timestamp = new Date(source.timestampIso)
    const latitude = numberOrNull(source.latitude)
    const longitude = numberOrNull(source.longitude)
    if (Number.isNaN(timestamp.getTime()) || latitude == null || longitude == null) return null

    const attributes = {}
    parsed.headers
      .filter((header) => !required.includes(header) && header !== 'timestampLocal')
      .forEach((header) => {
        if (source[header] !== '') {
          // Human-readable exports retain the original attribute key in
          // brackets (for example, "Mass Air Flow (g/s) [attr_io40]").
          // Restore that key so translated exports remain round-trippable.
          const rawKey = header.match(/\[(?:attr_)?([^\]]+)\]$/)?.[1] || header
          attributes[rawKey] = source[header]
        }
      })

    return {
      positionId: null,
      deviceId: Number(deviceId),
      latitude,
      longitude,
      timestamp,
      // Traccar stores speed in knots; the export displays imperial mph.
      speed: (numberOrNull(source.speedMph) || 0) / 1.150779,
      course: numberOrNull(source.headingDeg),
      accuracy: (numberOrNull(source.accuracyFt) || 0) / 3.28084,
      altitude: (numberOrNull(source.altitudeFt) || 0) / 3.28084,
      attributes,
    }
  }).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp)

  return { rows, format: 'traccar-react-positions-v1' }
}

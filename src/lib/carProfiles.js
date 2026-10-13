import teltonikaFmm003 from '../../device-profiles/teltonika-fmm003.json' with { type: 'json' }

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : value
}

const CONVERTERS = {
  kmhToMph(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.621371).toFixed(2) : value
  },
  cToF(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? ((n * 9) / 5 + 32).toFixed(2) : value
  },
  metersToMiles(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n / 1609.344).toFixed(5) : value
  },
  metersToKilometers(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n / 1000).toFixed(3) : value
  },
  kilometersToMiles(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.621371).toFixed(2) : value
  },
  kpaToPsi(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.145037738).toFixed(2) : value
  },
  kpaToInHg(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.295299875).toFixed(2) : value
  },
  tenthsKpaToPsi(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n / 10 * 0.145037738).toFixed(2) : value
  },
  timesTenKpaToPsi(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 10 * 0.145037738).toFixed(2) : value
  },
  litersToGallons(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.264172).toFixed(5) : value
  },
  millilitersToGallons(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.000264172).toFixed(5) : value
  },
  millilitersToLiters(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n / 1000).toFixed(3) : value
  },
  centilitersPerHourToGallonsPerHour(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.00264172).toFixed(4) : value
  },
  centilitersPerHourToLitersPerHour(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n / 100).toFixed(3) : value
  },
  tenthsKpaToKpa(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n / 10).toFixed(2) : value
  },
  timesTenKpaToKpa(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 10).toFixed(2) : value
  },
  millivoltsToVolts(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n / 1000).toFixed(2) : value
  },
  hundredthsToNumber(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n / 100).toFixed(2) : value
  },
  tenthsToNumber(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n / 10).toFixed(1) : value
  },
  timesTen(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 10).toFixed(1) : value
  },
  gramsPerSecondToPoundsPerMinute(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.132277).toFixed(4) : value
  },
}

const METRIC_DISPLAY = {
  kmhToMph: { conversion: null, units: 'km/h' },
  cToF: { conversion: null, units: '°C' },
  metersToMiles: { conversion: 'metersToKilometers', units: 'km' },
  kilometersToMiles: { conversion: null, units: 'km' },
  kpaToPsi: { conversion: null, units: 'kPa' },
  kpaToInHg: { conversion: null, units: 'kPa' },
  tenthsKpaToPsi: { conversion: 'tenthsKpaToKpa', units: 'kPa' },
  timesTenKpaToPsi: { conversion: 'timesTenKpaToKpa', units: 'kPa' },
  litersToGallons: { conversion: null, units: 'L' },
  millilitersToGallons: { conversion: 'millilitersToLiters', units: 'L' },
  centilitersPerHourToGallonsPerHour: { conversion: 'centilitersPerHourToLitersPerHour', units: 'L/h' },
  gramsPerSecondToPoundsPerMinute: { conversion: null, units: 'g/s' },
}

const CANONICAL_DISPLAY = {
  'kPa': (system, quantity) => system === 'metric'
    ? { unit: 'kPa', scale: 1 }
    : quantity === 'barometric_pressure'
      ? { unit: 'inHg', scale: 0.295299875 }
      : { unit: 'psi', scale: 0.145037738 },
  '°C': (system) => system === 'metric'
    ? { unit: '°C', scale: 1, offset: 0 }
    : { unit: '°F', scale: 1.8, offset: 32 },
  'km/h': (system) => system === 'metric'
    ? { unit: 'km/h', scale: 1 }
    : { unit: 'mph', scale: 0.621371 },
  km: (system) => system === 'metric'
    ? { unit: 'km', scale: 1 }
    : { unit: 'mi', scale: 0.621371 },
  m: (system) => system === 'metric'
    ? { unit: 'km', scale: 0.001 }
    : { unit: 'mi', scale: 0.000621371 },
  L: (system) => system === 'metric'
    ? { unit: 'L', scale: 1 }
    : { unit: 'gal', scale: 0.264172 },
  'L/h': (system) => system === 'metric'
    ? { unit: 'L/h', scale: 1 }
    : { unit: 'gal/h', scale: 0.264172 },
  'g/s': () => ({ unit: 'g/s', scale: 1 }),
}

function canonicalDisplay(info, unitSystem) {
  if (info?.canonicalUnit && typeof info.canonicalScale === 'number') {
    const display = CANONICAL_DISPLAY[info.canonicalUnit]?.(unitSystem, info.quantity)
    if (display) return display
  }
  return null
}

export function getAttributeMapValidationIssues(attributeMap) {
  if (!attributeMap || typeof attributeMap !== 'object' || Array.isArray(attributeMap)) {
    return [{ key: null, message: 'Field mappings must be an object.' }]
  }
  const issues = []
  const statusCardOwners = new Map()
  const addIssue = (key, message) => issues.push({ key, message })

  for (const [key, info] of Object.entries(attributeMap)) {
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      addIssue(key, `Mapping for ${key} must be an object.`)
      continue
    }
    if (info.conversion && !CONVERTERS[info.conversion]) addIssue(key, `Unsupported conversion for ${key}: ${info.conversion}`)
    if (info.sentinelValues && !Array.isArray(info.sentinelValues)) addIssue(key, `Sentinel values for ${key} must be an array.`)
    if (info.avlId !== undefined && (!Number.isInteger(Number(info.avlId)) || Number(info.avlId) < 0)) addIssue(key, `AVL ID for ${key} must be a non-negative integer.`)
    if (info.quantity !== undefined && (typeof info.quantity !== 'string' || !info.quantity.trim())) addIssue(key, `Quantity for ${key} must be a non-empty string.`)
    if (info.valueType !== undefined && !['number', 'text', 'identifier'].includes(info.valueType)) addIssue(key, `Value type for ${key} must be number, text, or identifier.`)
    if (['text', 'identifier'].includes(info.valueType) && (info.conversion || info.canonicalScale !== undefined)) addIssue(key, `Text and identifier fields cannot use numeric conversions or canonical scaling.`)
    if (info.statusCardField !== undefined && (typeof info.statusCardField !== 'string' || !info.statusCardField.trim())) addIssue(key, `Status-card field for ${key} must be a non-empty string.`)
    if (info.statusCardField) {
      const owner = statusCardOwners.get(info.statusCardField)
      if (owner) {
        const message = `Status-card field ${info.statusCardField} is assigned to both ${owner} and ${key}.`
        addIssue(owner, message)
        addIssue(key, message)
      } else statusCardOwners.set(info.statusCardField, key)
    }
    if (info.systemGroup !== undefined && (typeof info.systemGroup !== 'string' || !info.systemGroup.trim())) addIssue(key, `System group for ${key} must be a non-empty string.`)
    if (info.sourceUnit !== undefined && (typeof info.sourceUnit !== 'string' || !info.sourceUnit.trim())) addIssue(key, `Source unit for ${key} must be a non-empty string.`)
    if (info.canonicalUnit !== undefined && (typeof info.canonicalUnit !== 'string' || !info.canonicalUnit.trim())) addIssue(key, `Canonical unit for ${key} must be a non-empty string.`)
    if (info.canonicalScale !== undefined && (!Number.isFinite(info.canonicalScale) || info.canonicalScale === 0)) addIssue(key, `Canonical scale for ${key} must be a non-zero finite number.`)
    if (info.canonicalOffset !== undefined && !Number.isFinite(info.canonicalOffset)) addIssue(key, `Canonical offset for ${key} must be a finite number.`)
    if (info.canonicalScale !== undefined && !info.canonicalUnit) addIssue(key, `Canonical unit for ${key} is required when canonical scale is set.`)
    if (info.precision !== undefined && (!Number.isInteger(info.precision) || info.precision < 0 || info.precision > 12)) addIssue(key, `Precision for ${key} must be an integer from 0 to 12.`)
  }
  return issues
}

export function validateAttributeMap(attributeMap) {
  return getAttributeMapValidationIssues(attributeMap)[0]?.message || null
}

export function updateProfileAttributeMapping(attributeMap, key, property, value) {
  if (!attributeMap || typeof attributeMap !== 'object' || Array.isArray(attributeMap)) return attributeMap
  const current = attributeMap[key]
  if (!current || typeof current !== 'object' || Array.isArray(current)) return attributeMap
  const updated = { ...current }
  if (value === undefined) delete updated[property]
  else updated[property] = value
  return { ...attributeMap, [key]: updated }
}

export class CarProfile {
  constructor({ id, name, attributeMap = {} }, unitSystem = 'imperial') {
    this.id = id
    this.name = name
    this.attributeMap = attributeMap
    this.unitSystem = unitSystem === 'metric' ? 'metric' : 'imperial'
  }

  getAttributeInfo(key) {
    return this.attributeMap[key] || null
  }

  getAttributeHeader(key) {
    const translated = translateAttribute(this, key, undefined)
    const parts = []
    if (translated.source.avlId != null) parts.push(`AVL ${translated.source.avlId}`)
    if (translated.unit) parts.push(translated.unit)
    const suffix = parts.length ? ` (${parts.join(', ')})` : ''
    return `${translated.label}${suffix} [attr_${key}]`
  }

  getAttributeUnit(key) {
    const info = this.getAttributeInfo(key)
    const canonical = canonicalDisplay(info, this.unitSystem)
    if (canonical) return canonical.unit
    if (typeof info?.canonicalScale === 'number' && info.canonicalUnit) return info.canonicalUnit
    if (this.unitSystem === 'metric' && info?.conversion && METRIC_DISPLAY[info.conversion]) return METRIC_DISPLAY[info.conversion].units
    return info?.units || ''
  }

  decodeAttributeValue(key, value) {
    const info = this.getAttributeInfo(key)
    if (!info) {
      return value
    }

    if (info.sentinelValues && info.sentinelValues.includes(value)) {
      return ''
    }

    if (typeof info.canonicalScale === 'number') {
      const raw = toNumber(value)
      if (typeof raw !== 'number') return value
      const canonical = raw * info.canonicalScale + (info.canonicalOffset || 0)
      const display = canonicalDisplay(info, this.unitSystem)
      return display ? canonical * display.scale + (display.offset || 0) : canonical
    }

    const metricDisplay = this.unitSystem === 'metric' ? METRIC_DISPLAY[info.conversion] : null
    const conversion = metricDisplay ? metricDisplay.conversion : info.conversion
    if (conversion && CONVERTERS[conversion]) {
      return CONVERTERS[conversion](value)
    }

    return value
  }
}

export function translateAttribute(profile, key, rawValue) {
  const info = profile?.getAttributeInfo?.(key) || null
  const label = info?.label || `Unmapped ${key}`
  const unit = profile?.getAttributeUnit?.(key) || info?.units || ''
  const source = { group: info?.sourceGroup || null, avlId: info?.avlId ?? null }
  const metadata = { unit, sourceUnit: info?.sourceUnit || null, canonicalUnit: info?.canonicalUnit || null, canonicalScale: Number.isFinite(info?.canonicalScale) ? info.canonicalScale : null, canonicalOffset: Number.isFinite(info?.canonicalOffset) ? info.canonicalOffset : null, precision: Number.isInteger(info?.precision) ? info.precision : null, quantity: info?.quantity || null }
  if (rawValue === undefined || rawValue === null || rawValue === '') return { key, label, rawValue, value: null, ...metadata, status: 'missing', source }
  if (typeof rawValue === 'boolean') {
    const status = (info?.valueType === 'text' || info?.valueType === 'identifier' || info?.conversion || typeof info?.canonicalScale === 'number') ? 'invalid' : (info ? 'mapped' : 'unmapped')
    return { key, label, rawValue, value: status === 'invalid' ? null : rawValue, ...metadata, status, source }
  }

  const isSentinel = (info?.sentinelValues || []).some((sentinel) => String(sentinel) === String(rawValue))
  if (isSentinel) return { key, label, rawValue, value: null, ...metadata, status: 'sentinel', source }

  if (info?.valueType === 'text' || info?.valueType === 'identifier') {
    const invalidNumericMapping = info.conversion || typeof info.canonicalScale === 'number'
    return { key, label, rawValue, value: invalidNumericMapping ? null : String(rawValue), ...metadata, canonicalValue: null, status: invalidNumericMapping ? 'invalid' : 'mapped', source }
  }

  const rawNumber = typeof rawValue === 'number' ? rawValue : (typeof rawValue === 'string' && rawValue.trim() !== '' ? Number(rawValue) : NaN)
  if (typeof info?.canonicalScale === 'number' && !Number.isFinite(rawNumber)) {
    return { key, label, rawValue, value: null, ...metadata, canonicalValue: null, status: 'invalid', source }
  }

  const decoded = info ? profile?.decodeAttributeValue?.(key, rawValue) : rawValue
  if (decoded === '' || decoded === undefined || decoded === null) return { key, label, rawValue, value: null, ...metadata, status: 'invalid', source }
  const numeric = Number(decoded)
  const value = typeof decoded === 'number' || (typeof decoded === 'string' && decoded.trim() !== '' && Number.isFinite(numeric)) ? numeric : decoded
  if (info?.conversion && typeof value !== 'number') return { key, label, rawValue, value: null, ...metadata, status: 'invalid', source }
  const canonicalValue = typeof info?.canonicalScale === 'number'
    ? rawNumber * info.canonicalScale + (info.canonicalOffset || 0)
    : null
  if (canonicalValue !== null && !Number.isFinite(canonicalValue)) {
    return { key, label, rawValue, value: null, ...metadata, canonicalValue: null, status: 'invalid', source }
  }
  return { key, label, rawValue, value, canonicalValue, ...metadata, status: info ? 'mapped' : 'unmapped', source }
}

export function createCarProfile(definition, unitSystem = 'imperial') {
  return new CarProfile(definition, unitSystem)
}

export function buildProfileMap(definitions, unitSystem = 'imperial') {
  const map = {}

  Object.values(definitions).forEach((definition) => {
    map[definition.id] = createCarProfile(definition, unitSystem)
  })

  return map
}

// Schema 4 migrated old AVL 12/13 fuel assumptions to the then-current
// FMM003 interpretation. Schema 5 marks those IDs as device-configured because
// the captured sample still cannot distinguish their overloaded meanings.
// Keep migrations narrowly matched so unrelated profile edits are preserved.
export function migrateProfileDefinition(definition) {
  if (!definition || typeof definition !== 'object') return { definition, changes: [] }
  const version = Number(definition.schemaVersion || 1)
  const attributeMap = definition.attributeMap && typeof definition.attributeMap === 'object'
    ? { ...definition.attributeMap }
    : definition.attributeMap
  const changes = []
  const io12 = attributeMap?.io12
  const io13 = attributeMap?.io13
  if (version < 4 && io12?.avlId === 12 && io12.conversion === 'millilitersToGallons' && io12.units === 'gal') {
    const { conversion, quantity, sourceUnit, canonicalUnit, precision, ...rest } = io12
    attributeMap.io12 = { ...rest, label: 'CAN Program ID', units: 'ID', sourceGroup: 'obd' }
    changes.push('Migrated the legacy AVL 12 fuel mapping to the prior FMM003 profile interpretation.')
  }
  if (version < 4 && io13?.avlId === 13 && ['centilitersPerHourToGallonsPerHour', 'hundredthsLitersPer100KmToMpg'].includes(io13.conversion) && ['gal/hr', 'mpg'].includes(io13.units)) {
    const { conversion, quantity, sourceUnit, canonicalUnit, precision, ...rest } = io13
    attributeMap.io13 = { ...rest, label: 'CAN Module ID', units: 'ID', sourceGroup: 'obd' }
    changes.push('Migrated the legacy AVL 13 fuel mapping to the prior FMM003 profile interpretation.')
  }
  // AVL 12/13 are overloaded by Teltonika configuration and model. The
  // exported FMM003 samples contain changing values, so preserve raw values
  // until the device's configured AVL list confirms their semantics.
  if (version < 5 && attributeMap?.io12?.avlId === 12 && attributeMap.io12.label === 'CAN Program ID') {
    const { conversion, quantity, sourceUnit, canonicalUnit, precision, ...rest } = attributeMap.io12
    attributeMap.io12 = { ...rest, label: 'AVL 12 (device-configured value)' }
    delete attributeMap.io12.units
    delete attributeMap.io12.sourceGroup
    changes.push('Marked AVL 12 as device-configured because the FMM003 sample does not confirm a single meaning or unit.')
  }
  if (version < 5 && attributeMap?.io13?.avlId === 13 && attributeMap.io13.label === 'CAN Module ID') {
    const { conversion, quantity, sourceUnit, canonicalUnit, precision, ...rest } = attributeMap.io13
    attributeMap.io13 = { ...rest, label: 'AVL 13 (device-configured value)' }
    delete attributeMap.io13.units
    delete attributeMap.io13.sourceGroup
    changes.push('Marked AVL 13 as device-configured because the FMM003 sample does not confirm a single meaning or unit.')
  }
  if (version < 6 && definition.id === DEFAULT_PROFILE_ID) {
    const canonicalFields = {
      io24: ['km/h', 'km/h', 1, 0, 'speed'],
      io34: ['kPa', 'kPa', 1, 0, 'fuel_pressure'],
      io32: ['°C', '°C', 1, 0, 'engine_coolant_temperature'],
      io37: ['km/h', 'km/h', 1, 0, 'obd_speed'],
      io39: ['°C', '°C', 1, 0, 'temperature'],
      io43: ['km', 'km', 1, 0, 'distance'],
      io44: ['0.1 kPa', 'kPa', 0.1, 0, 'fuel_pressure'],
      io45: ['10 kPa', 'kPa', 10, 0, 'fuel_pressure'],
      io49: ['km', 'km', 1, 0, 'distance'],
      io50: ['kPa', 'kPa', 1, 0, 'barometric_pressure'],
      io53: ['°C', '°C', 1, 0, 'temperature'],
      io56: ['10 kPa', 'kPa', 10, 0, 'fuel_pressure'],
      io58: ['°C', '°C', 1, 0, 'temperature'],
      io60: ['cL/h', 'L/h', 0.01, 0, 'fuel_flow'],
      io542: ['kPa', 'kPa', 1, 0, 'manifold_pressure'],
      io390: ['0.1 L', 'L', 0.1, 0, 'fuel_volume'],
      io40: ['0.01 g/s', 'g/s', 0.01, 0, 'mass_flow'],
      distance: ['m', 'm', 1, 0, 'distance'],
      odometer: ['m', 'm', 1, 0, 'distance'],
      totalDistance: ['m', 'm', 1, 0, 'distance'],
    }
    for (const [key, [sourceUnit, canonicalUnit, canonicalScale, canonicalOffset, quantity]] of Object.entries(canonicalFields)) {
      const field = attributeMap?.[key]
      if (!field || field.canonicalScale !== undefined) continue
      const expectedConversion = {
        io24: 'kmhToMph', io34: 'kpaToPsi', io32: 'cToF', io37: 'kmhToMph', io39: 'cToF',
        io43: 'kilometersToMiles', io44: 'tenthsKpaToPsi', io45: 'timesTenKpaToPsi', io49: 'kilometersToMiles',
        io50: 'kpaToInHg', io53: 'cToF', io56: 'timesTenKpaToPsi', io58: 'cToF',
        io60: 'centilitersPerHourToGallonsPerHour', io542: 'kpaToPsi', io390: 'tenthsToNumber',
        io40: 'hundredthsToNumber', distance: 'metersToMiles', odometer: 'metersToMiles', totalDistance: 'metersToMiles',
      }[key]
      if (field.conversion !== expectedConversion) continue
      attributeMap[key] = { ...field, sourceUnit: field.sourceUnit || sourceUnit, canonicalUnit, canonicalScale, canonicalOffset, quantity: field.quantity || quantity }
      changes.push(`Added canonical-unit metadata from the existing built-in mapping for ${key}.`)
    }
  }
  if (version < 7 && definition.id === DEFAULT_PROFILE_ID) {
    const statusFields = {
      io48: 'fuelLevel', io36: 'engineRpm', power: 'power', io32: 'coolant', io42: 'engineRuntime',
      io40: 'maf', io39: 'intakeAir', io41: 'throttle', ignition: 'ignition', io37: 'obdSpeed',
      io24: 'gnssSpeed', io51: 'controlVoltage', sat: 'satellites', io69: 'gnssStatus', rssi: 'signalStrength',
      io113: 'trackerBatteryLevel', battery: 'batteryVoltage', io68: 'batteryCurrent', io12: 'avl12', io13: 'avl13',
      io50: 'barometricPressure', io52: 'absoluteLoad', io38: 'timingAdvance', io53: 'ambientAir', motion: 'motion',
      pdop: 'pdop', hdop: 'hdop', operator: 'operator', io45: 'fuelRailPressure', axisX: 'accelerometerX',
      axisY: 'accelerometerY', axisZ: 'accelerometerZ', distance: 'segmentDistance', io33: 'shortFuelTrim',
      io34: 'fuelPressure',
    }
    for (const [key, statusCardField] of Object.entries(statusFields)) {
      const field = attributeMap?.[key]
      if (!field || field.statusCardField) continue
      attributeMap[key] = { ...field, statusCardField }
      changes.push(`Moved the ${key} status-card source and label into the profile mapping.`)
    }
  }
  if (version < 8 && definition.id === DEFAULT_PROFILE_ID) {
    // Add catalog-backed fields observed in recent FMM003 records without
    // replacing any user-edited mapping that already exists.
    const addedKeys = ['bleTemp2', 'bleTemp3', 'bleTemp4', 'io20', 'io22', 'io23', 'io80', 'io104', 'io106', 'io108', 'tripOdometer']
    const bundledMappings = DEFAULT_PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID]?.attributeMap || {}
    for (const key of addedKeys) {
      if (attributeMap?.[key] || !bundledMappings[key]) continue
      attributeMap[key] = bundledMappings[key]
      changes.push(`Added catalog-backed FMM003 mapping for ${key} when no saved mapping existed.`)
    }
  }
  if (version < 9 && definition.id === DEFAULT_PROFILE_ID && !attributeMap?.io31) {
    const field = DEFAULT_PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID]?.attributeMap?.io31
    if (field) {
      attributeMap.io31 = field
      changes.push('Added the tentative AVL 31 Engine Load?? mapping without replacing a saved mapping.')
    }
  }
  if (version < 11) {
    const changedKeys = []
    for (const [key, field] of Object.entries(attributeMap || {})) {
      if (!field || typeof field !== 'object' || Array.isArray(field)) continue
      if (!('verificationStatus' in field) && !('verificationNote' in field)) continue
      const updatedField = { ...field }
      delete updatedField.verificationStatus
      delete updatedField.verificationNote
      attributeMap[key] = updatedField
      changedKeys.push(key)
    }
    if (changedKeys.length) changes.push(`Removed verification metadata from profile mappings: ${changedKeys.join(', ')}.`)
  }
  if (version < 12 && definition.id === DEFAULT_PROFILE_ID && attributeMap && !attributeMap.io206) {
    const field = DEFAULT_PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID]?.attributeMap?.io206
    if (field) {
      attributeMap.io206 = field
      changes.push('Added the GSM Area Code mapping for AVL 206 without replacing a saved mapping.')
    }
  }
  if (version < 13 && definition.id === DEFAULT_PROFILE_ID && attributeMap) {
    const additions = ['io11', 'io14', 'io237', 'io250']
    const defaults = DEFAULT_PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID]?.attributeMap || {}
    const addedKeys = []
    for (const key of additions) {
      if (attributeMap[key] || !defaults[key]) continue
      attributeMap[key] = defaults[key]
      addedKeys.push(key)
    }
    if (addedKeys.length) changes.push(`Added documented FMM003 mappings without replacing saved fields: ${addedKeys.join(', ')}.`)
  }
  if (version < 14 && definition.id === DEFAULT_PROFILE_ID && attributeMap) {
    const fields = DEFAULT_PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID]?.attributeMap || {}
    const updatedKeys = []
    const identifierKeys = Object.entries(fields).filter(([, field]) => field?.valueType === 'identifier').map(([key]) => key)
    for (const key of identifierKeys) {
      if (!attributeMap[key] || attributeMap[key].valueType || fields[key]?.valueType !== 'identifier') continue
      attributeMap[key] = { ...attributeMap[key], valueType: 'identifier' }
      updatedKeys.push(key)
    }
    if (updatedKeys.length) changes.push(`Marked FMM003 identifier fields as text without changing their saved mapping: ${updatedKeys.join(', ')}.`)
  }
  return {
    definition: { ...definition, schemaVersion: PROFILE_DEFINITION_SCHEMA_VERSION, attributeMap },
    changes,
  }
}

// Vehicle Catalog profile assignments are authoritative. Resolve a trip's
// explicit vehicle first, then use its active device binding for live device
// contexts. An empty profileId means "no translation" and must not fall
// through to the legacy browser-only device assignment or the default profile.
export function resolveProfileContext({ vehicleId = null, deviceId = null, at = null, vehicles = [], bindings = [], profileMap = {} } = {}) {
  const sameId = (left, right) => left != null && right != null && String(left) === String(right)
  let vehicle = vehicleId == null ? null : vehicles.find((item) => sameId(item.id, vehicleId)) || null

  if (deviceId != null) {
    const sampleTime = at == null ? null : new Date(at).getTime()
    const binding = bindings.find((item) => {
      if (!sameId(item.traccarDeviceId, deviceId)) return false
      if (at == null) return true
      if (!Number.isFinite(sampleTime)) return false
      const startsAt = new Date(item.startsAt).getTime()
      const endsAt = item.endsAt == null ? null : new Date(item.endsAt).getTime()
      return Number.isFinite(startsAt) && startsAt <= sampleTime && (endsAt == null || (Number.isFinite(endsAt) && sampleTime < endsAt))
    })
    if (binding) vehicle = vehicles.find((item) => sameId(item.id, binding.vehicleId)) || vehicle
  }

  if (!vehicle) return { vehicle: null, profileId: null, profile: null, status: 'unbound' }

  const profileId = vehicle.profileId ?? vehicle.profile_id ?? null
  if (profileId == null || profileId === '') return { vehicle, profileId: null, profile: null, status: 'none' }

  const profile = profileMap[profileId] || null
  return { vehicle, profileId, profile, status: profile ? 'assigned' : 'missing-definition' }
}

const bundledProfileModules = typeof import.meta.glob === 'function'
  ? import.meta.glob('../../device-profiles/*.json', { eager: true, import: 'default' })
  : {}

const bundledProfiles = Object.values(bundledProfileModules)
const profileFiles = bundledProfiles.some((profile) => profile?.id === teltonikaFmm003.id)
  ? bundledProfiles
  : [...bundledProfiles, teltonikaFmm003]

export const DEFAULT_PROFILE_DEFINITIONS = Object.fromEntries(
  profileFiles
    .filter((profile) => profile && typeof profile.id === 'string' && profile.id.trim())
    .map((profile) => [profile.id, profile]),
)

export const DEFAULT_PROFILE_ID = 'buick-enclave-2010'
export const PROFILE_DEFINITION_SCHEMA_VERSION = 14

export function getDefaultProfile() {
  return createCarProfile(DEFAULT_PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID])
}

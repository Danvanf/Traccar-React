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
  kilometersToMiles(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.621371).toFixed(2) : value
  },
  litersToGallons(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.264172).toFixed(5) : value
  },
  millilitersToGallons(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.000264172).toFixed(5) : value
  },
  centilitersPerHourToGallonsPerHour(value) {
    const n = toNumber(value)
    return typeof n === 'number' ? (n * 0.00264172).toFixed(4) : value
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

export function validateAttributeMap(attributeMap) {
  if (!attributeMap || typeof attributeMap !== 'object' || Array.isArray(attributeMap)) return 'Field mappings must be an object.'
  for (const [key, info] of Object.entries(attributeMap)) {
    if (!info || typeof info !== 'object' || Array.isArray(info)) return `Mapping for ${key} must be an object.`
    if (info.conversion && !CONVERTERS[info.conversion]) return `Unsupported conversion for ${key}: ${info.conversion}`
    if (info.sentinelValues && !Array.isArray(info.sentinelValues)) return `Sentinel values for ${key} must be an array.`
    if (info.avlId !== undefined && (!Number.isInteger(Number(info.avlId)) || Number(info.avlId) < 0)) return `AVL ID for ${key} must be a non-negative integer.`
  }
  return null
}

export class CarProfile {
  constructor({ id, name, attributeMap = {} }) {
    this.id = id
    this.name = name
    this.attributeMap = attributeMap
  }

  getAttributeInfo(key) {
    return this.attributeMap[key] || null
  }

  getAttributeHeader(key) {
    const info = this.getAttributeInfo(key)
    if (!info) {
      return `attr_${key}`
    }

    const parts = []
    if (info.avlId) {
      parts.push(`AVL ${info.avlId}`)
    }
    if (info.units) {
      parts.push(info.units)
    }

    const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
    return `${info.label}${suffix} [attr_${key}]`
  }

  decodeAttributeValue(key, value) {
    const info = this.getAttributeInfo(key)
    if (!info) {
      return value
    }

    if (info.sentinelValues && info.sentinelValues.includes(value)) {
      return ''
    }

    if (info.conversion && CONVERTERS[info.conversion]) {
      return CONVERTERS[info.conversion](value)
    }

    return value
  }
}

export function createCarProfile(definition) {
  return new CarProfile(definition)
}

export function buildProfileMap(definitions) {
  const map = {}

  Object.values(definitions).forEach((definition) => {
    map[definition.id] = createCarProfile(definition)
  })

  return map
}

export const DEFAULT_PROFILE_DEFINITIONS = {
  'buick-enclave-2010': {
    id: 'buick-enclave-2010',
    name: 'Teltonika FM / OBD2 standard mapping',
    attributeMap: {
      battery: { label: 'Tracker Battery Voltage', units: 'V' },
      bleTemp1: { label: 'BLE Temperature #1', avlId: 25, units: 'degF', sentinelValues: [327.67], conversion: 'cToF' },
      distance: { label: 'Segment Distance', units: 'mi', conversion: 'metersToMiles' },
      event: { label: 'Event / Rule ID' },
      vin: { label: 'Vehicle Identification Number' },
      hdop: { label: 'GNSS HDOP', avlId: 182, units: 'lower is more accurate' },
      hours: { label: 'Engine/Ignition Hours', units: 'ms' },
      ignition: { label: 'Ignition', avlId: 239 },
      io113: { label: 'Tracker Battery Level', avlId: 113, units: '%' },
      io205: { label: 'GSM Cell ID', avlId: 205 },
      io12: { label: 'Fuel Used (trip)', avlId: 12, units: 'gal', conversion: 'millilitersToGallons' },
      io13: { label: 'Fuel Rate', avlId: 13, units: 'gal/hr', conversion: 'centilitersPerHourToGallonsPerHour' },
      io30: { label: 'Diagnostic Trouble Codes', avlId: 30, units: 'count' },
      io15: { label: 'Eco Score', avlId: 15, units: 'score', conversion: 'hundredthsToNumber', sourceGroup: 'permanent' },
      io38: { label: 'Timing Advance', avlId: 38, units: 'deg', sourceGroup: 'obd' },
      io43: { label: 'Distance With MIL On', avlId: 43, units: 'mi', conversion: 'kilometersToMiles', sourceGroup: 'obd' },
      io44: { label: 'Relative Fuel Rail Pressure', avlId: 44, units: 'kPa', conversion: 'tenthsToNumber', sourceGroup: 'obd' },
      io45: { label: 'Direct Fuel Rail Pressure', avlId: 45, units: 'kPa', conversion: 'timesTen', sourceGroup: 'obd' },
      io46: { label: 'Commanded EGR', avlId: 46, units: '%', sourceGroup: 'obd' },
      io47: { label: 'EGR Error', avlId: 47, units: '%', sourceGroup: 'obd' },
      io49: { label: 'Distance Since Codes Cleared', avlId: 49, units: 'mi', conversion: 'kilometersToMiles', sourceGroup: 'obd' },
      io50: { label: 'Barometric Pressure', avlId: 50, units: 'kPa', sourceGroup: 'obd' },
      io52: { label: 'Absolute Load', avlId: 52, units: '%', sourceGroup: 'obd' },
      io53: { label: 'Ambient Air Temperature', avlId: 53, units: 'degF', conversion: 'cToF', sourceGroup: 'obd' },
      io54: { label: 'Time Run With MIL On', avlId: 54, units: 'min', sourceGroup: 'obd' },
      io55: { label: 'Time Since Codes Cleared', avlId: 55, units: 'min', sourceGroup: 'obd' },
      io56: { label: 'Absolute Fuel Rail Pressure', avlId: 56, units: 'kPa', conversion: 'timesTen', sourceGroup: 'obd' },
      io57: { label: 'Hybrid Battery Pack Life', avlId: 57, units: '%', sourceGroup: 'obd' },
      io58: { label: 'Engine Oil Temperature', avlId: 58, units: 'degF', conversion: 'cToF', sourceGroup: 'obd' },
      io59: { label: 'Fuel Injection Timing', avlId: 59, units: 'deg', conversion: 'hundredthsToNumber', sourceGroup: 'obd' },
      io60: { label: 'Fuel Rate', avlId: 60, units: 'gal/hr', conversion: 'centilitersPerHourToGallonsPerHour', sourceGroup: 'obd' },
      io281: { label: 'OBD Fault Codes', avlId: 281, sourceGroup: 'obd' },
      io540: { label: 'Throttle Position Group', avlId: 540, units: '%', sourceGroup: 'obd' },
      io541: { label: 'Commanded Equivalence Ratio', avlId: 541, units: 'ratio', conversion: 'hundredthsToNumber', sourceGroup: 'obd' },
      io542: { label: 'Intake Manifold Absolute Pressure', avlId: 542, units: 'kPa', sourceGroup: 'obd' },
      io759: { label: 'Fuel Type', avlId: 759, sourceGroup: 'obd' },
      io200: { label: 'Eco-driving / harsh state', avlId: 200 },
      io256: { label: 'Vehicle Identification Number', avlId: 256 },
      io389: { label: 'OBD OEM Total Mileage', avlId: 389, units: 'km' },
      io390: { label: 'OBD OEM Fuel Level', avlId: 390, units: 'L', conversion: 'tenthsToNumber' },
      io402: { label: 'Distance Until Service', avlId: 402, units: 'km' },
      io411: { label: 'OEM Battery Charge Level', avlId: 411, units: '%' },
      io24: { label: 'GNSS Speed', avlId: 24, units: 'mph', conversion: 'kmhToMph' },
      io29: { label: 'BLE Battery #1', avlId: 29, units: '%', sentinelValues: [255] },
      io32: { label: 'Engine Coolant Temp', avlId: 32, units: 'degF', conversion: 'cToF' },
      io36: { label: 'Engine RPM', avlId: 36, units: 'rpm' },
      io37: { label: 'OBD Vehicle Speed', avlId: 37, units: 'mph', conversion: 'kmhToMph' },
      io39: { label: 'Intake Air Temp', avlId: 39, units: 'degF', conversion: 'cToF' },
      io40: { label: 'Mass Air Flow', avlId: 40, units: 'g/s', conversion: 'hundredthsToNumber' },
      io41: { label: 'Throttle Position', avlId: 41, units: '%' },
      io42: { label: 'Run Time Since Engine Start', avlId: 42, units: 's' },
      io48: { label: 'Fuel Level', avlId: 48, units: '%' },
      io51: { label: 'Control Module Voltage', avlId: 51, units: 'V', conversion: 'millivoltsToVolts' },
      io68: { label: 'Tracker Battery Current', avlId: 68, units: 'A' },
      io69: { label: 'GNSS Status', avlId: 69, units: '1 = fix OK' },
      io86: { label: 'BLE Humidity #1', avlId: 86, units: '%RH', sentinelValues: [65535] },
      motion: { label: 'Motion', avlId: 240 },
      odometer: { label: 'Teltonika Odometer', avlId: 16, units: 'mi', conversion: 'metersToMiles' },
      operator: { label: 'GSM Operator', avlId: 241, units: 'MCC/MNC' },
      pdop: { label: 'GNSS PDOP', avlId: 181, units: 'lower is more accurate' },
      power: { label: 'External Tracker Supply Voltage', avlId: 66, units: 'V' },
      priority: { label: 'AVL Packet Priority', units: '0 = routine' },
      rssi: { label: 'GSM Signal', avlId: 21, units: '0-5' },
      sat: { label: 'GNSS Satellite Count', units: 'count' },
      totalDistance: { label: 'Traccar Total Distance', units: 'mi', conversion: 'metersToMiles' },
    },
  },
}

export const DEFAULT_PROFILE_ID = 'buick-enclave-2010'

export function getDefaultProfile() {
  return createCarProfile(DEFAULT_PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID])
}

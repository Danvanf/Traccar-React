import { DEFAULT_PROFILE_DEFINITIONS } from './carProfiles'

const PROFILE_DEFINITIONS_KEY = 'traccarProfileDefinitions'
const DEVICE_PROFILE_ASSIGNMENT_KEY = 'traccarDeviceProfileAssignments'

export function loadProfileDefinitions() {
  try {
    const raw = localStorage.getItem(PROFILE_DEFINITIONS_KEY)
    if (!raw) {
      return { ...DEFAULT_PROFILE_DEFINITIONS }
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_PROFILE_DEFINITIONS }
    }

    const definitions = {
      ...DEFAULT_PROFILE_DEFINITIONS,
      ...parsed,
    }
    // Preserve user edits while adding mappings introduced by newer builds.
    // In particular, older saved profiles may contain io53 without its
    // Celsius-to-Fahrenheit conversion, which makes the status card appear
    // to report ambient air in the wrong units.
    const defaultBuiltIn = DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010']
    const savedBuiltIn = parsed['buick-enclave-2010']
    if (defaultBuiltIn && savedBuiltIn) {
      definitions['buick-enclave-2010'] = {
        ...defaultBuiltIn,
        ...savedBuiltIn,
        attributeMap: {
          ...defaultBuiltIn.attributeMap,
          ...(savedBuiltIn.attributeMap || {}),
        },
      }
    }
    const builtIn = definitions['buick-enclave-2010']
    if (builtIn?.attributeMap) {
      if (builtIn.attributeMap.io40?.conversion === 'gramsPerSecondToPoundsPerMinute') {
        builtIn.attributeMap.io40 = { ...builtIn.attributeMap.io40, units: 'g/s', conversion: 'hundredthsToNumber' }
      }
      if (!builtIn.attributeMap.io51?.conversion) {
        builtIn.attributeMap.io51 = { ...builtIn.attributeMap.io51, conversion: 'millivoltsToVolts' }
      }
      for (const key of ['io32', 'io39', 'io53', 'io58']) {
        const mapping = builtIn.attributeMap[key]
        if (mapping?.units === 'degF' && mapping.conversion !== 'cToF') {
          builtIn.attributeMap[key] = { ...mapping, conversion: 'cToF' }
        }
      }
    }
    return definitions
  } catch {
    return { ...DEFAULT_PROFILE_DEFINITIONS }
  }
}

export function saveProfileDefinitions(definitions) {
  localStorage.setItem(PROFILE_DEFINITIONS_KEY, JSON.stringify(definitions))
}

export function loadDeviceProfileAssignments() {
  try {
    const raw = localStorage.getItem(DEVICE_PROFILE_ASSIGNMENT_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }

    return parsed
  } catch {
    return {}
  }
}

export function saveDeviceProfileAssignments(assignments) {
  localStorage.setItem(DEVICE_PROFILE_ASSIGNMENT_KEY, JSON.stringify(assignments))
}

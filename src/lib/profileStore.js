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
    const builtIn = definitions['buick-enclave-2010']
    if (builtIn?.attributeMap) {
      if (builtIn.attributeMap.io40?.conversion === 'gramsPerSecondToPoundsPerMinute') {
        builtIn.attributeMap.io40 = { ...builtIn.attributeMap.io40, units: 'g/s', conversion: 'hundredthsToNumber' }
      }
      if (!builtIn.attributeMap.io51?.conversion) {
        builtIn.attributeMap.io51 = { ...builtIn.attributeMap.io51, conversion: 'millivoltsToVolts' }
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

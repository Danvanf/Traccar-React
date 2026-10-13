import { DEFAULT_PROFILE_DEFINITIONS, DEFAULT_PROFILE_ID, PROFILE_DEFINITION_SCHEMA_VERSION, migrateProfileDefinition } from './carProfiles'

const PROFILE_DEFINITIONS_KEY = 'traccarProfileDefinitions'
const PROFILE_SCHEMA_VERSION = 3

function migrateProfileDefinitions(definitions) {
  const next = { ...definitions }
  const changes = []
  for (const [id, definition] of Object.entries(DEFAULT_PROFILE_DEFINITIONS)) {
    if (!next[id]) next[id] = definition
  }
  for (const [id, profile] of Object.entries(next)) {
    const migrated = migrateProfileDefinition(profile)
    next[id] = migrated.definition
    changes.push(...migrated.changes)
  }
  const savedDefault = next[DEFAULT_PROFILE_ID]
  const defaultDefinition = DEFAULT_PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID]
  if (savedDefault?.attributeMap && defaultDefinition?.attributeMap) {
    const attributeMap = { ...savedDefault.attributeMap }
    for (const [key, defaultInfo] of Object.entries(defaultDefinition.attributeMap)) {
      if (attributeMap[key] && !attributeMap[key].quantity && defaultInfo.quantity) {
        attributeMap[key] = { ...attributeMap[key], quantity: defaultInfo.quantity }
      }
    }
    next[DEFAULT_PROFILE_ID] = { ...savedDefault, schemaVersion: PROFILE_DEFINITION_SCHEMA_VERSION, attributeMap }
  }
  return { definitions: next, changes }
}

export function loadProfileDefinitionsWithStatus() {
  try {
    const raw = localStorage.getItem(PROFILE_DEFINITIONS_KEY)
    if (!raw) {
      return { definitions: { ...DEFAULT_PROFILE_DEFINITIONS }, notice: '', canSave: true }
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { definitions: { ...DEFAULT_PROFILE_DEFINITIONS }, notice: 'Saved device profiles were invalid JSON data. The built-in profiles were loaded; review and save your profiles to replace the invalid copy.', canSave: false }
    }

    const isVersioned = Number.isInteger(parsed.schemaVersion) && parsed.definitions && typeof parsed.definitions === 'object' && !Array.isArray(parsed.definitions)
    const savedDefinitions = isVersioned ? parsed.definitions : parsed
    const definitions = { ...savedDefinitions }
    if (!definitions[DEFAULT_PROFILE_ID]) {
      definitions[DEFAULT_PROFILE_ID] = DEFAULT_PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID]
    }

    if (isVersioned && parsed.schemaVersion > PROFILE_SCHEMA_VERSION) {
      return { definitions, notice: `These profiles use schema version ${parsed.schemaVersion}, newer than this app supports (version ${PROFILE_SCHEMA_VERSION}). They were loaded without conversion changes; saving is disabled to protect them.`, canSave: false }
    }

    const migration = migrateProfileDefinitions(definitions)
    if (!isVersioned || parsed.schemaVersion !== PROFILE_SCHEMA_VERSION || migration.changes.length > 0) {
        if (migration.changes.length > 0 && !localStorage.getItem(`${PROFILE_DEFINITIONS_KEY}:pre-schema-14-backup`)) {
          localStorage.setItem(`${PROFILE_DEFINITIONS_KEY}:pre-schema-14-backup`, JSON.stringify({ savedAt: new Date().toISOString(), savedData: parsed }))
      }
      localStorage.setItem(PROFILE_DEFINITIONS_KEY, JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION, definitions: migration.definitions }))
      const details = migration.changes.length
        ? ` ${[...new Set(migration.changes)].join(' ')} A copy of the previous definitions was saved in browser storage.`
        : ' Existing mappings were preserved.'
      return { definitions: migration.definitions, notice: `Device profiles were migrated to storage schema ${PROFILE_SCHEMA_VERSION}.${details}`, canSave: true }
    }
    return { definitions: migration.definitions, notice: '', canSave: true }
  } catch {
    return { definitions: { ...DEFAULT_PROFILE_DEFINITIONS }, notice: 'Saved device profiles could not be loaded. The built-in profile was loaded; saving is disabled to protect the unreadable copy.', canSave: false }
  }
}

export function loadProfileDefinitions() {
  return loadProfileDefinitionsWithStatus().definitions
}

export function saveProfileDefinitions(definitions) {
  localStorage.setItem(PROFILE_DEFINITIONS_KEY, JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION, definitions }))
}

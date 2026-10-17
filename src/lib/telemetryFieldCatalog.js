import { findCatalogFieldSuggestions, findEligibleDocumentedFieldMatch } from './telemetryDiscovery'

// Keep the catalog data-driven: adding a reviewed JSON evidence record should
// not require another runtime import or a new application release branch.
const bundledCatalogs = Object.values(import.meta.glob('../../device-field-catalog/*.json', {
  eager: true,
  import: 'default',
}))

export function findBundledFieldSuggestions(fieldKey, context) {
  return findCatalogFieldSuggestions(fieldKey, context, bundledCatalogs)
}

export function findBundledAutomaticFieldMatch(fieldKey, context, existingMapping = null) {
  return findEligibleDocumentedFieldMatch(fieldKey, context, bundledCatalogs, existingMapping)
}

const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase()

export function telemetryDeviceMatchContext(device, decoderVersion = '') {
  const attributes = device?.attributes && typeof device.attributes === 'object' && !Array.isArray(device.attributes)
    ? device.attributes
    : {}
  const firmwareValues = [...new Set([attributes.firmwareVersion, attributes.firmware, attributes.fwVersion]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))]
  const configuration = attributes.telemetryConfiguration
  return {
    manufacturer: String(attributes.telemetryManufacturer || attributes.manufacturer || '').trim(),
    model: String(device?.model || '').trim(),
    firmware: firmwareValues.length === 1 ? firmwareValues[0] : '',
    firmwareConflict: firmwareValues.length > 1,
    decoderVersion: String(decoderVersion || '').trim(),
    configuration: configuration && typeof configuration === 'object' && !Array.isArray(configuration)
      ? configuration
      : {},
  }
}

/**
 * Validate the conservative, label-only JSON catalogs shipped with the app.
 * This is used by tests and catalog maintenance; it does not validate or
 * change runtime telemetry mappings.
 */
export function validateResearchCatalog(catalog) {
  const errors = []
  const addError = (code, path, message) => errors.push({ code, path, message })

  if (!Number.isInteger(catalog?.catalogVersion) || catalog.catalogVersion < 1) {
    addError('catalog-version', 'catalogVersion', 'A positive integer catalogVersion is required.')
  }
  if (!String(catalog?.manufacturer || '').trim()) addError('manufacturer', 'manufacturer', 'A manufacturer is required.')
  if (!String(catalog?.model || '').trim()) addError('model', 'model', 'An exact tracker model is required.')
  if (!Array.isArray(catalog?.fields)) {
    addError('fields', 'fields', 'The catalog must contain a fields array.')
    return errors
  }

  const claimedKeys = new Map()
  const unresolvedKeys = new Set()
  for (const [index, field] of catalog.fields.entries()) {
    const fieldPath = `fields[${index}]`
    const rawKey = normalize(field?.key)
    if (!rawKey) {
      addError('field-key', `${fieldPath}.key`, 'A raw Traccar field key is required.')
    } else if (claimedKeys.has(rawKey)) {
      addError('duplicate-key', `${fieldPath}.key`, `This key is already assigned to ${claimedKeys.get(rawKey)}.`)
    } else {
      claimedKeys.set(rawKey, fieldPath)
    }

    for (const [scopeName, expected] of [['manufacturer', catalog.manufacturer], ['model', catalog.model]]) {
      if (!expected || normalize(field?.applicability?.[scopeName]) !== normalize(expected)) {
        addError('applicability', `${fieldPath}.applicability.${scopeName}`, `Field scope must match catalog ${scopeName}.`)
      }
    }
    if (!String(field?.label || '').trim()) addError('label', `${fieldPath}.label`, 'A proposed field label is required.')
    if (field?.status !== 'suggestion') addError('status', `${fieldPath}.status`, 'Research fields must remain suggestions until reviewed.')
    if (field?.autoApply !== false) addError('auto-apply', `${fieldPath}.autoApply`, 'Research suggestions must explicitly disable automatic application.')
    if (field?.mapping !== undefined) addError('mapping', `${fieldPath}.mapping`, 'Research suggestions cannot include an applied mapping or conversion.')

    const references = field?.evidence?.references
    if (!Array.isArray(references) || references.length === 0) {
      addError('evidence', `${fieldPath}.evidence.references`, 'At least one source reference is required.')
    } else {
      references.forEach((reference, referenceIndex) => {
        const referencePath = `${fieldPath}.evidence.references[${referenceIndex}]`
        let validUrl = false
        try { validUrl = new URL(reference?.url).protocol === 'https:' } catch { /* invalid or missing URL */ }
        if (!String(reference?.title || '').trim() || !validUrl) {
          addError('reference', referencePath, 'Each reference needs a title and an HTTPS URL.')
        }
      })
    }

    const aliases = field?.alternateTraccarKeys
    if (aliases !== undefined && !Array.isArray(aliases)) {
      addError('aliases', `${fieldPath}.alternateTraccarKeys`, 'Alternate Traccar keys must be an array.')
      continue
    }
    const seenAliases = new Set()
    for (const [aliasIndex, alias] of (aliases || []).entries()) {
      const normalizedAlias = normalize(alias)
      const aliasPath = `${fieldPath}.alternateTraccarKeys[${aliasIndex}]`
      if (!normalizedAlias) {
        addError('alias-key', aliasPath, 'An alternate Traccar key cannot be empty.')
      } else if (seenAliases.has(normalizedAlias) || normalizedAlias === rawKey) {
        addError('duplicate-alias', aliasPath, 'An alternate key is duplicated or repeats its raw key.')
      } else if (claimedKeys.has(normalizedAlias)) {
        addError('ambiguous-alias', aliasPath, `This key is already assigned to ${claimedKeys.get(normalizedAlias)}.`)
      } else {
        claimedKeys.set(normalizedAlias, fieldPath)
        seenAliases.add(normalizedAlias)
      }
    }
  }

  for (const [index, field] of (Array.isArray(catalog.unresolvedObservedKeys) ? catalog.unresolvedObservedKeys : []).entries()) {
    const key = normalize(field?.key)
    const fieldPath = `unresolvedObservedKeys[${index}]`
    if (!key) addError('unresolved-key', `${fieldPath}.key`, 'An unresolved raw field key is required.')
    else if (unresolvedKeys.has(key) || claimedKeys.has(key)) addError('unresolved-duplicate', `${fieldPath}.key`, 'An unresolved key must be unique and separate from suggested fields.')
    else unresolvedKeys.add(key)
    if (field?.status !== 'unresolved') addError('unresolved-status', `${fieldPath}.status`, 'Observed unresolved fields must stay explicitly unresolved.')
    if (field?.autoApply === true) addError('unresolved-auto-apply', `${fieldPath}.autoApply`, 'An unresolved field cannot be applied automatically.')
    if (!String(field?.reason || '').trim()) addError('unresolved-reason', `${fieldPath}.reason`, 'An unresolved field needs a reason for review.')
  }

  return errors
}

export function classifyTelemetryField({ mapping = {}, personalLabel = '', suggestions = [] } = {}) {
  const interpretations = [
    ...(mapping?.label ? [mapping] : []),
    ...(suggestions || []).filter((candidate) => !mapping?.label || !candidate.relatedProfileSuggestion).map((candidate) => candidate?.mapping).filter((candidate) => candidate?.label),
  ]
  // A partial label suggestion does not contradict units it never asserted.
  // Compare only properties explicitly present in both interpretations.
  const conflicts = interpretations.some((left, index) => interpretations.slice(index + 1).some((right) =>
    ['label', 'avlId', 'valueType', 'quantity', 'sourceUnit', 'canonicalUnit', 'canonicalScale', 'canonicalOffset', 'sourceSignedBits']
      .some((property) => left[property] !== undefined && left[property] !== null && left[property] !== ''
        && right[property] !== undefined && right[property] !== null && right[property] !== ''
        && normalize(left[property]) !== normalize(right[property]))))

  if (conflicts) return 'conflicting'
  if (String(personalLabel || '').trim() || (!mapping?.label && suggestions.length > 0)) return 'suggested'
  if (!mapping?.label) return 'new'
  return 'known'
}

/**
 * Return label-only catalog candidates for the exact observed device model.
 * Missing decoder/firmware details do not suppress a useful suggestion, but
 * the candidate remains visibly uncertain and carries no units or conversion.
 */
export function findCatalogFieldSuggestions(fieldKey, context, catalogs = []) {
  const model = normalize(context?.model)
  if (!fieldKey || !model) return []

  const candidates = catalogs.flatMap((catalog) => (catalog?.fields || []).map((field) => ({
    catalog,
    field,
    matchedViaAlias: normalize(field.key) !== normalize(fieldKey)
      && (field.alternateTraccarKeys || []).some((key) => normalize(key) === normalize(fieldKey)),
  })))
    .filter(({ field, matchedViaAlias }) => (normalize(field.key) === normalize(fieldKey) || matchedViaAlias)
      && normalize(field.applicability?.model) === model
      && field.status === 'suggestion'
      && field.autoApply !== true)

  const manufacturers = new Set(candidates.map(({ catalog, field }) => normalize(catalog.manufacturer || field.applicability?.manufacturer)))
  const requestedManufacturer = normalize(context?.manufacturer)
  if (!requestedManufacturer && manufacturers.size !== 1) return []

  return candidates
    .filter(({ catalog, field }) => !requestedManufacturer
      || normalize(catalog.manufacturer || field.applicability?.manufacturer) === requestedManufacturer)
    .map(({ catalog, field, matchedViaAlias }) => ({
      profileId: `catalog:${normalize(catalog.manufacturer || field.applicability?.manufacturer)}:${model}:${normalize(field.key)}`,
      profileName: `${catalog.manufacturer || field.applicability?.manufacturer} ${field.applicability?.model} documentation`,
      mapping: { label: field.label, avlId: field.manufacturerFieldId },
      catalogSuggestion: true,
      matchedViaAlias,
      confidence: 'low',
      reason: [
        field.suggestionReason || 'Documentation is incomplete for this device and decoder context.',
        matchedViaAlias ? `This catalog entry maps AVL ${field.manufacturerFieldId} to the normalized Traccar key ${fieldKey}; confirm the source before applying units.` : '',
      ].filter(Boolean).join(' '),
      references: field.evidence?.references || catalog.evidence?.references || [],
    }))
}

export function findEligibleDocumentedFieldMatch(fieldKey, context, catalogs = [], existingMapping = null) {
  const candidates = catalogs.flatMap((catalog) => (catalog?.fields || [])
    .filter((field) => normalize(field?.key) === normalize(fieldKey)
      || (field?.alternateTraccarKeys || []).some((key) => normalize(key) === normalize(fieldKey)))
    .map((field) => ({
      ...field,
      catalogKey: field.key,
      matchedViaAlias: normalize(field.key) !== normalize(fieldKey),
      key: fieldKey,
      applicability: {
        ...field.applicability,
        manufacturer: field.applicability?.manufacturer || catalog.manufacturer,
      },
      evidence: field.evidence || catalog.evidence,
    })))
  if (candidates.length === 0) return null

  const matchContext = { ...context, key: fieldKey, existingMapping }
  const eligible = candidates.filter((candidate) => assessDocumentedFieldMatch(
    candidate,
    matchContext,
    candidates,
  ).eligible)
  if (eligible.length !== 1) return null
  return {
    candidate: eligible[0],
    mapping: { ...eligible[0].mapping },
  }
}

/**
 * Decide whether a reviewed catalog entry is safe to apply without asking an
 * administrator. The function is deliberately fail-closed: any missing scope,
 * provenance, unit, or device context leaves the candidate for review.
 */
export function assessDocumentedFieldMatch(candidate, context, alternatives = []) {
  const reasons = []
  const applicability = candidate?.applicability || {}
  const evidence = candidate?.evidence || {}
  const mapping = candidate?.mapping || {}

  if (!candidate?.key || normalize(candidate.key) !== normalize(context?.key)) {
    reasons.push('The received field key does not match.')
  }
  if (!applicability.manufacturer || normalize(applicability.manufacturer) !== normalize(context?.manufacturer)) {
    reasons.push('The tracker manufacturer is missing or does not match.')
  }
  if (!applicability.model || normalize(applicability.model) !== normalize(context?.model)) {
    reasons.push('The exact tracker model is missing or does not match.')
  }
  if (!applicability.decoderVersion || normalize(applicability.decoderVersion) !== normalize(context?.decoderVersion)) {
    reasons.push('The Traccar decoder version is missing or does not match.')
  }

  const firmwareScope = applicability.firmware
  const firmwareAny = firmwareScope?.any === true && !firmwareScope.exact && !firmwareScope.min && !firmwareScope.max
  if (!firmwareScope) {
    reasons.push('Firmware scope is missing.')
  } else if (!firmwareAny && !context?.firmware) {
    reasons.push('The tracker firmware version is missing.')
  } else if (!firmwareAny && (firmwareScope.min || firmwareScope.max) && !isNumericVersion(context.firmware)) {
    reasons.push('The tracker firmware version cannot be compared safely with this range.')
  } else if (!firmwareAny && (firmwareScope.min || firmwareScope.max)
    && [firmwareScope.min, firmwareScope.max].filter(Boolean).some((version) => !isNumericVersion(version))) {
    reasons.push('The catalog firmware range is not in a supported numeric format.')
  } else if (!firmwareAny && firmwareScope.exact && normalize(firmwareScope.exact) !== normalize(context.firmware)) {
    reasons.push('The tracker firmware version is outside the documented scope.')
  } else if (!firmwareAny && firmwareScope.min && compareVersions(context.firmware, firmwareScope.min) < 0) {
    reasons.push('The tracker firmware is older than the documented scope.')
  } else if (!firmwareAny && firmwareScope.max && compareVersions(context.firmware, firmwareScope.max) > 0) {
    reasons.push('The tracker firmware is newer than the documented scope.')
  } else if (!firmwareScope.exact && !firmwareScope.min && !firmwareScope.max && firmwareScope.any !== true) {
    reasons.push('The firmware applicability rule is not explicit.')
  }

  const requiredConfiguration = applicability.requiredConfiguration || {}
  for (const [name, expected] of Object.entries(requiredConfiguration)) {
    if (context?.configuration?.[name] == null) {
      reasons.push(`The required tracker configuration “${name}” is unknown.`)
    } else if (normalize(context.configuration[name]) !== normalize(expected)) {
      reasons.push(`The tracker configuration “${name}” does not match.`)
    }
  }

  const hasApprovedReferences = evidence.reviewStatus === 'approved'
    && Array.isArray(evidence.references)
    && evidence.references.length > 0
    && evidence.references.every((reference) => {
      let protocol = ''
      try { protocol = new URL(reference?.url).protocol } catch { /* malformed citation */ }
      return Boolean(String(reference?.title || '').trim()) && protocol === 'https:'
    })
  if (!hasApprovedReferences) {
    reasons.push('The mapping does not have approved evidence with titled HTTPS references.')
  }
  if (evidence.knownConflicts?.length) reasons.push('The mapping has unresolved competing interpretations.')
  if (candidate?.status !== 'approved' || candidate?.autoApply !== true) reasons.push('The mapping is not explicitly approved for automatic use.')
  if (!mapping.label || !mapping.quantity || !mapping.valueType || !mapping.sourceUnit || !mapping.displayUnit) {
    reasons.push('The mapping needs a label, value type, measurement identity, and explicit received/display units.')
  }
  if (context?.existingMapping?.label) reasons.push('An existing shared or tracker mapping must be preserved.')
  if (alternatives.some((other) => other !== candidate && isApplicableToSameContext(other, context))) {
    reasons.push('Another catalog interpretation also applies to this field and device.')
  }

  return {
    state: reasons.length ? 'suggestion' : 'automatic',
    eligible: reasons.length === 0,
    reasons,
  }
}

function isApplicableToSameContext(candidate, context) {
  const scope = candidate?.applicability || {}
  return normalize(candidate?.key) === normalize(context?.key)
    && normalize(scope.manufacturer) === normalize(context?.manufacturer)
    && normalize(scope.model) === normalize(context?.model)
    && normalize(scope.decoderVersion) === normalize(context?.decoderVersion)
}

function compareVersions(left, right) {
  const a = String(left).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const b = String(right).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0)
  }
  return 0
}

function isNumericVersion(value) {
  return /^\d+(?:\.\d+)*$/.test(String(value ?? '').trim())
}

export function findRelatedProfileSuggestions(fieldKey, activeProfile, profileOptions = []) {
  const activeMapping = activeProfile?.getAttributeInfo?.(fieldKey) || null
  return profileOptions
    .filter((candidate) => candidate.id !== activeProfile?.id && candidate.attributeMap?.[fieldKey]?.label)
    .map((candidate) => {
      const mapping = candidate.attributeMap[fieldKey]
      const sameAvlId = activeMapping?.avlId != null
        && mapping.avlId != null
        && Number(activeMapping.avlId) === Number(mapping.avlId)
      return {
        profileId: candidate.id,
        relatedProfileSuggestion: true,
        profileName: candidate.name,
        mapping,
        confidence: 'low',
        reason: sameAvlId
          ? `AVL ${mapping.avlId} also appears in this profile; tracker compatibility is unconfirmed.`
          : 'The same Traccar key appears in another saved profile; tracker compatibility is unconfirmed.',
      }
    })
    .sort((left, right) => Number(right.mapping.avlId != null && activeMapping?.avlId != null && Number(right.mapping.avlId) === Number(activeMapping.avlId))
      - Number(left.mapping.avlId != null && activeMapping?.avlId != null && Number(left.mapping.avlId) === Number(activeMapping.avlId)))
}

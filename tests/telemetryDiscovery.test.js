import test from 'node:test'
import assert from 'node:assert/strict'
import { assessDocumentedFieldMatch, classifyTelemetryField, findCatalogFieldSuggestions, findEligibleDocumentedFieldMatch, telemetryDeviceMatchContext } from '../src/lib/telemetryDiscovery.js'

const context = {
  key: 'io50',
  manufacturer: 'Teltonika',
  model: 'FMB120',
  firmware: '3.29.1',
  decoderVersion: '6.14.5',
  configuration: { inputMode: 'analog' },
}

const candidate = {
  key: 'io50',
  applicability: {
    manufacturer: 'Teltonika',
    model: 'FMB120',
    firmware: { min: '3.29.0' },
    decoderVersion: '6.14.5',
    requiredConfiguration: { inputMode: 'analog' },
  },
  evidence: { reviewStatus: 'approved', references: [{ title: 'Manufacturer mapping reference', url: 'https://example.test/catalog' }], knownConflicts: [] },
  mapping: { label: 'Analog input 2', quantity: 'voltage', valueType: 'number', sourceUnit: 'V', displayUnit: 'V' },
  status: 'approved',
  autoApply: true,
}

const fmm00aCatalog = {
  manufacturer: 'Teltonika',
  fields: [{
    key: 'io13201',
    manufacturerFieldId: 13201,
    status: 'suggestion',
    autoApply: false,
    label: 'Possible PCB temperature',
    applicability: { manufacturer: 'Teltonika', model: 'FMM00A' },
      evidence: { references: [{ title: 'Manufacturer reference', url: 'https://example.test/fmm00a' }] },
    suggestionReason: 'Firmware and decoder scope are not verified.',
  }, {
    key: 'io32',
    manufacturerFieldId: 32,
    status: 'suggestion',
    autoApply: false,
    label: 'Coolant Temperature',
    alternateTraccarKeys: ['coolantTemp'],
    applicability: { manufacturer: 'Teltonika', model: 'FMM00A' },
    evidence: { references: [{ title: 'Manufacturer reference', url: 'https://example.test/fmm00a' }] },
    suggestionReason: 'This raw key and normalized name identify the same AVL field.',
  }],
}

test('builds automatic-match context only from explicit Traccar metadata', () => {
  assert.deepEqual(telemetryDeviceMatchContext({ model: 'FMM00A' }, '6.14.5'), {
    manufacturer: '',
    model: 'FMM00A',
    firmware: '',
    firmwareConflict: false,
    decoderVersion: '6.14.5',
    configuration: {},
  })
  assert.deepEqual(telemetryDeviceMatchContext({
    model: 'FMM00A',
    attributes: {
      manufacturer: 'Teltonika',
      firmware: '03.29.00',
      telemetryConfiguration: { obdEnabled: true },
      vin: 'must not be copied into match context',
    },
  }, '6.14.5'), {
    manufacturer: 'Teltonika',
    model: 'FMM00A',
    firmware: '03.29.00',
    firmwareConflict: false,
    decoderVersion: '6.14.5',
    configuration: { obdEnabled: true },
  })
  const conflicting = telemetryDeviceMatchContext({ attributes: { firmware: '1.2', fwVersion: '1.3' } })
  assert.equal(conflicting.firmware, '')
  assert.equal(conflicting.firmwareConflict, true)
})

test('allows automatic use only when the entire documented scope matches', () => {
  assert.deepEqual(assessDocumentedFieldMatch(candidate, context), {
    state: 'automatic',
    eligible: true,
    reasons: [],
  })
})

test('returns one fully eligible documented match for automatic application', () => {
  const result = findEligibleDocumentedFieldMatch('io50', context, [{ manufacturer: 'Teltonika', fields: [candidate] }])
  assert.deepEqual(result.mapping, candidate.mapping)
  assert.equal(result.candidate.key, candidate.key)
})

test('does not auto-apply research suggestions, existing mappings, or ambiguous catalog entries', () => {
  assert.equal(findEligibleDocumentedFieldMatch('io13201', { ...context, key: 'io13201', model: 'FMM00A' }, [fmm00aCatalog]), null)
  assert.equal(findEligibleDocumentedFieldMatch('io50', context, [{ manufacturer: 'Teltonika', fields: [candidate] }], { label: 'Manual label' }), null)
  const competing = { ...candidate, mapping: { ...candidate.mapping, label: 'Other documented meaning' } }
  assert.equal(findEligibleDocumentedFieldMatch('io50', context, [{ manufacturer: 'Teltonika', fields: [candidate, competing] }]), null)
})

test('keeps a candidate as a suggestion when any required device context is missing', () => {
  const result = assessDocumentedFieldMatch(candidate, { ...context, decoderVersion: undefined })
  assert.equal(result.eligible, false)
  assert.equal(result.state, 'suggestion')
  assert.ok(result.reasons.some((reason) => reason.includes('decoder version is missing')))
})

test('allows an explicitly firmware-independent mapping without requiring a firmware value', () => {
  const result = assessDocumentedFieldMatch({
    ...candidate,
    applicability: { ...candidate.applicability, firmware: { any: true } },
  }, { ...context, firmware: undefined })
  assert.equal(result.eligible, true)
  assert.deepEqual(result.reasons, [])
})

test('rejects mismatched model, firmware, and tracker configuration', () => {
  const result = assessDocumentedFieldMatch(candidate, {
    ...context,
    model: 'FMM00A',
    firmware: '3.28.9',
    configuration: { inputMode: 'digital' },
  })
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.some((reason) => reason.includes('model')))
  assert.ok(result.reasons.some((reason) => reason.includes('older than')))
  assert.ok(result.reasons.some((reason) => reason.includes('configuration')))
})

test('does not compare prerelease firmware labels as if they were stable versions', () => {
  const result = assessDocumentedFieldMatch(candidate, { ...context, firmware: '3.29.1-rc1' })
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.some((reason) => reason.includes('cannot be compared safely')))
})

test('keeps mappings with illustrative or unresolved evidence out of automatic use', () => {
  const result = assessDocumentedFieldMatch({
    ...candidate,
    evidence: { reviewStatus: 'illustrative', references: ['https://example.test/catalog'], knownConflicts: ['decoder collision'] },
  }, context)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.some((reason) => reason.includes('approved evidence')))
  assert.ok(result.reasons.some((reason) => reason.includes('unresolved competing interpretations')))
})

test('requires a stable measurement identity, explicit value type, and titled HTTPS evidence', () => {
  const result = assessDocumentedFieldMatch({
    ...candidate,
    evidence: { ...candidate.evidence, references: [{ title: 'Unsecure source', url: 'http://example.test/catalog' }] },
    mapping: { ...candidate.mapping, quantity: undefined, valueType: undefined },
  }, context)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.some((reason) => reason.includes('titled HTTPS')))
  assert.ok(result.reasons.some((reason) => reason.includes('measurement identity')))
})

test('never auto-applies over an existing shared or tracker mapping', () => {
  const result = assessDocumentedFieldMatch(candidate, {
    ...context,
    existingMapping: { label: 'Administrator mapping', quantity: 'voltage' },
  })
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.some((reason) => reason.includes('existing shared or tracker mapping')))
})

test('requires explicit reviewed status as well as the automatic-use flag', () => {
  const result = assessDocumentedFieldMatch({ ...candidate, status: 'suggestion' }, context)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.some((reason) => reason.includes('not explicitly approved')))
})

test('blocks automatic use when another interpretation applies to the same device', () => {
  const competing = {
    ...candidate,
    mapping: { label: 'Alternate input meaning', sourceUnit: 'V', displayUnit: 'V' },
  }
  const result = assessDocumentedFieldMatch(candidate, context, [candidate, competing])
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.some((reason) => reason.includes('Another catalog interpretation')))
})

test('offers an exact-model catalog label only as a personal guess with no unit conversion', () => {
  const [suggestion] = findCatalogFieldSuggestions('io13201', { model: 'FMM00A' }, [fmm00aCatalog])
  assert.equal(suggestion.catalogSuggestion, true)
  assert.equal(suggestion.mapping.label, 'Possible PCB temperature')
  assert.equal(suggestion.mapping.avlId, 13201)
  assert.equal(suggestion.mapping.sourceUnit, undefined)
  assert.equal(suggestion.mapping.canonicalScale, undefined)
  assert.match(suggestion.reason, /not verified/)
  assert.deepEqual(suggestion.references, [{ title: 'Manufacturer reference', url: 'https://example.test/fmm00a' }])
})

test('matches a documented AVL catalog label through an alternate normalized Traccar key', () => {
  const [suggestion] = findCatalogFieldSuggestions('coolantTemp', { model: 'FMM00A' }, [fmm00aCatalog])
  assert.equal(suggestion.matchedViaAlias, true)
  assert.equal(suggestion.mapping.label, 'Coolant Temperature')
  assert.equal(suggestion.mapping.avlId, 32)
  assert.equal(suggestion.mapping.sourceUnit, undefined)
  assert.match(suggestion.reason, /normalized Traccar key coolantTemp/)
})

test('keeps catalog suggestions hidden when model is missing, mismatched, or manufacturer is ambiguous', () => {
  assert.deepEqual(findCatalogFieldSuggestions('io13201', {}, [fmm00aCatalog]), [])
  assert.deepEqual(findCatalogFieldSuggestions('io13201', { model: 'FMM003' }, [fmm00aCatalog]), [])
  const conflictingCatalog = { ...fmm00aCatalog, manufacturer: 'Other', fields: [{ ...fmm00aCatalog.fields[0], applicability: { ...fmm00aCatalog.fields[0].applicability, manufacturer: 'Other' } }] }
  assert.deepEqual(findCatalogFieldSuggestions('io13201', { model: 'FMM00A' }, [fmm00aCatalog, conflictingCatalog]), [])
})

test('classifies new, suggested, conflicting, and already mapped fields from their evidence', () => {
  assert.equal(classifyTelemetryField(), 'new')
  assert.equal(classifyTelemetryField({
    suggestions: [{ mapping: { label: 'Coolant Temperature', avlId: 32 } }],
  }), 'suggested')
  assert.equal(classifyTelemetryField({
    personalLabel: 'My guess',
  }), 'suggested')
  assert.equal(classifyTelemetryField({
    mapping: { label: 'Coolant Temperature', avlId: 32, sourceUnit: '°C' },
    suggestions: [{ mapping: { label: 'Coolant Temperature', avlId: 32, sourceUnit: '°C' } }],
  }), 'known')
  assert.equal(classifyTelemetryField({
    mapping: { label: 'Coolant Temperature', avlId: 32, sourceUnit: '°C' },
    suggestions: [{ mapping: { label: 'Engine Load', avlId: 31, sourceUnit: '%' } }],
  }), 'conflicting')
})

test('allows an approved normalized Traccar alias when the exact device context and evidence match', () => {
  assert.equal(findEligibleDocumentedFieldMatch('coolantTemp', { ...context, key: 'coolantTemp', model: 'FMM00A' }, [fmm00aCatalog]), null)
  const aliasCandidate = {
    ...candidate,
    key: 'io31',
    alternateTraccarKeys: ['engineLoad'],
    mapping: { ...candidate.mapping, label: 'Engine Load', quantity: 'engine_load' },
  }
  const result = findEligibleDocumentedFieldMatch('engineLoad', { ...context, key: 'engineLoad' }, [
    { manufacturer: 'Teltonika', fields: [aliasCandidate] },
  ])

  assert.ok(result)
  assert.equal(result.candidate.matchedViaAlias, true)
  assert.equal(result.candidate.catalogKey, 'io31')
  assert.equal(result.candidate.key, 'engineLoad')
  assert.equal(result.mapping.label, 'Engine Load')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROFILE_DEFINITIONS, createCarProfile, getAttributeMapValidationIssues, migrateProfileDefinition, resolveProfileContext, translateAttribute, validateAttributeMap } from '../src/lib/carProfiles.js'
import { normalizeStatusCardFields, STATUS_CARD_FIELDS } from '../src/lib/statusCardFields.js'

test('Teltonika profile includes graph-ready OBD and OEM fields with conversions', () => {
  const definition = DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010']
  const profile = createCarProfile(definition)

  assert.equal(validateAttributeMap(definition.attributeMap), null)
  assert.equal(profile.decodeAttributeValue('io40', 469), 4.69)
  assert.ok(Math.abs(profile.decodeAttributeValue('io43', 10) - 6.21371) < 1e-9)
  assert.equal(profile.decodeAttributeValue('io53', 20), 68)
  assert.ok(Math.abs(profile.decodeAttributeValue('io56', 10) - 14.5037738) < 1e-9)
  assert.ok(Math.abs(profile.decodeAttributeValue('io50', 99) - 29.234687625) < 1e-9)
  assert.equal(profile.getAttributeInfo('io542').label, 'Intake Manifold Absolute Pressure')
})

test('profile display units switch mapped telemetry values between Imperial and Metric', () => {
  const definition = DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010']
  const imperial = createCarProfile(definition, 'imperial')
  const metric = createCarProfile(definition, 'metric')

  assert.ok(Math.abs(translateAttribute(imperial, 'io50', 99).value - 29.234687625) < 1e-9)
  assert.equal(translateAttribute(imperial, 'io50', 99).unit, 'inHg')
  assert.equal(translateAttribute(metric, 'io50', 99).value, 99)
  assert.equal(translateAttribute(metric, 'io50', 99).unit, 'kPa')
  assert.equal(translateAttribute(metric, 'io53', 20).value, 20)
  assert.equal(translateAttribute(metric, 'io53', 20).unit, '°C')
  assert.equal(translateAttribute(metric, 'io43', 10).value, 10)
  assert.equal(translateAttribute(metric, 'io43', 10).unit, 'km')
  assert.equal(translateAttribute(imperial, 'io50', 99).canonicalValue, 99)
  assert.equal(translateAttribute(metric, 'io50', 99).canonicalValue, 99)
  assert.equal(translateAttribute(imperial, 'io32', 20).value, 68)
  assert.equal(translateAttribute(metric, 'io32', 20).value, 20)
  assert.equal(translateAttribute(imperial, 'io44', 100).canonicalValue, 10)
  assert.ok(Math.abs(translateAttribute(imperial, 'io44', 100).value - 1.45037738) < 1e-9)
  assert.equal(translateAttribute(metric, 'io44', 100).value, 10)
  assert.equal(translateAttribute(imperial, 'io60', 100).canonicalValue, 1)
  assert.ok(Math.abs(translateAttribute(imperial, 'io60', 100).value - 0.264172) < 1e-9)
  assert.equal(translateAttribute(metric, 'io60', 100).value, 1)
})

test('FMM003 AVL 12 and 13 remain raw until their configured meanings are verified', () => {
  const definition = DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010']
  const profile = createCarProfile(definition)

  assert.equal(profile.decodeAttributeValue('io12', 4189), 4189)
  assert.equal(profile.decodeAttributeValue('io13', 19), 19)
  assert.match(profile.getAttributeInfo('io12').label, /device-configured/)
  assert.match(profile.getAttributeInfo('io13').label, /device-configured/)
})

test('AVL 31 keeps its tentative label without applying a multiplier', () => {
  const info = DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010'].attributeMap.io31
  const profile = createCarProfile(DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010'])

  assert.equal(info.label, 'Engine Load??')
  assert.equal(profile.decodeAttributeValue('io31', 62), 62)
})

test('AVL 206 uses the GSM Area Code label and preserves its raw code', () => {
  const profile = createCarProfile(DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010'])
  const translated = translateAttribute(profile, 'io206', 47359)

  assert.equal(translated.label, 'GSM Area Code')
  assert.equal(translated.value, 47359)
  assert.equal(translated.unit, '')
  assert.equal(translated.status, 'mapped')
})

test('identifier value type preserves numeric-looking text including leading zeroes', () => {
  const profile = createCarProfile({ id: 'test', name: 'Test', attributeMap: { serial: { label: 'Serial', valueType: 'identifier' } } })
  const rawValue = '001234'
  const translated = translateAttribute(profile, 'serial', rawValue)

  assert.equal(translated.rawValue, '001234')
  assert.equal(translated.value, '001234')
  assert.equal(typeof translated.value, 'string')
  assert.equal(translated.status, 'mapped')
})

test('boolean status values stay boolean and do not acquire units', () => {
  const profile = createCarProfile({ id: 'test', name: 'Test', attributeMap: { ignition: { label: 'Ignition' } } })
  const translated = translateAttribute(profile, 'ignition', false)

  assert.equal(translated.rawValue, false)
  assert.equal(translated.value, false)
  assert.equal(translated.unit, '')
  assert.equal(translated.status, 'mapped')
})

test('text identifiers cannot be configured with numeric conversions', () => {
  const issues = getAttributeMapValidationIssues({ serial: { label: 'Serial', valueType: 'identifier', conversion: 'timesTen' } })
  assert.match(issues[0].message, /cannot use numeric conversions/)
})

test('invalid canonical measurement input is not reported as mapped or NaN', () => {
  const profile = createCarProfile({ id: 'test', name: 'Test', attributeMap: { voltage: { label: 'Voltage', canonicalScale: 0.001, canonicalUnit: 'V' } } })
  const translated = translateAttribute(profile, 'voltage', 'bad')

  assert.equal(translated.rawValue, 'bad')
  assert.equal(translated.value, null)
  assert.equal(translated.canonicalValue, null)
  assert.equal(translated.status, 'invalid')
})

test('FMM003 identifier and network/trip state fields preserve raw values', () => {
  const profile = createCarProfile(DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010'])
  const iccid1 = translateAttribute(profile, 'io11', 8988228066)
  const iccid2 = translateAttribute(profile, 'io14', 6800032603)
  const network = translateAttribute(profile, 'io237', 3)
  const trip = translateAttribute(profile, 'io250', 1)

  assert.equal(iccid1.label, 'SIM ICCID 1 (MSB)')
  assert.equal(iccid1.value, '8988228066')
  assert.equal(iccid1.unit, '')
  assert.equal(iccid2.value, '6800032603')
  assert.equal(network.label, 'Network Type')
  assert.equal(network.value, 3)
  assert.equal(network.unit, '')
  assert.equal(trip.label, 'Trip Status')
  assert.equal(trip.value, 1)
})

test('recent FMM003 tracker and BLE fields decode while keeping invalid sensor sentinels out', () => {
  const definition = DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010']
  const imperial = createCarProfile(definition, 'imperial')
  const metric = createCarProfile(definition, 'metric')

  assert.ok(Math.abs(translateAttribute(imperial, 'tripOdometer', 3000).value - 1.864113) < 1e-12)
  assert.equal(translateAttribute(metric, 'tripOdometer', 3000).value, 3)
  assert.equal(translateAttribute(imperial, 'io104', 50).value, 5)
  assert.equal(translateAttribute(imperial, 'io104', 65535).status, 'sentinel')
  assert.equal(translateAttribute(imperial, 'bleTemp2', 20).value, 68)
  assert.equal(translateAttribute(metric, 'bleTemp2', 20).value, 20)
  assert.equal(translateAttribute(imperial, 'bleTemp2', 327.67).status, 'sentinel')
})

test('status-card source keys and labels come from profile mappings', () => {
  const fields = DEFAULT_PROFILE_DEFINITIONS['buick-enclave-2010'].attributeMap
  const statusFields = Object.fromEntries(Object.entries(fields).filter(([, info]) => info.statusCardField).map(([key, info]) => [info.statusCardField, key]))

  for (const field of STATUS_CARD_FIELDS) assert.ok(statusFields[field], `missing profile mapping for ${field}`)
  assert.equal(fields[statusFields.barometricPressure].label, 'Barometric Pressure')
  assert.equal(fields[statusFields.avl12].label, 'AVL 12 (device-configured value)')
  assert.deepEqual(normalizeStatusCardFields(['fuelUsed', 'fuelRate']), ['avl12', 'avl13'])
})

test('schema 4 CAN-ID labels migrate to raw configured AVL values', () => {
  const result = migrateProfileDefinition({
    id: 'buick-enclave-2010',
    schemaVersion: 4,
    attributeMap: {
      io12: { label: 'CAN Program ID', avlId: 12, units: 'ID', sourceGroup: 'obd' },
      io13: { label: 'CAN Module ID', avlId: 13, units: 'ID', sourceGroup: 'obd' },
    },
  })

  assert.equal(result.definition.schemaVersion, 14)
  assert.equal(result.definition.attributeMap.io12.label, 'AVL 12 (device-configured value)')
  assert.equal(result.definition.attributeMap.io13.label, 'AVL 13 (device-configured value)')
  assert.equal(result.definition.attributeMap.io12.units, undefined)
  assert.equal(result.definition.attributeMap.io13.sourceGroup, undefined)
})

test('schema 5 adds canonical conversion metadata only to matching built-in mappings', () => {
  const result = migrateProfileDefinition({
    id: 'buick-enclave-2010',
    schemaVersion: 5,
    attributeMap: {
      io50: { label: 'Pressure', avlId: 50, units: 'inHg', sourceUnit: 'kPa', conversion: 'kpaToInHg' },
      io44: { label: 'Rail pressure', avlId: 44, units: 'psi', conversion: 'tenthsKpaToPsi' },
      custom: { label: 'Custom', units: 'units', conversion: 'kpaToInHg' },
    },
  })

  assert.equal(result.definition.schemaVersion, 14)
  assert.equal(result.definition.attributeMap.io50.canonicalUnit, 'kPa')
  assert.equal(result.definition.attributeMap.io50.canonicalScale, 1)
  assert.equal(result.definition.attributeMap.io50.statusCardField, 'barometricPressure')
  assert.equal(result.definition.attributeMap.io44.canonicalScale, 0.1)
  assert.equal(result.definition.attributeMap.custom.canonicalScale, undefined)
})

test('schema 8 adds observed catalog mappings without overwriting saved profile edits', () => {
  const result = migrateProfileDefinition({
    id: 'buick-enclave-2010',
    schemaVersion: 7,
    attributeMap: {
      tripOdometer: { label: 'My trip distance', units: 'custom' },
      customField: { label: 'Custom field' },
    },
  })

  assert.equal(result.definition.schemaVersion, 14)
  assert.equal(result.definition.attributeMap.tripOdometer.label, 'My trip distance')
  assert.equal(result.definition.attributeMap.io104.avlId, 104)
  assert.equal(result.definition.attributeMap.io104.canonicalScale, 0.1)
  assert.equal(result.definition.attributeMap.bleTemp4.sentinelValues[0], 327.67)
  assert.equal(result.definition.attributeMap.io31.label, 'Engine Load??')
  assert.equal(result.definition.attributeMap.customField.label, 'Custom field')
})

test('schema 11 removes verification metadata from all profile mappings', () => {
  const result = migrateProfileDefinition({
    id: 'buick-enclave-2010',
    schemaVersion: 9,
    attributeMap: {
      io20: { label: 'BLE Battery #2', avlId: 20, units: '%', verificationStatus: 'verified' },
      io31: { label: 'Engine Load??', verificationStatus: 'assumed', verificationNote: 'Keep uncertainty in the catalog.' },
    },
  })

  assert.equal(result.definition.schemaVersion, 14)
  assert.equal(result.definition.attributeMap.io20.label, 'BLE Battery #2')
  assert.equal(result.definition.attributeMap.io20.verificationStatus, undefined)
  assert.equal(result.definition.attributeMap.io31.verificationStatus, undefined)
  assert.equal(result.definition.attributeMap.io31.verificationNote, undefined)
  assert.equal(result.definition.attributeMap.io31.label, 'Engine Load??')
  assert.match(result.changes.join(' '), /Removed verification metadata from profile mappings: io20, io31/)
})

test('schema 13 adds documented FMM003 mappings without overwriting saved fields', () => {
  const result = migrateProfileDefinition({
    id: 'buick-enclave-2010',
    schemaVersion: 12,
    attributeMap: {
      io11: { label: 'Custom identifier label', avlId: 11 },
      io237: { label: 'Custom network label', avlId: 237 },
    },
  })

  assert.equal(result.definition.schemaVersion, 14)
  assert.deepEqual(result.definition.attributeMap.io11, { label: 'Custom identifier label', avlId: 11, valueType: 'identifier' })
  assert.deepEqual(result.definition.attributeMap.io14, { label: 'SIM ICCID 2 (LSB)', avlId: 14, valueType: 'identifier' })
  assert.deepEqual(result.definition.attributeMap.io237, { label: 'Custom network label', avlId: 237 })
  assert.deepEqual(result.definition.attributeMap.io250, { label: 'Trip Status', avlId: 250 })
  assert.match(result.changes.join(' '), /io14, io250/)
})

test('schema 12 adds GSM Area Code mapping to existing default profiles', () => {
  const result = migrateProfileDefinition({
    id: 'buick-enclave-2010',
    schemaVersion: 11,
    attributeMap: { io205: { label: 'GSM Cell ID', avlId: 205 } },
  })

  assert.equal(result.definition.schemaVersion, 14)
  assert.deepEqual(result.definition.attributeMap.io206, { label: 'GSM Area Code', avlId: 206 })
  assert.match(result.changes.join(' '), /Added the GSM Area Code mapping for AVL 206/)
})

test('schema 14 marks saved FMM003 ICCID mappings as identifiers without replacing labels', () => {
  const result = migrateProfileDefinition({
    id: 'buick-enclave-2010',
    schemaVersion: 13,
    attributeMap: { io11: { label: 'My ICCID label', avlId: 11 }, io14: { label: 'My second ICCID label', avlId: 14 }, io100: { label: 'My CAN program', avlId: 100 }, io256: { label: 'My VIN', avlId: 256 } },
  })

  assert.equal(result.definition.schemaVersion, 14)
  assert.deepEqual(result.definition.attributeMap.io11, { label: 'My ICCID label', avlId: 11, valueType: 'identifier' })
  assert.deepEqual(result.definition.attributeMap.io14, { label: 'My second ICCID label', avlId: 14, valueType: 'identifier' })
  assert.equal(result.definition.attributeMap.io100.valueType, 'identifier')
  assert.equal(result.definition.attributeMap.io256.valueType, 'identifier')
})

test('report profile resolution selects the definition assigned to each vehicle', () => {
  const profileMap = {
    imperial: createCarProfile({ id: 'imperial', name: 'FMM003 Imperial', attributeMap: { io50: { label: 'Pressure', units: 'inHg', conversion: 'kpaToInHg' } } }),
    metric: createCarProfile({ id: 'metric', name: 'FMM003 Metric', attributeMap: { io50: { label: 'Pressure', units: 'kPa' } } }),
  }
  const vehicles = [
    { id: 'vehicle-a', profileId: 'imperial' },
    { id: 'vehicle-b', profileId: 'metric' },
  ]
  const first = resolveProfileContext({ vehicleId: 'vehicle-a', vehicles, profileMap })
  const second = resolveProfileContext({ vehicleId: 'vehicle-b', vehicles, profileMap })

  assert.equal(first.profile.name, 'FMM003 Imperial')
  assert.equal(translateAttribute(first.profile, 'io50', 99).value, 29.23)
  assert.equal(second.profile.name, 'FMM003 Metric')
  assert.equal(translateAttribute(second.profile, 'io50', 99).value, 99)
})

test('historical report resolution follows the device binding effective at sample time', () => {
  const profileMap = {
    carA: createCarProfile({ id: 'carA', name: 'Vehicle A profile' }),
    carB: createCarProfile({ id: 'carB', name: 'Vehicle B profile' }),
  }
  const vehicles = [
    { id: 'vehicle-a', profileId: 'carA' },
    { id: 'vehicle-b', profileId: 'carB' },
  ]
  const bindings = [
    { traccarDeviceId: 5, vehicleId: 'vehicle-a', startsAt: '2025-01-01T00:00:00Z', endsAt: '2026-01-01T00:00:00Z' },
    { traccarDeviceId: 5, vehicleId: 'vehicle-b', startsAt: '2026-01-01T00:00:00Z', endsAt: null },
  ]

  const historical = resolveProfileContext({ vehicleId: 'vehicle-b', deviceId: 5, at: '2025-06-01T00:00:00Z', vehicles, bindings, profileMap })
  const current = resolveProfileContext({ vehicleId: 'vehicle-b', deviceId: 5, at: '2026-06-01T00:00:00Z', vehicles, bindings, profileMap })

  assert.equal(historical.vehicle.id, 'vehicle-a')
  assert.equal(historical.profile.name, 'Vehicle A profile')
  assert.equal(current.vehicle.id, 'vehicle-b')
  assert.equal(current.profile.name, 'Vehicle B profile')
})

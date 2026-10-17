import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { findCatalogFieldSuggestions, validateResearchCatalog } from '../src/lib/telemetryDiscovery.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogDirectory = path.join(projectRoot, 'device-field-catalog')

async function loadResearchCatalogs() {
  const files = (await readdir(catalogDirectory)).filter((file) => file.endsWith('.json'))
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(catalogDirectory, file), 'utf8'))))
}

test('bundled research catalogs are exact-model, sourced, label-only suggestions', async () => {
  const catalogs = await loadResearchCatalogs()

  assert.ok(catalogs.length >= 5)
  for (const catalog of catalogs) {
    assert.deepEqual(validateResearchCatalog(catalog), [], `${catalog.model} catalog integrity`)
    for (const field of catalog.fields || []) {
      assert.equal(field.status, 'suggestion', `${catalog.model}.${field.key} status`)
      assert.equal(field.autoApply, false, `${catalog.model}.${field.key} autoApply`)
      assert.equal(field.applicability?.manufacturer, catalog.manufacturer)
      assert.equal(field.applicability?.model, catalog.model)
      assert.ok(field.label, `${catalog.model}.${field.key} label`)
      assert.ok(field.evidence?.references?.length, `${catalog.model}.${field.key} sources`)
      for (const reference of field.evidence.references) {
        if (reference.url.includes('github.com/traccar/traccar/blob/')) {
          assert.match(reference.url, /github\.com\/traccar\/traccar\/blob\/v\d+\.\d+\.\d+\//, `${catalog.model}.${field.key} decoder reference must pin a release`)
          assert.ok(reference.supports.includes(`position attribute "${field.key}"`), `${catalog.model}.${field.key} decoder evidence must describe the API key`)
          assert.match(reference.supports, /not the manufacturer meaning or units/, `${catalog.model}.${field.key} decoder evidence must not overstate semantic proof`)
        }
      }
      assert.equal(field.mapping, undefined, `${catalog.model}.${field.key} must not ship a conversion`)
      const [suggestion] = findCatalogFieldSuggestions(field.key, { model: catalog.model, manufacturer: catalog.manufacturer }, [catalog])
      assert.equal(suggestion.mapping.sourceUnit, undefined, `${catalog.model}.${field.key} suggestion unit`)
      assert.equal(suggestion.mapping.canonicalScale, undefined, `${catalog.model}.${field.key} suggestion scale`)
      if (catalog.manufacturer === 'Queclink') {
        assert.ok(field.evidence.knownLimitations.some((limitation) => limitation.includes('protocol document cited here is hosted by a third party')), `${catalog.model}.${field.key} must disclose protocol-source hosting`)
      }
    }
  }
})

test('GV300 analog suggestions cite official hardware documentation without claiming protocol semantics', async () => {
  const catalogs = await loadResearchCatalogs()
  const gv300 = catalogs.find((catalog) => catalog.model === 'GV300')

  for (const key of ['adc1', 'adc2']) {
    const field = gv300.fields.find((entry) => entry.key === key)
    const hardwareReference = field.evidence.references.find((reference) => reference.url.includes('queclink.com/sites/default/files/GV300'))
    assert.ok(hardwareReference)
    assert.match(hardwareReference.supports, /does not define Traccar position keys/)
  }
})

test('catalog validation identifies duplicate keys, ambiguous aliases, and unsafe suggestions', () => {
  const catalog = {
    catalogVersion: 1,
    manufacturer: 'Example',
    model: 'Tracker 1',
    fields: [
      {
        key: 'rawA',
        alternateTraccarKeys: ['normalizedA', 'rawA'],
        label: 'First field',
        status: 'suggestion',
        autoApply: false,
        applicability: { manufacturer: 'Example', model: 'Tracker 1' },
        evidence: { references: [{ title: 'Source', url: 'https://example.com/source' }] },
      },
      {
        key: 'rawA',
        alternateTraccarKeys: ['normalizedA'],
        label: 'Second field',
        status: 'suggestion',
        autoApply: true,
        mapping: { sourceUnit: '°C' },
        applicability: { manufacturer: 'Example', model: 'Tracker 1' },
        evidence: { references: [{ title: 'Source', url: 'http://example.com/source' }] },
      },
    ],
    unresolvedObservedKeys: [{ key: 'rawA', status: 'unresolved', reason: 'Needs review.' }],
  }

  const errors = validateResearchCatalog(catalog)
  assert.ok(errors.some((error) => error.code === 'duplicate-key'))
  assert.ok(errors.some((error) => error.code === 'duplicate-alias'))
  assert.ok(errors.some((error) => error.code === 'ambiguous-alias'))
  assert.ok(errors.some((error) => error.code === 'auto-apply'))
  assert.ok(errors.some((error) => error.code === 'mapping'))
  assert.ok(errors.some((error) => error.code === 'reference'))
  assert.ok(errors.some((error) => error.code === 'unresolved-duplicate'))
})

test('FMM00A AVL 31–36 names remain exact-model label-only suggestions', async () => {
  const catalogs = await loadResearchCatalogs()
  const expected = {
    io31: 'Engine Load',
    io32: 'Coolant Temperature',
    io33: 'Short Fuel Trim',
    io34: 'Fuel Pressure',
    io35: 'Intake Manifold Absolute Pressure',
    io36: 'Engine RPM',
  }

  for (const [key, label] of Object.entries(expected)) {
    const [suggestion] = findCatalogFieldSuggestions(key, { model: 'FMM00A', manufacturer: 'Teltonika' }, catalogs)
    assert.equal(suggestion.mapping.label, label)
    assert.equal(suggestion.mapping.avlId, Number(key.slice(2)))
    assert.equal(suggestion.mapping.sourceUnit, undefined)
    assert.equal(suggestion.mapping.canonicalScale, undefined)
    assert.match(suggestion.reason, /bundled FMM00A profile includes the reviewed interpretation/)
    assert.doesNotMatch(suggestion.reason, /model-field mistake|source units and conversion remain unset/)
    assert.ok(suggestion.references.some((reference) => reference.url.includes('FMM00A_Teltonika_Data_Sending_Parameters_ID')))
  }

  const [distanceSuggestion] = findCatalogFieldSuggestions('io1593', { model: 'FMM00A', manufacturer: 'Teltonika' }, catalogs)
  assert.equal(distanceSuggestion.mapping.label, 'Calculated Remaining Distance')
  assert.equal(distanceSuggestion.mapping.avlId, 1593)
  assert.equal(distanceSuggestion.mapping.sourceUnit, undefined)
  assert.equal(distanceSuggestion.mapping.canonicalScale, undefined)
  assert.match(distanceSuggestion.reason, /fallback supplies a name for a custom profile/)
  assert.deepEqual(findCatalogFieldSuggestions('io1593', { model: 'FMM003', manufacturer: 'Teltonika' }, catalogs), [])
})

test('FMM00A normalized Traccar keys resolve to their AVL catalog labels without unit guesses', async () => {
  const catalogs = await loadResearchCatalogs()
  const expected = {
    engineLoad: [31, 'Engine Load'],
    coolantTemp: [32, 'Coolant Temperature'],
    rpm: [36, 'Engine RPM'],
  }

  for (const [key, [avlId, label]] of Object.entries(expected)) {
    const [suggestion] = findCatalogFieldSuggestions(key, { model: 'FMM00A', manufacturer: 'Teltonika' }, catalogs)
    assert.equal(suggestion.matchedViaAlias, true)
    assert.equal(suggestion.mapping.avlId, avlId)
    assert.equal(suggestion.mapping.label, label)
    assert.equal(suggestion.mapping.sourceUnit, undefined)
    assert.equal(suggestion.mapping.canonicalScale, undefined)
    assert.match(suggestion.reason, new RegExp(`normalized Traccar key ${key}`))
    assert.ok(suggestion.references.some((reference) => reference.url.includes('v6.14.5/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java')))
  }
})

test('FMM00A-supported OBD rows surface only as raw-key label suggestions', async () => {
  const catalogs = await loadResearchCatalogs()
  const expected = {
    io540: [540, 'Throttle Position Group'],
    io541: [541, 'Commanded Equivalence Ratio'],
    io542: [542, 'Intake Manifold Absolute Pressure (2-byte)'],
  }

  for (const [key, [avlId, label]] of Object.entries(expected)) {
    const [suggestion] = findCatalogFieldSuggestions(key, { model: 'FMM00A', manufacturer: 'Teltonika' }, catalogs)
    assert.equal(suggestion.mapping.label, label)
    assert.equal(suggestion.mapping.avlId, avlId)
    assert.equal(suggestion.mapping.sourceUnit, undefined)
    assert.equal(suggestion.mapping.canonicalScale, undefined)
    assert.match(suggestion.reason, /bundled FMM00A profile includes the reviewed interpretation/)
    assert.ok(suggestion.references.some((reference) => reference.url.includes('FMM00A_Teltonika_Data_Sending_Parameters_ID')))
    assert.ok(suggestion.references.some((reference) => reference.url.includes('v6.14.5/src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java')))
    assert.deepEqual(findCatalogFieldSuggestions(key, { model: 'FMM003', manufacturer: 'Teltonika' }, catalogs), [])
  }
})

test('ledger suggestions stay hidden for a different tracker model and carry their evidence links', async () => {
  const catalogs = await loadResearchCatalogs()
  const [suggestion] = findCatalogFieldSuggestions('power', { model: 'FMC130' }, catalogs)

  assert.equal(suggestion.mapping.label, 'External Voltage')
  assert.equal(suggestion.catalogSuggestion, true)
  assert.equal(suggestion.mapping.avlId, undefined)
  assert.equal(suggestion.mapping.sourceUnit, undefined)
  assert.match(suggestion.reason, /hardware-support table omits this model for AVL 66/)
  assert.ok(suggestion.references.some((reference) => reference.url.includes('FMC130_Teltonika_Data_Sending_Parameters_ID')))
  assert.deepEqual(findCatalogFieldSuggestions('power', { model: 'FMM00A' }, catalogs).map((entry) => entry.mapping.label), [])
})

test('Teltonika catalog guesses unlink AVL IDs omitted from the exact model hardware table', async () => {
  const catalogs = await loadResearchCatalogs()
  const unsupported = {
    FMC003: ['axisX', 'axisY', 'axisZ', 'battery', 'batteryCurrent', 'batteryLevel', 'hdop', 'ignition', 'motion', 'odometer', 'pdop', 'power', 'rssi'],
    FMC130: ['axisX', 'axisY', 'axisZ', 'battery', 'batteryLevel', 'hdop', 'ignition', 'motion', 'odometer', 'pdop', 'power', 'rssi'],
  }

  for (const [model, keys] of Object.entries(unsupported)) {
    for (const key of keys) {
      const [suggestion] = findCatalogFieldSuggestions(key, { model, manufacturer: 'Teltonika' }, catalogs)
      assert.equal(suggestion.mapping.avlId, undefined, `${model}.${key} must not assert an unsupported AVL association`)
      assert.match(suggestion.reason, /hardware-support table omits this model for AVL/)
      assert.equal(suggestion.mapping.sourceUnit, undefined)
      assert.equal(suggestion.mapping.canonicalScale, undefined)
    }
  }

  const [fmc003OemMileage] = findCatalogFieldSuggestions('io389', { model: 'FMC003', manufacturer: 'Teltonika' }, catalogs)
  assert.equal(fmc003OemMileage.mapping.avlId, 389)
  const [fmc130BatteryCurrent] = findCatalogFieldSuggestions('batteryCurrent', { model: 'FMC130', manufacturer: 'Teltonika' }, catalogs)
  assert.equal(fmc130BatteryCurrent.mapping.avlId, 68)
})
test('FMB120 family table evidence confirms supported AVL IDs while keeping unverified mappings yellow', async () => {
  const catalogs = await loadResearchCatalogs()
  const fmb120 = catalogs.find((catalog) => catalog.model === 'FMB120')
  assert.ok(fmb120)

  for (const field of fmb120.fields) {
    const [suggestion] = findCatalogFieldSuggestions(field.key, { model: 'FMB120', manufacturer: 'Teltonika' }, catalogs)
    const familySupport = field.evidence.references.find((reference) => reference.url.includes('FMB001_Teltonika_Data_Sending_Parameters_ID'))
    assert.ok(familySupport, 'FMB120.' + field.key + ' family support reference')
    assert.ok(familySupport.supports.includes('AVL ' + field.manufacturerFieldId), 'FMB120.' + field.key + ' supported AVL ID')
    assert.match(familySupport.supports, /explicitly lists FMB120/)
    assert.equal(suggestion.mapping.avlId, field.manufacturerFieldId)
    assert.equal(suggestion.mapping.sourceUnit, undefined)
    assert.equal(suggestion.mapping.canonicalScale, undefined)
    assert.ok(suggestion.reason.includes('firmware/configuration and received Traccar attribute are confirmed'))
    assert.doesNotMatch(suggestion.reason, /support table omits/)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { getMappingPropertyDifferences, getProfileMappingDifferences, mergeSelectedProfileMappings, mergeSelectedProfileProperties } from '../src/lib/profileImport.js'

test('profile mapping differences ignore object property order and include additions, changes, and removals', () => {
  const current = {
    io31: { label: 'Load', units: '%', options: { min: 0, max: 100 } },
    io32: { label: 'Coolant', units: '°F' },
    io33: { label: 'Old field' },
  }
  const source = {
    io31: { options: { max: 100, min: 0 }, units: '%', label: 'Load' },
    io32: { label: 'Coolant', units: '°C' },
    io34: { label: 'Pressure', units: 'kPa' },
  }

  assert.deepEqual(getProfileMappingDifferences(current, source), [
    { key: 'io32', current: current.io32, source: source.io32, change: 'changed' },
    { key: 'io33', current: current.io33, source: undefined, change: 'removed' },
    { key: 'io34', current: undefined, source: source.io34, change: 'added' },
  ])
})

test('selected profile mapping updates preserve unchecked mappings and remove selected deleted fields', () => {
  const current = { io31: { label: 'Old load' }, io32: { label: 'Coolant' }, io33: { label: 'Keep this' } }
  const source = { io31: { label: 'Engine Load' }, io32: { label: 'Coolant' } }

  assert.deepEqual(mergeSelectedProfileMappings(current, source, ['io31', 'io33']), {
    io31: { label: 'Engine Load' },
    io32: { label: 'Coolant' },
  })
})

test('selected mapping properties update independently within a PID', () => {
  const current = {
    io32: { label: 'Coolant', units: 'degF', conversion: 'cToF', statusCardField: 'coolant' },
    io34: { label: 'Fuel Pressure' },
  }
  const source = {
    io32: { label: 'Engine Coolant Temperature', units: 'degF', conversion: 'cToF', quantity: 'temperature' },
    io34: { units: 'kPa' },
  }

  assert.deepEqual(mergeSelectedProfileProperties(current, source, {
    io32: ['units', 'quantity', 'statusCardField'],
    io34: ['units'],
  }), {
    io32: { label: 'Coolant', units: 'degF', conversion: 'cToF', quantity: 'temperature' },
    io34: { label: 'Fuel Pressure', units: 'kPa' },
  })
})

test('mapping detail differences include only changed properties', () => {
  assert.deepEqual(getMappingPropertyDifferences(
    { label: 'Coolant', units: 'degF', conversion: 'cToF', statusCardField: 'coolant' },
    { label: 'Engine Coolant Temperature', units: 'degF', conversion: 'cToF', quantity: 'temperature' },
  ), [
    { property: 'label', current: 'Coolant', source: 'Engine Coolant Temperature' },
    { property: 'quantity', current: undefined, source: 'temperature' },
    { property: 'statusCardField', current: 'coolant', source: undefined },
  ])
})

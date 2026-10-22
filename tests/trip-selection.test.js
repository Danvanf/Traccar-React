import test from 'node:test'
import assert from 'node:assert/strict'
import { isTripSelected, toggleTripSelection, toggleDaySelection } from '../src/lib/tripSelection.js'
const empty = () => ({ days: [], tripIds: [], excludedTripIds: [] })
const a = { tripId: 'a', dayKey: '2026-10-21' }
const b = { tripId: 'b', dayKey: '2026-10-21' }
const c = { tripId: 'c', dayKey: '2026-10-20' }
test('individual trip selection supports multiple days and toggling off', () => {
  let selection = toggleTripSelection(toggleTripSelection(empty(), a), c)
  assert.equal(isTripSelected(selection, a), true)
  assert.equal(isTripSelected(selection, b), false)
  assert.equal(isTripSelected(selection, c), true)
  selection = toggleTripSelection(selection, a)
  assert.equal(isTripSelected(selection, a), false)
  assert.equal(isTripSelected(selection, c), true)
})
test('whole-day selection can exclude and restore one trip without dropping siblings', () => {
  let selection = { ...empty(), days: [a.dayKey] }
  selection = toggleTripSelection(selection, a)
  assert.equal(isTripSelected(selection, a), false)
  assert.equal(isTripSelected(selection, b), true)
  selection = toggleTripSelection(selection, a)
  assert.equal(isTripSelected(selection, a), true)
  assert.equal(isTripSelected(selection, c), false)
})
test('overlapping day and trip selections produce one inclusion per trip', () => {
  const selection = { ...empty(), days: [a.dayKey], tripIds: [a.tripId, c.tripId] }
  assert.deepEqual([a, b, c].filter((trip) => isTripSelected(selection, trip)), [a, b, c])
})
test('day checkbox selects all from a partial selection and clears all on the next toggle', () => {
  let selection = toggleTripSelection(empty(), a)
  selection = toggleDaySelection(selection, a.dayKey, [a, b, c])
  assert.equal(isTripSelected(selection, b), true)
  selection = toggleTripSelection(selection, a)
  selection = toggleDaySelection(selection, a.dayKey, [a, b, c])
  assert.equal(isTripSelected(selection, a), true)
  selection = toggleDaySelection(selection, a.dayKey, [a, b, c])
  assert.equal(isTripSelected(selection, a), false)
  assert.equal(isTripSelected(selection, b), false)
})
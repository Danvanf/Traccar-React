import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestGate, readCurrentRequest } from '../src/lib/requestGate.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('new history refresh wins when an older summary finishes last', async () => {
  const gate = createRequestGate()
  const old = deferred()
  const pending = readCurrentRequest(gate, () => old.promise)
  gate.begin()
  assert.deepEqual(await readCurrentRequest(gate, async () => ['new']), { current: true, value: ['new'] })
  old.resolve(['old'])
  assert.deepEqual(await pending, { current: false })
})

test('partially completed history index cannot publish after a refresh', async () => {
  const gate = createRequestGate()
  const span = deferred(), months = deferred()
  const pending = readCurrentRequest(gate, () => Promise.all([span.promise, months.promise]))
  span.resolve({ tripCount: 1 })
  await Promise.resolve()
  gate.begin()
  months.resolve(['old month'])
  assert.deepEqual(await pending, { current: false })
})

test('late failure from old history cannot replace current success with an error', async () => {
  const gate = createRequestGate()
  const old = deferred()
  const pending = readCurrentRequest(gate, () => old.promise)
  gate.begin()
  assert.equal((await readCurrentRequest(gate, async () => 'loaded')).value, 'loaded')
  old.reject(new Error('old API failure'))
  assert.deepEqual(await pending, { current: false })
})

test('current history failures remain visible and a retry can succeed', async () => {
  const gate = createRequestGate()
  const error = new Error('API unavailable')
  await assert.rejects(readCurrentRequest(gate, async () => { throw error }), (caught) => caught === error)
  assert.deepEqual(await readCurrentRequest(gate, async () => []), { current: true, value: [] })
})
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDayLoadCache } from '../src/lib/dayLoadCache.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

// Model the app's points-arrived completion independently of later trip sync.
async function receivePoints(cache, request, response) {
  try {
    await response
    if (!cache.isCurrent(request)) return false
    return cache.complete(request)
  } catch {
    cache.fail(request)
    return false
  }
}

test('A to B to A switching accepts the newest response and ignores both older responses', async () => {
  const cache = createDayLoadCache()
  const firstA = deferred()
  const firstRequest = cache.reserve('2026-10-01')
  const firstResult = receivePoints(cache, firstRequest, firstA.promise)
  cache.invalidate()
  const b = deferred()
  const bRequest = cache.reserve('2026-10-02')
  const bResult = receivePoints(cache, bRequest, b.promise)
  cache.invalidate()
  const newestA = deferred()
  const newestRequest = cache.reserve('2026-10-01')
  assert.ok(newestRequest, 'returning to an unfinished day must fetch it again')
  const newestResult = receivePoints(cache, newestRequest, newestA.promise)
  firstA.resolve()
  b.resolve()
  assert.equal(await firstResult, false)
  assert.equal(await bResult, false)
  assert.equal(cache.reserve('2026-10-01'), null, 'the newest request remains pending')
  newestA.resolve()
  assert.equal(await newestResult, true)
  cache.invalidate()
  assert.equal(cache.reserve('2026-10-01'), null, 'successfully merged points remain cached')
  assert.ok(cache.reserve('2026-10-02'), 'the superseded day was never completed')
})

test('a late failure cannot release a newer request for the same day', async () => {
  const cache = createDayLoadCache()
  const oldResponse = deferred()
  const oldRequest = cache.reserve('2026-10-01')
  const oldResult = receivePoints(cache, oldRequest, oldResponse.promise)
  cache.invalidate()
  const currentRequest = cache.reserve('2026-10-01')
  oldResponse.reject(new Error('old network failure'))
  assert.equal(await oldResult, false)
  assert.equal(cache.reserve('2026-10-01'), null)
  assert.equal(cache.complete(currentRequest), true)
})

test('failure of one day does not evict another successfully loaded day in a multi-day selection', async () => {
  const cache = createDayLoadCache()
  const a = deferred()
  const b = deferred()
  const aResult = receivePoints(cache, cache.reserve('2026-10-01'), a.promise)
  const bResult = receivePoints(cache, cache.reserve('2026-10-02'), b.promise)
  b.resolve()
  assert.equal(await bResult, true)
  a.reject(new Error('day A failed'))
  assert.equal(await aResult, false)
  assert.ok(cache.reserve('2026-10-01'))
  assert.equal(cache.reserve('2026-10-02'), null)
})

test('startup range loads stay pending across selection changes and become cached only on arrival', () => {
  const loaded = new Set()
  const cache = createDayLoadCache(loaded)
  const background = cache.reserve('2026-10-01', { selection: false })
  assert.equal(loaded.has('2026-10-01'), false)
  cache.invalidate()
  assert.equal(cache.reserve('2026-10-01'), null, 'do not duplicate an in-flight startup range')
  assert.equal(cache.complete(background), true)
  assert.equal(loaded.has('2026-10-01'), true)
})

test('a failed startup range is retryable without discarding successful days', () => {
  const cache = createDayLoadCache(new Set(['2026-10-01']))
  const pending = cache.reserve('2026-10-02', { selection: false })
  assert.equal(cache.fail(pending), true)
  assert.ok(cache.reserve('2026-10-02'))
  assert.equal(cache.reserve('2026-10-01'), null)
})

test('a later synchronization failure does not invalidate points that already arrived', () => {
  const cache = createDayLoadCache()
  const request = cache.reserve('2026-10-01')
  assert.equal(cache.complete(request), true)
  assert.equal(cache.fail(request), false)
  assert.equal(cache.reserve('2026-10-01'), null)
})
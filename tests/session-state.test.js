import test from 'node:test'
import assert from 'node:assert/strict'
import { createTraccarApi } from '../src/lib/traccarApi.js'

test('expired-session response reports authentication failure and a fresh session recovers', async (t) => {
  const states = []
  const replies = [
    new Response('Authentication required', { status: 401, statusText: 'Unauthorized' }),
    Response.json([{ id: 1, name: 'Permitted test device' }]),
  ]
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.credentials, 'include')
    return replies.shift()
  })
  const api = createTraccarApi({ settings: {}, onSessionStateChange: (state) => states.push(state) })
  await assert.rejects(api('/devices'), /HTTP 401.*Authentication required/)
  assert.deepEqual(states, ['failed'])
  assert.deepEqual(await api('/devices'), [{ id: 1, name: 'Permitted test device' }])
  assert.deepEqual(states, ['failed', 'ok'])
})

test('permission denial stays distinct from expired authentication and empty success', async (t) => {
  const states = []
  t.mock.method(globalThis, 'fetch', async () => new Response('Access denied', { status: 403, statusText: 'Forbidden' }))
  const api = createTraccarApi({ settings: {}, onSessionStateChange: (state) => states.push(state) })
  await assert.rejects(api('/devices'), /HTTP 403.*Access denied/)
  assert.deepEqual(states, [])
})
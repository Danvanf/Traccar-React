import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteTelemetryProfile, fetchTelemetryProfileHistory, fetchTelemetryProfileRevisions, upsertTelemetryProfile } from '../src/lib/vehicleAppApi.js'

test('shared profile writes require and send the expected revision', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return Response.json({ id: 'profile-a', revision: 3 })
  }

  await assert.rejects(upsertTelemetryProfile('/vehicle-api', { id: 'profile-a' }), /current shared profile revision/)
  const result = await upsertTelemetryProfile('/vehicle-api', { id: 'profile-a', name: 'Profile' }, 2, 'documented-auto')

  assert.equal(result.revision, 3)
  assert.equal(calls[0].options.headers['If-Match'], '"2"')
  assert.equal(JSON.parse(calls[0].options.body).changeKind, 'documented-auto')
})

test('revision reads and deletes target the requested profile revision', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json([{ revision: 2 }])
  }

  const revisions = await fetchTelemetryProfileRevisions('/vehicle-api', 'profile-a')
  await deleteTelemetryProfile('/vehicle-api', 'profile-a', 2)

  assert.equal(revisions[0].revision, 2)
  assert.match(calls[0].url, /profile-a\/revisions$/)
  assert.equal(calls[1].options.headers['If-Match'], '"2"')
  await assert.rejects(deleteTelemetryProfile('/vehicle-api', 'profile-a'), /current shared profile revision/)
})

test('shared profile history reads use the account-wide effective-time endpoint', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return Response.json([{ id: 'profile-a', revision: 2, effectiveAt: '2026-10-16T12:00:00Z' }])
  }

  const revisions = await fetchTelemetryProfileHistory('/vehicle-api')

  assert.equal(revisions[0].revision, 2)
  assert.match(calls[0].url, /\/api\/telemetry-profiles\/history$/)
  assert.equal(calls[0].options.headers.Accept, 'application/json')
})

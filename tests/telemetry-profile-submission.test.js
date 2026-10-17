import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTelemetryProfileSubmissionDraft,
  collectTelemetryPositionFields,
  selectTelemetryPositions,
} from '../src/lib/telemetryProfileSubmission.js'

const base = {
  profile: {
    id: 'teltonika-fmm00a',
    name: 'Teltonika FMM00A',
    attributeMap: { engineLoad: { label: 'Engine Load' }, imei: { label: 'IMEI' } },
  },
  fromDate: '2026-10-14',
  throughDate: '2026-10-14',
  positions: [{
    id: 7,
    deviceId: 21,
    latitude: 40.1,
    longitude: -74.2,
    address: '123 Example Road',
    formattedAddress: '123 Example Road',
    attributes: {
      engineLoad: 52,
      vin: 'SYNTHETIC_VIN',
      tripTagName: 'SYNTHETIC_TRIP_TAG',
      io12: 1,
      nested: { trackerMac: 'SYNTHETIC_MAC', status: true },
    },
  }],
}

test('submission includes every telemetry field by default and states its use', () => {
  const draft = buildTelemetryProfileSubmissionDraft(base)

  assert.match(draft.subject, /^Traccar React:/)
  assert.equal(draft.to, 'support@rvthinker.com')
  assert.equal(draft.request.excludedPositionFields.length, 0)
  assert.equal(draft.request.positions[0].latitude, 40.1)
  assert.equal(draft.request.positions[0].attributes.vin, 'SYNTHETIC_VIN')
  assert.equal(draft.request.positions[0].attributes.tripTagName, 'SYNTHETIC_TRIP_TAG')
  assert.equal(draft.request.positions[0].attributes.nested.trackerMac, 'SYNTHETIC_MAC')
  assert.match(draft.body, /all available fields are included/i)
  assert.match(draft.body, /only to create or update shared device profiles/i)
  assert.deepEqual(draft.request.profile.attributeMap, {
    engineLoad: { label: 'Engine Load' },
    imei: { label: 'IMEI' },
  })
})

test('field switches list nested paths and remove only fields switched off', () => {
  const fields = collectTelemetryPositionFields(base.positions)
  assert.ok(fields.some((field) => field.path === '/attributes/vin' && field.label === 'attributes › vin'))
  assert.ok(fields.some((field) => field.path === '/attributes/nested/trackerMac'))

  const excluded = ['/latitude', '/attributes/vin', '/attributes/nested/trackerMac']
  const draft = buildTelemetryProfileSubmissionDraft({ ...base, excludedPositionFields: excluded })
  const point = draft.request.positions[0]

  assert.equal(draft.request.positions.length, 1)
  assert.equal(point.latitude, undefined)
  assert.equal(point.longitude, -74.2)
  assert.equal(point.attributes.vin, undefined)
  assert.equal(point.attributes.nested.trackerMac, undefined)
  assert.equal(point.attributes.nested.status, true)
  assert.deepEqual(draft.request.excludedPositionFields, excluded)
  assert.match(draft.body, /3 field paths excluded by the user/i)
})

test('field filtering preserves point count and supports fields nested in arrays', () => {
  const positions = [{ id: 1, samples: [{ name: 'load', value: 52 }, { name: 'temp', value: 88 }] }]
  const filtered = selectTelemetryPositions(positions, ['/samples/*/name'])

  assert.equal(filtered.length, 1)
  assert.deepEqual(filtered[0].samples, [{ value: 52 }, { value: 88 }])
})

test('complete date-range data is retained without downsampling', () => {
  const points = Array.from({ length: 22115 }, (_, id) => ({ id, attributes: { engineLoad: id % 100 } }))
  const draft = buildTelemetryProfileSubmissionDraft({
    profile: { id: 'teltonika-fmm00a', name: 'Teltonika FMM00A', attributeMap: {} },
    fromDate: '2026-10-08',
    throughDate: '2026-10-14',
    positions: points,
  })
  assert.equal(draft.request.positions.length, 22115)
  assert.equal(draft.request.totalPointCount, 22115)
  assert.equal(draft.request.positions[0].id, 0)
  assert.match(draft.body, /22,115 of 22,115; every point returned for this range is included/)
})

test('submitter details are included only when the user opts in', () => {
  const contactBase = {
    ...base,
    contactName: 'Dana Driver',
    contactEmail: 'dana@example.com',
  }
  const excluded = buildTelemetryProfileSubmissionDraft(contactBase)
  assert.doesNotMatch(excluded.body, /Dana Driver|dana@example\.com/)
  assert.equal(excluded.request.includeSenderDetails, false)

  const included = buildTelemetryProfileSubmissionDraft({ ...contactBase, includeSenderDetails: true })
  assert.match(included.body, /Dana Driver <dana@example\.com>/)
  assert.equal(included.request.includeSenderDetails, true)
})

test('a freshly built draft reflects profile and note edits made after gathering', () => {
  const updated = buildTelemetryProfileSubmissionDraft({
    ...base,
    profile: { ...base.profile, name: 'Updated FMM00A profile', attributeMap: { engineLoad: { label: 'Updated engine load' } } },
    note: 'Updated after gathering',
  })

  assert.match(updated.subject, /Updated FMM00A profile/)
  assert.match(updated.body, /Updated after gathering/)
  assert.deepEqual(updated.request.profile.attributeMap, { engineLoad: { label: 'Updated engine load' } })
})

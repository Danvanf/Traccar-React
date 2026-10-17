export const TELEMETRY_PROFILE_SUPPORT_EMAIL = 'support@rvthinker.com'
export const TELEMETRY_PROFILE_SUBMISSION_SUBJECT_PREFIX = 'Traccar React:'
export const TELEMETRY_PROFILE_MAX_RANGE_DAYS = 14

export function cloneTelemetryProfile(profile) {
  const attributeMap = profile?.attributeMap && typeof profile.attributeMap === 'object' && !Array.isArray(profile.attributeMap)
    ? JSON.parse(JSON.stringify(profile.attributeMap))
    : {}
  return {
    id: String(profile?.id || ''),
    name: String(profile?.name || ''),
    schemaVersion: Number.isInteger(profile?.schemaVersion) ? profile.schemaVersion : 1,
    isDraft: Boolean(profile?.isDraft),
    attributeMap,
  }
}

function encodePointerSegment(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1')
}

function pathPointer(segments) {
  return '/' + segments.map(encodePointerSegment).join('/')
}

function collectLeafPaths(value, segments, paths) {
  if (Array.isArray(value)) {
    if (value.length === 0 && segments.length) paths.add(pathPointer(segments))
    for (const entry of value) collectLeafPaths(entry, [...segments, '*'], paths)
    return
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0 && segments.length) paths.add(pathPointer(segments))
    for (const [key, entry] of entries) collectLeafPaths(entry, [...segments, key], paths)
    return
  }
  if (segments.length) paths.add(pathPointer(segments))
}

function displayPointer(path) {
  return path.split('/').slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((segment) => segment === '*' ? '[]' : segment)
    .join(' › ')
}

export function collectTelemetryPositionFields(positions) {
  if (!Array.isArray(positions)) return []
  const paths = new Set()
  for (const position of positions) collectLeafPaths(position, [], paths)
  return Array.from(paths, (path) => ({ path, label: displayPointer(path) }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function selectTelemetryPositions(positions, excludedPositionFields = []) {
  if (!Array.isArray(positions)) return []
  const excluded = new Set(Array.isArray(excludedPositionFields) ? excludedPositionFields : [])
  const filterFields = (value, segments) => {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        const itemSegments = [...segments, '*']
        return excluded.has(pathPointer(itemSegments)) ? null : filterFields(entry, itemSegments)
      })
    }
    if (value && typeof value === 'object') {
      const result = {}
      for (const [key, entry] of Object.entries(value)) {
        const entrySegments = [...segments, key]
        const entryPath = pathPointer(entrySegments)
        if (excluded.has(entryPath) || (Array.isArray(entry) && excluded.has(pathPointer([...entrySegments, '*'])))) continue
        result[key] = filterFields(entry, entrySegments)
      }
      return result
    }
    return value
  }
  return positions.map((position) => filterFields(position, []))
}

export function buildTelemetryProfileSubmissionDraft({
  profile,
  fromDate,
  throughDate,
  positions,
  excludedPositionFields = [],
  includeSenderDetails = false,
  contactName = '',
  contactEmail = '',
  note = '',
}) {
  const safeProfile = cloneTelemetryProfile(profile)
  const excludedFields = Array.from(new Set(Array.isArray(excludedPositionFields) ? excludedPositionFields : []))
  const selectedPositions = selectTelemetryPositions(positions, excludedFields)
  const start = String(fromDate || '')
  const end = String(throughDate || '')
  const dateRange = start + ' through ' + end
  const subjectName = safeProfile.name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 100) || safeProfile.id || 'profile'
  const subject = TELEMETRY_PROFILE_SUBMISSION_SUBJECT_PREFIX + ' Profile review - ' + subjectName + ' (' + start + ' to ' + end + ')'
  const fileSlug = safeProfile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/g, '') || 'device-profile'
  const fileName = 'telemetry-profile-' + fileSlug + '-' + start + '-to-' + end + '.zip'
  const safeContactName = includeSenderDetails ? String(contactName || '').trim().slice(0, 200) : ''
  const safeContactEmail = includeSenderDetails ? String(contactEmail || '').trim().slice(0, 320) : ''
  const payload = {
    profile: safeProfile,
    dateRange: { from: start, through: end },
    pointCount: selectedPositions.length,
    totalPointCount: selectedPositions.length,
    excludedPositionFields: excludedFields,
    allTelemetryFieldsIncluded: excludedFields.length === 0,
    submittedBy: safeContactName && safeContactEmail ? { name: safeContactName, email: safeContactEmail } : null,
    note: String(note || '').trim(),
  }
  const body = [
    'A user is suggesting this device protocol profile for review.',
    'Tracking point range: ' + dateRange + ' (dates inclusive).',
    'Tracking points included: ' + payload.pointCount.toLocaleString('en-US') + ' of ' + payload.totalPointCount.toLocaleString('en-US') + '; every point returned for this range is included.',
    excludedFields.length === 0
      ? 'Telemetry fields: all available fields are included.'
      : 'Telemetry fields: ' + excludedFields.length.toLocaleString('en-US') + ' field paths excluded by the user; see excludedPositionFields in the ZIP.',
    'Use: support will use this information only to create or update shared device profiles.',
    payload.submittedBy ? 'Submitted by: ' + payload.submittedBy.name + ' <' + payload.submittedBy.email + '>' : 'Submitter name and email: excluded or unavailable.',
    payload.note ? 'User note: ' + payload.note : 'User note: (none).',
    '',
    'The proposed profile and selected tracking data are attached as ' + fileName + '. Extract submission.json to review the data.',
  ].join('\n')

  return {
    to: TELEMETRY_PROFILE_SUPPORT_EMAIL,
    subject,
    body,
    request: {
      profile: safeProfile,
      fromDate: start,
      throughDate: end,
      positions: selectedPositions,
      totalPointCount: selectedPositions.length,
      excludedPositionFields: excludedFields,
      note: payload.note,
      includeSenderDetails: Boolean(includeSenderDetails && payload.submittedBy),
    },
    fileName,
  }
}

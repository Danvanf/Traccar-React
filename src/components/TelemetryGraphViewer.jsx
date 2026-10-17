import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { hasMeaningfulTelemetryValue, isTelemetryPlaceholderValue } from '../lib/telemetry'
import { buildCsvText, buildTelemetryCsv, buildTrackMetadata, buildTrackTimingCsv, downloadTextFile } from '../lib/csvExport'
import { translateAttribute, validateAttributeMap } from '../lib/carProfiles'
import { classifyTelemetryField, findRelatedProfileSuggestions, telemetryDeviceMatchContext } from '../lib/telemetryDiscovery'
import { findBundledAutomaticFieldMatch, findBundledFieldSuggestions } from '../lib/telemetryFieldCatalog'
import { hasDismissedSuggestions, isSuggestionDismissed, legacyTelemetryFieldScopeKey, telemetryFieldScopeKey } from '../lib/telemetryFieldScope'
import { groupsMissingTelemetryAttributes, mergeFetchedTelemetryGroups, summarizeUnplottedTelemetryFields } from '../lib/telemetryGraphData.js'
import TelemetryFieldEditor from './TelemetryFieldEditor'
import { fetchTelemetrySourceMappings, fetchUserPreference, saveTelemetrySourceMapping, saveUserPreference } from '../lib/vehicleAppApi'
import { appendSourceMappingRevision, createSourceMappingProfileResolver, sourceMappingUndoTarget } from '../lib/telemetrySourceMappings'

const SPEED_KEY = '__speedMph'

function sourceKeyForGroup(group) {
  return group?.deviceId == null
    ? `group:${group?.id ?? group?.profileContext?.profileId ?? 'unknown'}`
    : `device:${String(group.deviceId)}`
}

function graphSeriesId(sourceKey, fieldKey) {
  return JSON.stringify([sourceKey, fieldKey])
}

function parseGraphSeriesId(value) {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { sourceKey: parsed[0], fieldKey: parsed[1] }
    }
  } catch { /* legacy saved field key */ }
  return { sourceKey: null, fieldKey: value }
}

// Deliberately excluded from the graph for now. Keep this list explicit so
// future telemetry additions can be reviewed before becoming graph series.
const IGNORED_TELEMETRY_KEYS = new Set([
  'hours', 'engineHours',
  'event', 'eventId',
  'distance', 'segmentDistance',
  'odometer',
])

const TELEMETRY_SERIES_COLORS = ['#35b7aa', '#f6bd60', '#9b5de5', '#ef476f', '#5dade2', '#8bd450']

function defaultColorForKey(key) {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0
  return TELEMETRY_SERIES_COLORS[Math.abs(hash) % TELEMETRY_SERIES_COLORS.length]
}

function loadSeriesColors() {
  try {
    const parsed = JSON.parse(localStorage.getItem('traccarTelemetryGraphColors') || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function asPoint(value) {
  if (Array.isArray(value)) {
    const [latitude, longitude, metadata = {}] = value
    return { ...metadata, latitude: Number(latitude), longitude: Number(longitude), timestamp: metadata.timestamp instanceof Date ? metadata.timestamp : new Date(metadata.timestamp) }
  }
  return { ...value, timestamp: value.timestamp instanceof Date ? value.timestamp : new Date(value.timestamp) }
}

function numericValue(point, key, profile) {
  if (key === SPEED_KEY) {
    const factor = profile?.unitSystem === 'metric' ? 1.609344 : 1
    if (Number.isFinite(Number(point.attributes?.[SPEED_KEY]))) return Number(point.attributes[SPEED_KEY]) * factor
    if (Number.isFinite(Number(point.speedMph))) return Number(point.speedMph) * factor
    return Number.isFinite(Number(point.speed)) ? Number(point.speed) * (profile?.unitSystem === 'metric' ? 1.852 : 1.150779) : null
  }
  const raw = point.attributes?.[key]
  if (raw === undefined || raw === null || raw === '' || typeof raw === 'boolean') return null
  if (isTelemetryPlaceholderValue(key, raw, profile)) return null
  const translated = translateAttribute(profile, key, raw)
  if (['missing', 'invalid', 'sentinel'].includes(translated.status)) return null
  const number = Number(translated.value)
  return Number.isFinite(number) ? number : null
}

function labelFor(key, profile, displayScale = 1) {
  if (key === SPEED_KEY) return `Speed (${profile?.unitSystem === 'metric' ? 'km/h' : 'mph'})`
  const base = (profile?.getAttributeHeader(key)?.replace(/\s*\[attr_[^\]]+\]$/, '') || `Unmapped ${key}`)
    .replace(/\s*÷\s*\d+(?:\.\d+)?\b/g, '')
  return displayScale < 1 ? `${base} ÷${Math.round(1 / displayScale)}` : base
}

function legendLabelFor(key, profile, displayScale = 1) {
  return labelFor(key, profile, displayScale)
    .replace(/\s*\(AVL\s+\d+,\s*([^)]*)\)/gi, ' $1')
    .replace(/\(([^)]*)\)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return ''
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2)
}

function nearestTimestampPoint(points, timestamp) {
  if (!points?.length) return null
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle].timestamp < timestamp) low = middle + 1
    else high = middle
  }
  const next = points[low]
  const previous = points[Math.max(0, low - 1)]
  return Math.abs(next.timestamp - timestamp) < Math.abs(previous.timestamp - timestamp) ? next : previous
}

function distanceMetersBetween(latitudeA, longitudeA, latitudeB, longitudeB) {
  const earthRadius = 6371000
  const toRadians = (value) => (value * Math.PI) / 180
  const dLat = toRadians(latitudeB - latitudeA)
  const dLon = toRadians(longitudeB - longitudeA)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(dLon / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function addNamedPlaceMarkers(points, namedPlaces, groups, fallbackVehicleId = null) {
  if (!namedPlaces?.length) return points
  const annotated = points.map((point) => {
    const group = groups[point.__groupIndex]
    const vehicleId = group?.vehicleId || fallbackVehicleId
    const matches = namedPlaces
      .filter((place) => (!place.vehicleId || !vehicleId || String(place.vehicleId) === String(vehicleId)) && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)))
      .map((place) => ({ place, distance: distanceMetersBetween(Number(point.latitude), Number(point.longitude), Number(place.latitude), Number(place.longitude)) }))
      .filter(({ place, distance }) => distance <= Math.max(1, Number(place.radiusMeters) || 1))
      .sort((a, b) => a.distance - b.distance)
    const namedMatch = (place) => {
      const name = String(place.name || '').trim()
      const track = String(place.trackName || '').trim()
      return { name: track ? `${track} / ${name}` : name, track, role: place.placeType || 'general' }
    }
    const placeMatches = matches.map(({ place }) => namedMatch(place)).filter(({ name }) => name)
    return { ...point, placeName: placeMatches.map(({ name }) => name).join('; '), placeTrack: [...new Set(placeMatches.map(({ track }) => track).filter(Boolean))].join('; '), placeRole: [...new Set(placeMatches.map(({ role }) => role).filter(Boolean))].join('; '), __placeMatches: placeMatches }
  })
  const eventsByIndex = new Map()
  const appendEvent = (index, event) => eventsByIndex.set(index, [...(eventsByIndex.get(index) || []), event])
  const groupIndexes = new Map()
  annotated.forEach((point, index) => groupIndexes.set(point.__groupIndex, [...(groupIndexes.get(point.__groupIndex) || []), index]))
  groupIndexes.forEach((indexes) => {
    const placeNames = new Set(indexes.flatMap((index) => annotated[index].__placeMatches.map((match) => match.name)))
    placeNames.forEach((placeName) => {
      let run = []
      const finishRun = () => {
        if (!run.length) return
        const middleTime = (run[0].timestamp.getTime() + run.at(-1).timestamp.getTime()) / 2
        const representative = run.reduce((closest, point) => Math.abs(point.timestamp.getTime() - middleTime) < Math.abs(closest.timestamp.getTime() - middleTime) ? point : closest, run[0])
        const role = representative.__placeMatches.find((match) => match.name === placeName)?.role || 'general'
        appendEvent(representative.__index, `enter:${role}:${placeName}`)
        const nextIndex = indexes[indexes.indexOf(run.at(-1).__index) + 1]
        if (nextIndex != null) appendEvent(nextIndex, `exit:${role}:${placeName}`)
        run = []
      }
      indexes.forEach((index) => {
        if (annotated[index].__placeMatches.some((match) => match.name === placeName)) run.push({ ...annotated[index], __index: index })
        else finishRun()
      })
      finishRun()
    })
  })
  return annotated.map((point, index) => {
    const { __placeMatches, ...cleanPoint } = point
    return { ...cleanPoint, placeEvent: (eventsByIndex.get(index) || []).join('; ') }
  })
}

function formatElapsedMinutes(value) {
  if (!Number.isFinite(value)) return '0 min'
  return `${Math.round(Math.max(0, value))} min`
}

function localDateTimeValue(value) {
  const date = new Date(value)
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultShareExpiration() {
  const date = new Date()
  date.setMonth(date.getMonth() + 1)
  date.setHours(23, 59, 0, 0)
  return localDateTimeValue(date)
}

function displayScaleFor(values) {
  const magnitude = Math.max(...values.map((value) => Math.abs(value)), 0)
  if (magnitude >= 1000) return 0.001
  if (magnitude >= 100) return 0.01
  if (magnitude >= 10) return 0.1
  return 1
}

function TelemetryGraphViewer({ groups: initialGroups, profile = null, title = 'Telemetry Graph', onClose, publicMode = false, vehicleMetadata = null, deviceMetadata = null, deviceMetadataList = [], vehicleMetadataList = [], traccarServerVersion = '', fetchGpsPositions = null, namedPlaces = [], profileOptions = [], profileVehicleCounts = {}, userName = '', isAuthenticated = false, canEditSharedProfiles = false, vehicleApiBaseUrl = '', onSaveSharedMapping = null, onSourceMappingSaved = null, resolvePointProfileContext = null }) {
  const [telemetryFetchState, setTelemetryFetchState] = useState(null)
  const [sourceMappingState, setSourceMappingState] = useState({})
  const [sourceMappingLoadedKey, setSourceMappingLoadedKey] = useState('')
  const [automaticMappingStatus, setAutomaticMappingStatus] = useState('')
  const automaticMappingAttempts = useRef(new Set())
  const hydrationResult = telemetryFetchState?.sourceGroups === initialGroups ? telemetryFetchState : null
  const hydratedGroups = hydrationResult?.groups || null
  const graphDataLoading = Boolean(fetchGpsPositions
    && groupsMissingTelemetryAttributes(initialGroups).length > 0
    && !hydrationResult)
  const graphDataError = hydrationResult?.error || ''
  const groups = hydratedGroups || initialGroups

  const sourceMappingDeviceIds = useMemo(() => [...new Set(initialGroups.map((group) => Number(group.deviceId)).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b), [initialGroups])
  const sourceMappingDeviceKey = sourceMappingDeviceIds.join(',')

  useEffect(() => {
    if (publicMode || !vehicleApiBaseUrl || !sourceMappingDeviceIds.length) return undefined
    let active = true
    Promise.all(sourceMappingDeviceIds.map(async (deviceId) => [deviceId, await fetchTelemetrySourceMappings(vehicleApiBaseUrl, deviceId)]))
      .then((entries) => {
        if (!active) return
        setSourceMappingState(Object.fromEntries(entries))
        setSourceMappingLoadedKey(sourceMappingDeviceKey)
      })
      .catch(() => {
        if (active) {
          setSourceMappingState({})
          setSourceMappingLoadedKey('')
        }
      })
    return () => { active = false }
  }, [initialGroups, publicMode, sourceMappingDeviceIds, sourceMappingDeviceKey, vehicleApiBaseUrl])

  useEffect(() => {
    let active = true
    const groupsNeedingTelemetry = groupsMissingTelemetryAttributes(initialGroups)
    if (!fetchGpsPositions || groupsNeedingTelemetry.length === 0) return () => { active = false }
    fetchGpsPositions(groupsNeedingTelemetry).then((batches) => {
      if (!active) return
      setTelemetryFetchState({ sourceGroups: initialGroups, groups: mergeFetchedTelemetryGroups(initialGroups, batches), error: '' })
    }).catch((error) => {
      if (active) setTelemetryFetchState({
        sourceGroups: initialGroups,
        groups: initialGroups,
        error: error instanceof Error ? error.message : 'Unable to load full telemetry points.',
      })
    })

    return () => { active = false }
  }, [fetchGpsPositions, initialGroups])

  const points = useMemo(() => groups.flatMap((group, groupIndex) => group.points.map((value, pointIndex) => ({ ...asPoint(value), __groupIndex: groupIndex, __groupPointIndex: pointIndex }))).filter((point) => !Number.isNaN(point.timestamp?.getTime?.())).sort((a, b) => a.timestamp - b.timestamp), [groups])
  const sourceProfileResolvers = useMemo(() => groups.map((group) => {
    const revisions = sourceMappingState[Number(group?.deviceId)] || []
    const resolverByProfile = new Map()
    return (timestamp, point) => {
      const resolved = resolvePointProfileContext?.(group, timestamp)
      const baseProfile = resolved?.profile || (group?.profileContext ? group.profileContext.profile : profile)
      if (!baseProfile) return profile
      const key = `${baseProfile.id || baseProfile.name || 'profile'}@${resolved?.profileRevision ?? 'current'}`
      if (!resolverByProfile.has(key)) resolverByProfile.set(key, createSourceMappingProfileResolver(baseProfile, revisions))
      return resolverByProfile.get(key)(timestamp)
    }
  }), [groups, profile, resolvePointProfileContext, sourceMappingState])
  const profileForPoint = (point) => {
    return sourceProfileResolvers[point.__groupIndex]?.(point.timestamp, point) || profile
  }
  // A trip window can cross a historical profile assignment boundary. Resolve
  // every point's assignment before deciding whether combined exports/shares
  // can safely use a single profile context.
  const profileIds = [...new Set(points.map((point) => {
    const group = groups[point.__groupIndex]
    const resolved = resolvePointProfileContext?.(group, point.timestamp)
    const profileId = resolved?.profile?.id ?? resolved?.profileId ?? (resolved?.status === 'none' ? '(none)' : '(unresolved)')
    return `${profileId}@${resolved?.profileRevision ?? 'current'}`
  }))]
  const mixedProfiles = profileIds.length > 1
  const firstPoint = points[0]
  const displayProfile = firstPoint ? profileForPoint(firstPoint) : (groups[0]?.profileContext ? groups[0].profileContext.profile : profile)
  const ignoredTelemetryLabels = [...IGNORED_TELEMETRY_KEYS]
    .map((key) => displayProfile?.getAttributeInfo?.(key)?.label)
    .filter(Boolean)
    .join(', ')
  const hasMissingProfileDefinition = groups.some((group) => group.profileContext?.status === 'missing-definition')
  const hasUnassignedProfile = groups.some((group) => ['none', 'unbound'].includes(group.profileContext?.status))
  const availableKeys = useMemo(() => {
    const entries = new Map()
    groups.forEach((group, groupIndex) => group.points.forEach((value) => {
      const point = asPoint(value)
      const sourceKey = sourceKeyForGroup(group)
      Object.keys(point.attributes || {}).forEach((key) => entries.set(graphSeriesId(sourceKey, key), { sourceKey, fieldKey: key, groupIndex }))
      if (Number.isFinite(Number(point.speedMph)) || Number.isFinite(Number(point.speed))) entries.set(graphSeriesId(sourceKey, SPEED_KEY), { sourceKey, fieldKey: SPEED_KEY, groupIndex })
    }))
    return [...entries.entries()].filter(([, entry]) => {
      const { fieldKey, sourceKey } = entry
      if (IGNORED_TELEMETRY_KEYS.has(fieldKey)) return false
      const meaningfulValues = points.filter((point) => sourceKeyForGroup(groups[point.__groupIndex]) === sourceKey).filter((point) => {
        const value = numericValue(point, fieldKey, profileForPoint(point))
        return value !== null && hasMeaningfulTelemetryValue([value], fieldKey, profileForPoint(point))
      })
      return meaningfulValues.length > 0
    }).map(([seriesId]) => seriesId).sort((left, right) => {
      const leftEntry = parseGraphSeriesId(left)
      const rightEntry = parseGraphSeriesId(right)
      const leftGroup = groups.find((group) => sourceKeyForGroup(group) === leftEntry.sourceKey)
      const rightGroup = groups.find((group) => sourceKeyForGroup(group) === rightEntry.sourceKey)
      const leftLabel = labelFor(leftEntry.fieldKey, leftGroup?.profileContext?.profile || displayProfile)
      const rightLabel = labelFor(rightEntry.fieldKey, rightGroup?.profileContext?.profile || displayProfile)
      return leftLabel.localeCompare(rightLabel) || leftEntry.sourceKey.localeCompare(rightEntry.sourceKey)
    })
  }, [groups, points, profile, sourceMappingState])
  const unplottedFields = useMemo(() => summarizeUnplottedTelemetryFields(
    groups,
    availableKeys,
    IGNORED_TELEMETRY_KEYS,
  ), [availableKeys, groups])
  const [selectedKeys, setSelectedKeys] = useState([])
  const [seriesColors, setSeriesColors] = useState(loadSeriesColors)
  const [independentScale, setIndependentScale] = useState(false)
  const [autoScale, setAutoScale] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [viewRange, setViewRange] = useState({ start: 0, end: 1 })
  const [dragRange, setDragRange] = useState(null)
  const [valueCursorRatio, setValueCursorRatio] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareTitle, setShareTitle] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const [shareMode] = useState('graph')
  const [allowExport, setAllowExport] = useState(false)
  const [shareAllSensors, setShareAllSensors] = useState(false)
  const [shareExpiresAt, setShareExpiresAt] = useState(defaultShareExpiration)
  const [shareStatus, setShareStatus] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [shares, setShares] = useState([])
  const [editingExpiration, setEditingExpiration] = useState(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [preparedExport, setPreparedExport] = useState(null)
  const [editingFieldKey, setEditingFieldKey] = useState(null)
  const [editingSourceKey, setEditingSourceKey] = useState(null)
  const [fieldReviewFilter, setFieldReviewFilter] = useState('all')
  const [personalFieldLabels, setPersonalFieldLabels] = useState({})
  const [dismissedSuggestionTokens, setDismissedSuggestionTokens] = useState([])
  const fieldTargetRefs = useRef({})
  const previousEditingFieldKey = useRef(null)
  const plotWrapRef = useRef(null)
  const pendingScrollRatio = useRef(null)
  const preferenceKey = `traccarTelemetryGraphSeries:${profile?.id || profile?.name || 'default'}`
  const personalLabelsStorageKey = `vehicleApp:telemetry-field-labels:${userName.trim().toLocaleLowerCase() || 'local'}`
  const dismissedSuggestionsStorageKey = `vehicleApp:telemetry-field-suggestions-dismissed:${userName.trim().toLocaleLowerCase() || 'local'}`
  const loadedPreferenceKey = useRef('')

  useEffect(() => {
    if (previousEditingFieldKey.current && !editingFieldKey) fieldTargetRefs.current[previousEditingFieldKey.current]?.focus()
    if (editingFieldKey) previousEditingFieldKey.current = editingSourceKey ? graphSeriesId(editingSourceKey, editingFieldKey) : editingFieldKey
  }, [editingFieldKey, editingSourceKey])

  useEffect(() => {
    let active = true
    let localLabels = {}
    let localDismissals = []
    try {
      const saved = JSON.parse(localStorage.getItem(personalLabelsStorageKey) || '{}')
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) localLabels = saved
    } catch { /* keep labels empty */ }
    try {
      const saved = JSON.parse(localStorage.getItem(dismissedSuggestionsStorageKey) || '[]')
      if (Array.isArray(saved)) localDismissals = saved.filter((item) => typeof item === 'string')
    } catch { /* keep suggestions visible */ }
    setPersonalFieldLabels(localLabels)
    setDismissedSuggestionTokens(localDismissals)
    if (isAuthenticated && vehicleApiBaseUrl) {
      Promise.all([
        fetchUserPreference(vehicleApiBaseUrl, 'telemetry-field-labels').catch(() => null),
        fetchUserPreference(vehicleApiBaseUrl, 'telemetry-field-suggestions-dismissed').catch(() => null),
      ]).then(([savedLabels, savedDismissals]) => {
        if (!active) return
        if (savedLabels && typeof savedLabels === 'object' && !Array.isArray(savedLabels)) {
          const merged = { ...localLabels, ...savedLabels }
          setPersonalFieldLabels(merged)
          localStorage.setItem(personalLabelsStorageKey, JSON.stringify(merged))
        }
        if (Array.isArray(savedDismissals)) {
          const merged = [...new Set([...localDismissals, ...savedDismissals.filter((item) => typeof item === 'string')])]
          setDismissedSuggestionTokens(merged)
          localStorage.setItem(dismissedSuggestionsStorageKey, JSON.stringify(merged))
        }
      })
    }
    return () => { active = false }
  }, [dismissedSuggestionsStorageKey, isAuthenticated, personalLabelsStorageKey, vehicleApiBaseUrl])

  useEffect(() => {
    if (loadedPreferenceKey.current !== preferenceKey) {
      let saved = []
      try {
        const parsed = JSON.parse(localStorage.getItem(preferenceKey) || '[]')
        if (Array.isArray(parsed)) saved = parsed
      } catch { /* use defaults when browser storage is unavailable */ }
      const restored = saved.flatMap((key) => availableKeys.includes(key)
        ? [key]
        : availableKeys.filter((id) => parseGraphSeriesId(id).fieldKey === key))
      setSelectedKeys([...new Set(restored)].slice(0, 12))
      loadedPreferenceKey.current = preferenceKey
      return
    }
    setSelectedKeys((current) => {
      if (current.length === 0) return availableKeys.slice(0, 3)
      return current.filter((key) => availableKeys.includes(key))
    })
  }, [availableKeys, preferenceKey])

  useEffect(() => {
    if (loadedPreferenceKey.current !== preferenceKey) return
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(selectedKeys))
    } catch { /* browser storage is optional */ }
  }, [preferenceKey, selectedKeys])

  useEffect(() => {
    try {
      localStorage.setItem('traccarTelemetryGraphColors', JSON.stringify(seriesColors))
    } catch { /* use defaults when browser storage is unavailable */ }
  }, [seriesColors])

  useEffect(() => {
    setViewRange({ start: 0, end: 1 })
    setDragRange(null)
    pendingScrollRatio.current = null
  }, [groups])

  useLayoutEffect(() => {
    const ratio = pendingScrollRatio.current
    const wrapper = plotWrapRef.current
    if (ratio == null || !wrapper) return
    const scrollableWidth = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth)
    const target = left + ratio * innerWidth
    wrapper.scrollLeft = Math.max(0, Math.min(scrollableWidth, target - 30))
    pendingScrollRatio.current = null
  }, [zoom])

  const series = useMemo(() => selectedKeys.map((id) => {
    const { sourceKey, fieldKey: key } = parseGraphSeriesId(id)
    const values = points.map((point) => sourceKey != null && sourceKeyForGroup(groups[point.__groupIndex]) !== sourceKey
      ? null
      : numericValue(point, key, profileForPoint(point)))
    const finite = values.filter((value) => Number.isFinite(value))
    if (finite.length === 0) return null
    const profilePoint = points.find((point) => (sourceKey == null || sourceKeyForGroup(groups[point.__groupIndex]) === sourceKey) && point.attributes?.[key] !== undefined)
    const isPercent = profilePoint
      ? profileForPoint(profilePoint)?.getAttributeHeader?.(key)?.includes('%')
      : false
    const displayScale = autoScale ? (isPercent ? 1 : displayScaleFor(finite)) : 1
    return { id, key, sourceKey, color: seriesColors[id] || defaultColorForKey(id), values, min: Math.min(...finite), max: Math.max(...finite), displayScale, displayMin: Math.min(...finite) * displayScale, displayMax: Math.max(...finite) * displayScale }
  }).filter(Boolean), [autoScale, groups, points, profile, selectedKeys, seriesColors, sourceMappingState])
  const profileForKey = (key, sourceKey = null) => {
    const point = points.find((candidate) => (sourceKey == null || sourceKeyForGroup(groups[candidate.__groupIndex]) === sourceKey) && candidate.attributes?.[key] !== undefined)
    return point ? profileForPoint(point) : displayProfile
  }
  const contextForKey = (key, sourceKey = null) => {
    const sourceGroups = sourceKey == null ? groups : groups.filter((candidate) => sourceKeyForGroup(candidate) === sourceKey)
    const sourceGroupIndexes = new Set(sourceGroups.map((candidate) => candidate.points?.length
      ? groups.indexOf(candidate)
      : -1))
    const point = [...points].reverse().find((candidate) => sourceGroupIndexes.has(candidate.__groupIndex)
      && (key === SPEED_KEY
        ? Number.isFinite(Number(candidate.speedMph)) || Number.isFinite(Number(candidate.speed))
        : candidate.attributes?.[key] !== undefined))
    const group = point ? groups[point.__groupIndex] : sourceGroups[0] || groups[0]
    const keyProfile = point ? profileForPoint(point) : group?.profileContext?.profile || profile
    return { group, profile: keyProfile, point }
  }
  const deviceForGroup = useCallback((group) => deviceMetadataList.find((item) => Number(item.id) === Number(group?.deviceId))
    || (Number(deviceMetadata?.id) === Number(group?.deviceId) ? deviceMetadata : null), [deviceMetadata, deviceMetadataList])

  useEffect(() => {
    if (publicMode || !canEditSharedProfiles || !vehicleApiBaseUrl || !traccarServerVersion
      || sourceMappingLoadedKey !== sourceMappingDeviceKey || !sourceMappingDeviceIds.length) return undefined
    let active = true
    const applyMatches = async () => {
      for (const group of groups) {
        if (!active) break
        const deviceId = Number(group.deviceId)
        if (!sourceMappingDeviceIds.includes(deviceId)) continue
        const device = deviceForGroup(group)
        const matchContext = telemetryDeviceMatchContext(device, traccarServerVersion)
        if (!matchContext.manufacturer || !matchContext.model) continue
        const profileForDevice = group.profileContext?.profile || profile
        const observedKeys = new Set((group.points || []).flatMap((value) => Object.keys(asPoint(value).attributes || {})))
        const histories = sourceMappingState[deviceId] || []
        for (const key of observedKeys) {
          if (!active) break
          if (IGNORED_TELEMETRY_KEYS.has(key) || !group.points.some((value) => {
            const raw = asPoint(value).attributes?.[key]
            return raw !== undefined && raw !== null && raw !== ''
          })) continue
          const attemptKey = `${deviceId}:${key}`
          if (automaticMappingAttempts.current.has(attemptKey)) continue
          const existingHistory = histories.filter((item) => item.fieldKey === key)
          const existingMapping = profileForDevice?.attributeMap?.[key] || profileForDevice?.getAttributeInfo?.(key) || null
          const match = findBundledAutomaticFieldMatch(key, matchContext, existingMapping)
          if (!match || existingHistory.length || existingMapping?.label) continue
          const validationError = validateAttributeMap({ [key]: match.mapping })
          if (validationError) continue
          automaticMappingAttempts.current.add(attemptKey)
          try {
            const expectedRevision = Math.max(0, ...existingHistory.map((item) => Number(item.revision) || 0))
            const saved = await saveTelemetrySourceMapping(vehicleApiBaseUrl, deviceId, key, match.mapping, expectedRevision, 'documented-auto')
            const revision = { fieldKey: key, revision: saved.revision, effectiveAt: saved.effectiveAt, mapping: match.mapping, changeKind: 'documented-auto' }
            setSourceMappingState((current) => ({ ...current, [deviceId]: appendSourceMappingRevision(current[deviceId], revision) }))
            setAutomaticMappingStatus('A documented tracker mapping was applied for future data. You can undo it in the field editor.')
          } catch {
            automaticMappingAttempts.current.delete(attemptKey)
          }
        }
      }
    }
    applyMatches()
    return () => { active = false }
  }, [canEditSharedProfiles, deviceForGroup, groups, profile, publicMode, sourceMappingDeviceIds, sourceMappingDeviceKey, sourceMappingLoadedKey, sourceMappingState, traccarServerVersion, vehicleApiBaseUrl])
  const personalLabelKey = (profileId, vehicleId, deviceId, key) => telemetryFieldScopeKey(profileId, vehicleId, deviceId, key)
  const suggestionsForField = (key, keyProfile, group, scopeKey, legacyScopeKey) => {
    const deviceContext = telemetryDeviceMatchContext(deviceForGroup(group), traccarServerVersion)
    return [
      ...findBundledFieldSuggestions(key, deviceContext),
      ...findRelatedProfileSuggestions(key, keyProfile, profileOptions),
    ].filter((candidate) => !isSuggestionDismissed(dismissedSuggestionTokens, scopeKey, candidate.profileId, legacyScopeKey))
  }
  const elementLabel = (key, keyProfile, group, displayScale = 1) => {
    const scopeKey = personalLabelKey(keyProfile?.id, group?.vehicleId, group?.deviceId, key)
    const legacyScopeKey = legacyTelemetryFieldScopeKey(keyProfile?.id, group?.vehicleId, key)
    const personalLabel = (personalFieldLabels[scopeKey] || personalFieldLabels[legacyScopeKey] || '').trim()
    const info = keyProfile?.getAttributeInfo?.(key)
    const relatedSuggestions = key === SPEED_KEY ? [] : suggestionsForField(key, keyProfile, group, scopeKey, legacyScopeKey)
    const suggestedLabel = !personalLabel && !info?.label ? relatedSuggestions[0]?.mapping.label || '' : ''
    let label = personalLabel || info?.label || suggestedLabel || (key === SPEED_KEY ? 'Speed' : `Unmapped ${key}`)
    let suffix = ''
    if (key === SPEED_KEY) suffix = `GPS position, ${keyProfile?.unitSystem === 'metric' ? 'km/h' : 'mph'}`
    else {
      const catalogAvlId = relatedSuggestions.find((candidate) => candidate.profileId.startsWith('catalog:'))?.mapping.avlId
      const avlId = info?.avlId ?? catalogAvlId ?? (keyProfile?.id?.startsWith('teltonika-') ? key.match(/^io(\d+)$/i)?.[1] : null)
      const unit = keyProfile?.getAttributeUnit?.(key) || info?.sourceUnit || info?.units || (info?.sourceUnitStatus === 'none' ? 'no unit' : 'unit unknown')
      if (avlId != null) suffix = `AVL ${avlId}, ${unit}`
      else suffix = `key: ${key}${unit && unit !== 'unit unknown' ? `, ${unit}` : ''}`
    }
    if (suffix) label += ` (${suffix})`
    if (displayScale < 1) label += ` ÷${Math.round(1 / displayScale)}`
    return {
      label,
      mapping: info,
      personalLabel,
      suggestedLabel,
      relatedSuggestions,
      scopeKey,
      legacyScopeKey,
      suggestionsDismissed: hasDismissedSuggestions(dismissedSuggestionTokens, scopeKey, legacyScopeKey),
      suffix: suffix ? `(${suffix})` : '(field details)',
    }
  }
  const reviewStatusForField = (key, keyProfile, group) => {
    const element = elementLabel(key, keyProfile, group)
    return classifyTelemetryField({
      mapping: element.mapping,
      personalLabel: element.personalLabel,
      suggestions: element.relatedSuggestions,
    })
  }
  const numericFieldStatuses = new Map(availableKeys.map((id) => {
    const { sourceKey, fieldKey } = parseGraphSeriesId(id)
    const { group, profile: keyProfile } = contextForKey(fieldKey, sourceKey)
    return [id, reviewStatusForField(fieldKey, keyProfile, group)]
  }))
  const unplottedFieldStatuses = new Map(unplottedFields.map((field) => {
    const { group, profile: keyProfile } = contextForKey(field.key, field.sourceKey)
    return [`${field.sourceKey}:${field.key}`, reviewStatusForField(field.key, keyProfile, group)]
  }))
  const reviewFilterOptions = [
    { value: 'all', label: 'All' },
    { value: 'new', label: 'New' },
    { value: 'suggested', label: 'Suggested' },
    { value: 'conflicting', label: 'Conflicting' },
  ].map((option) => ({
    ...option,
    count: option.value === 'all'
      ? availableKeys.length + unplottedFields.length
      : [...numericFieldStatuses.values(), ...unplottedFieldStatuses.values()].filter((status) => status === option.value).length,
  }))
  const matchesReviewFilter = (status) => fieldReviewFilter === 'all' || status === fieldReviewFilter
  const reviewAvailableKeys = availableKeys.filter((key) => matchesReviewFilter(numericFieldStatuses.get(key)))
  const reviewUnplottedFields = unplottedFields.filter((field) => matchesReviewFilter(unplottedFieldStatuses.get(`${field.sourceKey}:${field.key}`)))
  const savePersonalFieldLabel = async (scopeKey, label) => {
    const next = { ...personalFieldLabels }
    if (label) next[scopeKey] = label
    else delete next[scopeKey]
    setPersonalFieldLabels(next)
    localStorage.setItem(personalLabelsStorageKey, JSON.stringify(next))
    if (isAuthenticated && vehicleApiBaseUrl) {
      try {
        await saveUserPreference(vehicleApiBaseUrl, 'telemetry-field-labels', next)
        return { message: 'Personal description saved to your account.' }
      } catch (error) {
        return { message: `Saved on this device; account sync failed. ${error instanceof Error ? error.message : ''}`.trim() }
      }
    }
    return { message: 'Personal description saved on this device.' }
  }
  const dismissSuggestion = async (scopeKey, profileId) => {
    const token = `${scopeKey}::${profileId}`
    const next = [...new Set([...dismissedSuggestionTokens, token])]
    setDismissedSuggestionTokens(next)
    localStorage.setItem(dismissedSuggestionsStorageKey, JSON.stringify(next))
    if (isAuthenticated && vehicleApiBaseUrl) {
      try {
        await saveUserPreference(vehicleApiBaseUrl, 'telemetry-field-suggestions-dismissed', next)
        return { message: 'Suggestion dismissed for this account and field.' }
      } catch (error) {
        return { message: `Dismissed on this device; account sync failed. ${error instanceof Error ? error.message : ''}`.trim() }
      }
    }
    return { message: 'Suggestion dismissed on this device.' }
  }
  const dismissAllSuggestions = async (scopeKey, keyProfile, key, sourceKey = null) => {
    const { group } = contextForKey(key, sourceKey)
    const candidates = suggestionsForField(key, keyProfile, group, scopeKey)
    const tokens = [`${scopeKey}::*`, ...candidates.map((candidate) => `${scopeKey}::${candidate.profileId}`)]
    const next = [...new Set([...dismissedSuggestionTokens, ...tokens])]
    setDismissedSuggestionTokens(next)
    localStorage.setItem(dismissedSuggestionsStorageKey, JSON.stringify(next))
    if (isAuthenticated && vehicleApiBaseUrl) {
      try {
        await saveUserPreference(vehicleApiBaseUrl, 'telemetry-field-suggestions-dismissed', next)
        return { message: candidates.length ? 'Suggestions dismissed for this account and field.' : 'This field remains unknown.' }
      } catch (error) {
        return { message: `Saved on this device; account sync failed. ${error instanceof Error ? error.message : ''}`.trim() }
      }
    }
    return { message: candidates.length ? 'Suggestions dismissed on this device.' : 'This field remains unknown.' }
  }
  const restoreDismissedSuggestions = async (scopeKey, legacyScopeKey) => {
    const prefixes = [`${scopeKey}::`, ...(legacyScopeKey ? [`${legacyScopeKey}::`] : [])]
    const next = dismissedSuggestionTokens.filter((token) => !prefixes.some((prefix) => token.startsWith(prefix)))
    setDismissedSuggestionTokens(next)
    localStorage.setItem(dismissedSuggestionsStorageKey, JSON.stringify(next))
    if (isAuthenticated && vehicleApiBaseUrl) {
      try {
        await saveUserPreference(vehicleApiBaseUrl, 'telemetry-field-suggestions-dismissed', next)
        return { message: 'Dismissed suggestions restored.' }
      } catch (error) {
        return { message: `Restored on this device; account sync failed. ${error instanceof Error ? error.message : ''}`.trim() }
      }
    }
    return { message: 'Dismissed suggestions restored on this device.' }
  }
  const displayScalesByKey = useMemo(() => Object.fromEntries(availableKeys.map((id) => {
    if (!autoScale) return [id, 1]
    const { sourceKey, fieldKey } = parseGraphSeriesId(id)
    const point = points.find((candidate) => sourceKeyForGroup(groups[candidate.__groupIndex]) === sourceKey && candidate.attributes?.[fieldKey] !== undefined)
    const keyProfile = point ? profileForPoint(point) : displayProfile
    const values = points.filter((candidate) => sourceKeyForGroup(groups[candidate.__groupIndex]) === sourceKey).map((candidate) => numericValue(candidate, fieldKey, profileForPoint(candidate))).filter(Number.isFinite)
    const isPercent = keyProfile?.getAttributeHeader?.(fieldKey)?.includes('%')
    return [id, isPercent ? 1 : displayScaleFor(values)]
  })), [autoScale, availableKeys, displayProfile, groups, points, profile, sourceMappingState])
  const editingContext = editingFieldKey ? contextForKey(editingFieldKey, editingSourceKey) : null
  const editingSeriesId = editingFieldKey && editingSourceKey ? graphSeriesId(editingSourceKey, editingFieldKey) : editingFieldKey
  const editingElement = editingFieldKey && editingContext ? elementLabel(editingFieldKey, editingContext.profile, editingContext.group, displayScalesByKey[editingSeriesId] || 1) : null
  const editingDevice = editingContext
    ? deviceMetadataList.find((item) => Number(item.id) === Number(editingContext.group?.deviceId))
      || (Number(deviceMetadata?.id) === Number(editingContext.group?.deviceId) ? deviceMetadata : null)
    : null
  const editingMatchContext = telemetryDeviceMatchContext(editingDevice, traccarServerVersion)
  const editingSourceHistory = editingContext
    ? (sourceMappingState[Number(editingContext.group?.deviceId)] || []).filter((item) => item.fieldKey === editingFieldKey)
    : []

  const setSeriesColor = (key, color) => {
    setSeriesColors((current) => ({ ...current, [key]: color }))
  }

  const globalMin = Math.min(...series.flatMap((item) => [item.displayMin]), 0)
  const globalMax = Math.max(...series.flatMap((item) => [item.displayMax]), 1)
  const maxZoom = Math.max(.75, Math.min(80, points.length / 20))
  useEffect(() => {
    if (zoom > maxZoom) setZoom(maxZoom)
  }, [maxZoom, zoom])
  const chartWidth = 1070 * zoom
  const chartHeight = 420
  const left = 52
  const right = 18
  const top = 20
  const bottom = 34
  const innerWidth = chartWidth - left - right
  const innerHeight = chartHeight - top - bottom
  const visibleSpan = Math.max(.0001, viewRange.end - viewRange.start)
  const runtimeSegments = groups.map((group, groupIndex) => {
    const groupPoints = group.points.map(asPoint).filter((point) => !Number.isNaN(point.timestamp?.getTime?.())).sort((a, b) => a.timestamp - b.timestamp)
    const start = groupPoints[0]?.timestamp?.getTime?.() ?? 0
    const end = groupPoints.at(-1)?.timestamp?.getTime?.() ?? start
    return { groupIndex, start, durationMinutes: Math.max(0, (end - start) / 60000) }
  })
  let runtimeOffsetMinutes = 0
  const runtimeStarts = new Map()
  runtimeSegments.forEach((segment) => {
    runtimeStarts.set(segment.groupIndex, runtimeOffsetMinutes)
    runtimeOffsetMinutes += segment.durationMinutes
  })
  const totalDurationMinutes = runtimeOffsetMinutes
  const timeTickInterval = totalDurationMinutes > 0
    ? Math.max(1, Math.ceil(totalDurationMinutes / Math.max(4, chartWidth / 60)))
    : 1
  const timeTicks = Array.from({ length: Math.floor(totalDurationMinutes / timeTickInterval) + 1 }, (_, index) => {
    const minutes = Math.min(totalDurationMinutes, index * timeTickInterval)
    return { ratio: totalDurationMinutes > 0 ? minutes / totalDurationMinutes : 0, label: formatElapsedMinutes(minutes) }
  })
  const runtimeMinutesForPoint = (point) => {
    const segment = runtimeSegments[point.__groupIndex]
    if (!segment) return 0
    const sampleCount = groups[point.__groupIndex]?.points?.length || 1
    const sampleRatio = sampleCount <= 1 ? 0 : point.__groupPointIndex / (sampleCount - 1)
    return (runtimeStarts.get(point.__groupIndex) || 0) + segment.durationMinutes * sampleRatio
  }
  const xFor = (index) => {
    if (points.length <= 1 || totalDurationMinutes <= 0) return left
    const runtimeRatio = runtimeMinutesForPoint(points[index]) / totalDurationMinutes
    return left + ((runtimeRatio - viewRange.start) / visibleSpan) * innerWidth
  }
  const plotRatioFromPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - rect.left) / rect.width) * chartWidth
    return Math.max(0, Math.min(1, (svgX - left) / innerWidth))
  }
  const cursorRatioFromPointer = (event) => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return 0
    const rect = svg.getBoundingClientRect()
    const svgX = ((event.clientX - rect.left) / rect.width) * chartWidth
    return Math.max(0, Math.min(1, (svgX - left) / innerWidth))
  }
  const moveValueCursor = (event) => {
    event.stopPropagation()
    setValueCursorRatio(cursorRatioFromPointer(event))
  }
  const beginValueCursorDrag = (event) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    moveValueCursor(event)
  }
  const updateValueCursorDrag = (event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) moveValueCursor(event)
  }
  const beginDrag = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const ratio = plotRatioFromPointer(event)
    setDragRange({ start: ratio, current: ratio })
  }
  const updateDrag = (event) => {
    if (!dragRange) return
    // Read the native event before entering the functional state updater;
    // React clears currentTarget after the handler returns.
    const ratio = plotRatioFromPointer(event)
    setDragRange((current) => current ? { ...current, current: ratio } : null)
  }
  const finishDrag = (event) => {
    if (!dragRange) return
    const current = plotRatioFromPointer(event)
    const startRatio = Math.min(dragRange.start, current)
    const endRatio = Math.max(dragRange.start, current)
    if (endRatio - startRatio > .03) {
      const selectedSpan = endRatio - startRatio
      // Keep the complete original timeline as the scrollable domain. The
      // brush controls magnification; it must not crop away earlier points.
      pendingScrollRatio.current = viewRange.start + startRatio * visibleSpan
      setViewRange({ start: 0, end: 1 })
      setZoom((current) => Math.min(maxZoom, Math.max(.75, current / selectedSpan)))
    }
    setDragRange(null)
  }
  const resetView = () => {
    setZoom(1)
    setViewRange({ start: 0, end: 1 })
    setDragRange(null)
    pendingScrollRatio.current = null
    if (plotWrapRef.current) plotWrapRef.current.scrollLeft = 0
  }
  const yFor = (value, item) => {
    const min = independentScale ? item.min : globalMin
    const max = independentScale ? item.max : globalMax
    const scaledValue = independentScale ? value : value * item.displayScale
    const ratio = max === min ? 0.5 : (scaledValue - min) / (max - min)
    return top + innerHeight - Math.max(0, Math.min(1, ratio)) * innerHeight
  }
  const pointIndexByTimestamp = new Map(points.map((point, index) => [`${point.timestamp.getTime()}|${point.deviceId || ''}`, index]))
  const cursorPointIndex = valueCursorRatio == null || points.length === 0
    ? -1
    : points.reduce((closest, point, index) => Math.abs(runtimeMinutesForPoint(point) / Math.max(totalDurationMinutes, 1) - valueCursorRatio) < Math.abs(runtimeMinutesForPoint(points[closest]) / Math.max(totalDurationMinutes, 1) - valueCursorRatio) ? index : closest, 0)
  const cursorX = valueCursorRatio == null ? null : left + ((valueCursorRatio - viewRange.start) / visibleSpan) * innerWidth
  const cursorVisible = cursorX != null && cursorX >= left && cursorX <= left + innerWidth

  async function createShare() {
    if (mixedProfiles) {
      setShareStatus('This selection crosses profile assignments or shared profile revisions. Share a time range with one interpretation at a time so labels and units stay accurate.')
      return
    }
    setShareStatus('Creating link…')
    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (groups.some((group) => !guidPattern.test(String(group.id || '')))) {
      setShareStatus('This trip has not been synchronized into VehicleApp yet. Refresh the day before sharing it.')
      return
    }
    const first = points[0]?.timestamp
    const last = points.at(-1)?.timestamp || new Date()
    const shareKeys = shareAllSensors ? availableKeys : selectedKeys
    const series = shareKeys.map((id, index) => {
      const { sourceKey, fieldKey } = parseGraphSeriesId(id)
      const { group, profile: keyProfile } = contextForKey(fieldKey, sourceKey)
      const info = keyProfile?.getAttributeInfo?.(fieldKey)
      const sourceName = deviceForGroup(group)?.name || group?.label || sourceKey
      const fieldLabel = info?.label ? `${info.label}${info.avlId != null ? ` (AVL ${info.avlId})` : ''}` : labelFor(fieldKey, keyProfile)
      return { fieldKey: id, label: `${fieldLabel} · ${sourceName}`, unit: keyProfile?.getAttributeUnit?.(fieldKey) || info?.units || null, color: seriesColors[id] || defaultColorForKey(id), displayOrder: index }
    })
    const pointRows = groups.flatMap((group) => group.points.map(asPoint).map((point) => {
      const values = {}
      shareKeys.forEach((id) => {
        const { sourceKey, fieldKey } = parseGraphSeriesId(id)
        if (sourceKey !== sourceKeyForGroup(group)) return
        const value = numericValue(point, fieldKey, profileForPoint({ ...point, __groupIndex: groups.indexOf(group) }))
        if (value !== null && value !== undefined && value !== '') values[id] = value
      })
      return { tripId: group.id, occurredAt: point.timestamp, elapsedMilliseconds: first ? Math.max(0, point.timestamp - first) : 0, values }
    }).filter((point) => Object.keys(point.values).length > 0))
    try {
      const response = await fetch('/vehicle-api/api/telemetry-shares', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ mode: shareMode, vehicleId: groups[0]?.vehicleId, tripIds: groups.map((group) => group.id), fromUtc: first?.toISOString(), throughUtc: last.toISOString(), fieldKeys: shareKeys, series, points: pointRows, title: shareTitle || title, message: shareMessage || null, allowExport, expiresAt: new Date(shareExpiresAt).toISOString() }) })
      if (!response.ok) throw new Error((await response.text()) || 'Unable to create share')
      const result = await response.json()
      const link = `${window.location.origin}/shared/telemetry/${result.token}`
      try { localStorage.setItem(`vehicleApp:telemetryShareToken:${result.shareId}`, result.token) } catch { /* optional browser storage */ }
      await navigator.clipboard?.writeText(link)
      setShareStatus(`Link copied to clipboard: ${link}`)
    } catch (error) { setShareStatus(error.message) }
  }
  async function loadShares() {
    try {
      const response = await fetch('/vehicle-api/api/telemetry-shares', { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('Unable to load shared links')
      setShares(await response.json())
    } catch (error) { setShareStatus(error.message) }
  }
  async function revokeShare(shareId) {
    if (!window.confirm('Revoke this shared link? Anyone using it will lose access.')) return
    const response = await fetch(`/vehicle-api/api/telemetry-shares/${shareId}`, { method: 'DELETE', credentials: 'include' })
    if (response.ok) loadShares()
  }
  async function rotateShare(shareId) {
    const response = await fetch(`/vehicle-api/api/telemetry-shares/${shareId}/rotate`, { method: 'POST', credentials: 'include' })
    if (!response.ok) return
    const result = await response.json()
    const link = `${window.location.origin}/shared/telemetry/${result.token}`
    try { localStorage.setItem(`vehicleApp:telemetryShareToken:${shareId}`, result.token) } catch { /* optional browser storage */ }
    await navigator.clipboard?.writeText(link)
    setShareStatus(`Replacement link copied: ${link}`)
    loadShares()
  }
  async function enableShare(shareId) {
    const response = await fetch(`/vehicle-api/api/telemetry-shares/${shareId}/enable`, { method: 'POST', credentials: 'include' })
    if (!response.ok) { setShareStatus('Unable to enable this shared link.'); return }
    setShareStatus('Shared link enabled.')
    loadShares()
  }
  async function updateShareExpiration(shareId) {
    if (!editingExpiration?.value) return
    const response = await fetch(`/vehicle-api/api/telemetry-shares/${shareId}/expiration`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresAt: new Date(editingExpiration.value).toISOString() }) })
    if (!response.ok) { setShareStatus((await response.text()) || 'Unable to update the expiration.'); return }
    setEditingExpiration(null)
    setShareStatus('Expiration updated.')
    loadShares()
  }
  async function copyShare(share) {
    try {
      const token = localStorage.getItem(`vehicleApp:telemetryShareToken:${share.shareId}`)
      if (!token) { setShareStatus('This browser does not have the original token. Rotate the link to create a new copyable URL.'); return }
      await navigator.clipboard?.writeText(`${window.location.origin}/shared/telemetry/${token}`)
      setShareStatus('Share link copied.')
    } catch { setShareStatus('Unable to copy the share link.') }
  }
  async function exportGraphTelemetry() {
    if (!points.length) return
    if (mixedProfiles) {
      setShareStatus('This selection crosses profile assignments or shared profile revisions. Export a time range with one interpretation at a time so channel labels and units stay accurate.')
      return
    }
    setExportBusy(true)
    setPreparedExport(null)
    setShareStatus('Loading GPS records for export…')
    try {
      const selectedExportKeys = [...new Set((selectedKeys.length > 0 ? selectedKeys : availableKeys).map((id) => parseGraphSeriesId(id).fieldKey))]
      const gpsBatches = fetchGpsPositions ? await fetchGpsPositions(groups) : []
    const gpsByGroup = new Map(gpsBatches.map((batch) => [batch.groupId, batch.points || []]))
    const exportPoints = addNamedPlaceMarkers(points.map((point) => {
      const group = groups[point.__groupIndex]
      const gpsPoint = nearestTimestampPoint(gpsByGroup.get(group?.id), point.timestamp)
      if (!gpsPoint) return { ...point, tripId: group?.id || '', gpsMatch: point.latitude != null && point.longitude != null ? 'embedded' : 'missing' }
      const deltaSeconds = Math.abs(gpsPoint.timestamp - point.timestamp) / 1000
      return { ...point, tripId: group?.id || '', latitude: gpsPoint.latitude, longitude: gpsPoint.longitude, speed: gpsPoint.speed, course: gpsPoint.course, altitude: gpsPoint.altitude, accuracy: gpsPoint.accuracy, gpsMatch: deltaSeconds === 0 ? 'exact' : 'nearest', gpsDeltaSeconds: Number(deltaSeconds.toFixed(3)) }
    }), namedPlaces, groups, vehicleMetadata?.id)
    const deviceVin = deviceMetadata?.vin || deviceMetadata?.attributes?.vin || deviceMetadata?.attributes?.VIN || deviceMetadata?.attributes?.vehicleVin || null
    const telemetry = buildTelemetryCsv({
      sessionStart: exportPoints[0].timestamp,
      deviceName: vehicleMetadata?.displayName || deviceMetadata?.name || title,
      points: exportPoints,
      carProfile: displayProfile,
      vehicleId: groups[0]?.vehicleId || vehicleMetadata?.id || null,
      deviceId: groups[0]?.deviceId || deviceMetadata?.id || null,
      vehicleVin: vehicleMetadata?.vin || null,
      deviceVin,
      channelKeys: selectedExportKeys,
      appVersion: import.meta.env.VITE_APP_VERSION || 'vehicle-app-react',
    })
      const timing = telemetry.metadata.trackTiming || { laps: [], dragRuns: [], splitPassages: [], lapSummary: {} }
      const bestLap = Number.isFinite(timing.lapSummary.bestElapsedSeconds) ? ` Best lap ${timing.lapSummary.bestElapsedSeconds.toFixed(3)}s.` : ''
      const markerCount = exportPoints.filter((point) => point.placeEvent).length
      const summaryText = `Export ready: ${exportPoints.length} records with GPS and metadata. ${markerCount} place passage(s), ${timing.laps.length} lap(s), ${timing.dragRuns.length} drag run(s), ${timing.splitPassages.length} split passage(s).${bestLap}`
      const trackTimingCsv = buildTrackTimingCsv({ timing, deviceName: vehicleMetadata?.displayName || deviceMetadata?.name || title, sessionStart: exportPoints[0].timestamp })
      const trackMetadata = buildTrackMetadata({ points: exportPoints, timing, deviceName: vehicleMetadata?.displayName || deviceMetadata?.name || title, sessionStart: exportPoints[0].timestamp, vehicleId: groups[0]?.vehicleId || vehicleMetadata?.id || null, deviceId: groups[0]?.deviceId || deviceMetadata?.id || null })
      setPreparedExport({
        csvFileName: telemetry.fileName,
        csvText: buildCsvText(telemetry),
        metadataFileName: telemetry.fileName.replace(/\.csv$/i, '.metadata.json'),
        metadataText: JSON.stringify(telemetry.metadata, null, 2),
        metadata: telemetry.metadata,
        summaryText,
        trackCsvFileName: trackTimingCsv.fileName,
        trackCsvText: buildCsvText(trackTimingCsv),
        trackMetadataFileName: trackTimingCsv.fileName.replace(/\.csv$/i, '.metadata.json'),
        trackMetadataText: JSON.stringify(trackMetadata, null, 2),
        trackMetadata,
      })
      setShareStatus(summaryText)
    } catch (error) {
      setShareStatus(error instanceof Error ? `Telemetry export failed: ${error.message}` : 'Telemetry export failed.')
    } finally {
      setExportBusy(false)
    }
  }

  return <div className={publicMode ? 'telemetry-graph-inline' : 'telemetry-graph-modal'} role={publicMode ? undefined : 'dialog'} aria-modal={publicMode ? undefined : 'true'} aria-label={title}>
    {!independentScale && series.some((item) => item.displayScale < 1) && <div className="telemetry-scale-note">Display scale: {series.filter((item) => item.displayScale < 1).map((item) => `${labelFor(item.key, profileForKey(item.key, item.sourceKey))} ÷${Math.round(1 / item.displayScale)}`).join(' · ')}</div>}
    {!publicMode && <div className="telemetry-share-actions"><button type="button" className="small secondary" onClick={() => { setShareExpiresAt(defaultShareExpiration()); setShareOpen(true) }} disabled={mixedProfiles}>Share graph</button><button type="button" className="small secondary" onClick={() => { setManageOpen(true); loadShares() }}>Manage shares</button></div>}
    {preparedExport && <div className="telemetry-graph-export-dialog" role="dialog" aria-modal="false" aria-label="Telemetry export ready"><h3>Telemetry export ready</h3>{shareStatus && <div className="telemetry-graph-status" role="status" aria-live="polite">{shareStatus}</div>}{(preparedExport.metadata?.trackTiming?.laps?.length || preparedExport.metadata?.trackTiming?.dragRuns?.length || preparedExport.metadata?.trackTiming?.splitPassages?.length) > 0 && <details className="telemetry-graph-export-timings" open><summary>Timing details</summary>{preparedExport.metadata?.trackTiming?.laps?.length > 0 && <div><strong>Laps</strong><ol>{preparedExport.metadata.trackTiming.laps.map((lap, index) => <li key={`${lap.startUtc}-${index}`}>{Number(lap.elapsedSeconds).toFixed(3)}s · {lap.startPlace} → {lap.finishPlace}</li>)}</ol></div>}{preparedExport.metadata?.trackTiming?.dragRuns?.length > 0 && <div><strong>Drag runs</strong><ol>{preparedExport.metadata.trackTiming.dragRuns.map((run, index) => <li key={`${run.startUtc}-${index}`}>{Number(run.elapsedSeconds).toFixed(3)}s · {run.startPlace} → {run.finishPlace}</li>)}</ol></div>}{preparedExport.metadata?.trackTiming?.splitPassages?.length > 0 && <div><strong>Split passages</strong><ol>{preparedExport.metadata.trackTiming.splitPassages.map((split, index) => <li key={`${split.timestampUtc}-${index}`}>{new Date(split.timestampUtc).toLocaleString()} · {split.place}{Number.isFinite(split.elapsedSincePreviousSeconds) ? ` · ${split.elapsedSincePreviousSeconds.toFixed(3)}s since previous split` : ''}</li>)}</ol></div>}</details>}<p>Choose a file to download.</p><div className="telemetry-graph-export-downloads"><button type="button" className="small secondary" onClick={() => downloadTextFile({ fileName: preparedExport.csvFileName, contents: preparedExport.csvText, type: 'text/csv;charset=utf-8;' })}>Download telemetry CSV</button><button type="button" className="small secondary" onClick={() => downloadTextFile({ fileName: preparedExport.metadataFileName, contents: preparedExport.metadataText, type: 'application/json;charset=utf-8;' })}>Download metadata JSON</button>{(preparedExport.metadata?.trackTiming?.laps?.length || preparedExport.metadata?.trackTiming?.dragRuns?.length || preparedExport.metadata?.trackTiming?.splitPassages?.length) > 0 && <><button type="button" className="small secondary" onClick={() => downloadTextFile({ fileName: preparedExport.trackCsvFileName, contents: preparedExport.trackCsvText, type: 'text/csv;charset=utf-8;' })}>Download track timing CSV</button><button type="button" className="small secondary" onClick={() => downloadTextFile({ fileName: preparedExport.trackMetadataFileName, contents: preparedExport.trackMetadataText, type: 'application/json;charset=utf-8;' })}>Download track metadata JSON</button></>}</div><div className="actions"><button type="button" className="secondary" onClick={() => { setPreparedExport(null); setShareStatus('') }}>Close</button></div></div>}
    {manageOpen && <div className="telemetry-share-dialog telemetry-share-management"><h3>Shared links</h3><p>Enable restores the original URL if it has not expired. Rotate creates a replacement URL and invalidates the current one.</p>{shares.length === 0 ? <p>No links created yet.</p> : <>{['active', 'expired', 'revoked'].map((status) => { const matches = shares.filter((share) => share.status === status); if (matches.length === 0) return null; return <section key={status} className={status === 'revoked' ? 'telemetry-share-revoked' : undefined}><h4>{status === 'revoked' ? 'Revoked · deletion hold (30 days)' : status[0].toUpperCase() + status.slice(1)}</h4>{matches.map((share) => <div className="telemetry-share-row" key={share.shareId}><strong>{share.title || 'Telemetry graph'}</strong><span>{share.status} · expires {new Date(share.expiresAt).toLocaleString()} · {share.accessCount} visits</span><div>{share.status === 'active' && <button type="button" className="small secondary" onClick={() => copyShare(share)}>Copy link</button>}{share.status === 'active' && <button type="button" className="small secondary" onClick={() => rotateShare(share.shareId)} title="Create a replacement URL and invalidate the current one">Rotate</button>}{share.status === 'active' && <button type="button" className="small danger" onClick={() => revokeShare(share.shareId)}>Revoke</button>}{share.status === 'revoked' && <button type="button" className="small secondary" onClick={() => enableShare(share.shareId)}>Enable</button>}<button type="button" className="small secondary" onClick={() => setEditingExpiration({ shareId: share.shareId, value: localDateTimeValue(share.expiresAt) })}>Change expiration</button></div>{editingExpiration?.shareId === share.shareId && <div className="telemetry-share-expiration-editor"><label>Expires<input type="datetime-local" value={editingExpiration.value} min={localDateTimeValue(new Date(Date.now() + 6 * 60000))} max={localDateTimeValue(new Date(Date.now() + 90 * 86400000))} onChange={(event) => setEditingExpiration({ ...editingExpiration, value: event.target.value })} /></label><button type="button" className="small" onClick={() => updateShareExpiration(share.shareId)}>Save</button><button type="button" className="small secondary" onClick={() => setEditingExpiration(null)}>Cancel</button></div>}</div>)}</section> })}</>}<div className="telemetry-share-management-actions"><button type="button" className="small secondary" onClick={() => setManageOpen(false)}>Close</button></div></div>}
    {shareOpen && <div className="telemetry-share-dialog"><h3>Share this graph</h3><p>Shares the trips and telemetry currently loaded in this graph.</p><label>Title<input value={shareTitle} onChange={(event) => setShareTitle(event.target.value)} placeholder={title} /></label><label>Message<textarea value={shareMessage} onChange={(event) => setShareMessage(event.target.value)} rows="2" /></label><label>Expires<input type="datetime-local" value={shareExpiresAt} min={localDateTimeValue(new Date(Date.now() + 6 * 60000))} max={localDateTimeValue(new Date(Date.now() + 90 * 86400000))} onChange={(event) => setShareExpiresAt(event.target.value)} /></label><label className="telemetry-scale-switch"><span>Share all sensors</span><input type="checkbox" role="switch" checked={shareAllSensors} onChange={(event) => setShareAllSensors(event.target.checked)} /><i /></label><label className="telemetry-scale-switch"><span>Allow telemetry export</span><input type="checkbox" role="switch" checked={allowExport} onChange={(event) => setAllowExport(event.target.checked)} /><i /></label><div className="actions"><button type="button" onClick={createShare} disabled={(shareAllSensors ? availableKeys : selectedKeys).length === 0}>Create link</button><button type="button" className="secondary" onClick={() => setShareOpen(false)}>Close</button></div>{shareStatus && <p className="profile-editor-status">{shareStatus}</p>}</div>}
    <div className="telemetry-graph-card">
      {(graphDataLoading || automaticMappingStatus || graphDataError || mixedProfiles || hasMissingProfileDefinition || hasUnassignedProfile || (shareStatus && !preparedExport)) && <div className="telemetry-graph-notices">
        {graphDataLoading && <div className="telemetry-graph-status" role="status">Loading received telemetry for this graph…</div>}
        {automaticMappingStatus && <div className="telemetry-graph-status" role="status">{automaticMappingStatus}</div>}
        {graphDataError && <div className="telemetry-graph-status" role="status">Full telemetry could not be loaded. Showing the available trip points. {graphDataError}</div>}
        {mixedProfiles && <div className="telemetry-graph-status" role="status">Multiple profile assignments are present. Values are decoded per trip; legend labels use the first trip. Export and sharing are disabled for this selection.</div>}
        {!mixedProfiles && hasMissingProfileDefinition && <div className="telemetry-graph-status" role="status">A profile is assigned to this vehicle but its definition is unavailable in this browser. Attribute labels and values may be untranslated.</div>}
        {!mixedProfiles && !hasMissingProfileDefinition && hasUnassignedProfile && <div className="telemetry-graph-status" role="status">No protocol profile is assigned to this vehicle. Unmapped attributes are shown by key.</div>}
        {!preparedExport && shareStatus && <div className="telemetry-graph-status" role="status" aria-live="polite">{shareStatus}</div>}
      </div>}
      <div className="telemetry-graph-header"><div><h2>{title}</h2><small>{points.length} data points · drag across the plot to zoom · double-click to reset</small></div><div className="telemetry-graph-header-actions"><div className="telemetry-graph-zoom" aria-label="Graph zoom controls"><button type="button" className="small secondary" onClick={() => setZoom((current) => Math.max(.75, current - .25))} disabled={zoom <= .75} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button type="button" className="small secondary" onClick={() => setZoom((current) => Math.min(maxZoom, current + .25))} disabled={zoom >= maxZoom} aria-label="Zoom in">+</button><button type="button" className="small secondary" onClick={resetView} disabled={zoom === 1 && viewRange.start === 0 && viewRange.end === 1}>Reset</button></div><button type="button" className="small secondary" onClick={exportGraphTelemetry} disabled={points.length === 0 || exportBusy}>{exportBusy ? 'Preparing export…' : 'Export telemetry'}</button><button type="button" className="small secondary" onClick={() => setValueCursorRatio((current) => current == null ? .5 : null)}>{valueCursorRatio == null ? 'Show value cursor' : 'Hide value cursor'}</button><label className="telemetry-scale-switch"><span>Scale lines</span><input type="checkbox" role="switch" checked={independentScale} onChange={(event) => { setIndependentScale(event.target.checked); if (event.target.checked) setAutoScale(false) }} /><i /></label><label className="telemetry-scale-switch telemetry-normalize-switch"><span>Normalize scaling</span><input type="checkbox" role="switch" checked={autoScale} onChange={(event) => { setAutoScale(event.target.checked); if (event.target.checked) setIndependentScale(false) }} /><i /></label>{!publicMode && <button type="button" className="small secondary" onClick={onClose}>Close</button>}</div></div>
       <div className="telemetry-graph-plot-wrap" ref={plotWrapRef}>{series.length === 0 ? <div className="trip-empty">Select one or more numeric data elements to draw the graph.</div> : <><svg className="telemetry-graph-plot" width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Selected telemetry over time" onDoubleClick={resetView}><line x1={left} x2={left} y1={top} y2={top + innerHeight} stroke="currentColor" opacity=".5" /><line x1={left} x2={left + innerWidth} y1={top + innerHeight} y2={top + innerHeight} stroke="currentColor" opacity=".5" />{[0, .25, .5, .75, 1].map((ratio) => <g key={ratio}><line x1={left} x2={left + innerWidth} y1={top + innerHeight - ratio * innerHeight} y2={top + innerHeight - ratio * innerHeight} stroke="currentColor" opacity=".12" /></g>)}{timeTicks.map(({ ratio, label }) => <g key={`time-${label}`}><line x1={left + ratio * innerWidth} x2={left + ratio * innerWidth} y1={top + innerHeight} y2={top + innerHeight + 6} stroke="currentColor" opacity=".7" /><text x={left + ratio * innerWidth} y={top + innerHeight + 22} textAnchor="middle" fontSize="11" fill="currentColor">{label}</text></g>)}{groups.slice(0, -1).map((group, groupIndex) => { const last = group.points.at(-1); const point = last ? asPoint(last) : null; const index = point ? pointIndexByTimestamp.get(`${point.timestamp.getTime()}|${point.deviceId || ''}`) : null; return index == null ? null : <line key={`separator-${groupIndex}`} x1={xFor(index)} x2={xFor(index)} y1={top} y2={top + innerHeight} stroke="#ffffff" strokeDasharray="4 4" opacity=".5" /> })}{series.map((item) => { let path = ''; let connected = false; item.values.forEach((value, index) => { if (!Number.isFinite(value)) { connected = false; return } path += `${connected ? 'L' : 'M'} ${xFor(index)} ${yFor(value, item)} `; connected = true }); return <path key={item.id} d={path.trim()} fill="none" stroke={item.color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /> })}{dragRange && <rect className="telemetry-graph-selection" x={left + Math.min(dragRange.start, dragRange.current) * innerWidth} y={top} width={Math.abs(dragRange.current - dragRange.start) * innerWidth} height={innerHeight} />}{<rect className="telemetry-graph-brush" x={left} y={top} width={innerWidth} height={innerHeight} onPointerDown={beginDrag} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={() => setDragRange(null)} />}{valueCursorRatio != null && cursorVisible && <><line className="telemetry-value-cursor" x1={cursorX} x2={cursorX} y1={top} y2={top + innerHeight} /><rect className="telemetry-value-cursor-handle" x={cursorX - 7} y={top} width="14" height={innerHeight} onPointerDown={beginValueCursorDrag} onPointerMove={updateValueCursorDrag} onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)} onPointerCancel={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)} /></>}</svg><div className="telemetry-graph-y-axis" aria-hidden="true">{[1, .75, .5, .25, 0].map((ratio) => <span key={ratio}>{independentScale ? `${Math.round(ratio * 100)}%` : formatNumber(globalMin + (globalMax - globalMin) * ratio)}</span>)}</div></>}</div>
      <div className="telemetry-graph-legend">{series.map((item) => { const cursorValue = cursorPointIndex >= 0 ? item.values[cursorPointIndex] : null; const keyProfile = profileForKey(item.key, item.sourceKey); const group = groups.find((candidate) => sourceKeyForGroup(candidate) === item.sourceKey); const sourceName = deviceForGroup(group)?.name || group?.label || item.sourceKey; const label = `${labelFor(item.key, keyProfile, item.displayScale)} · ${sourceName}`; return <span key={item.id} style={{ '--series-color': item.color }}><input className="telemetry-legend-color" type="color" value={item.color} onChange={(event) => setSeriesColor(item.id, event.target.value)} title={`Set color for ${label}`} aria-label={`Set color for ${label}`} />{legendLabelFor(item.key, keyProfile, item.displayScale)} · {sourceName}: {valueCursorRatio == null ? `${formatNumber(item.min)}–${formatNumber(item.max)}` : (Number.isFinite(cursorValue) ? formatNumber(cursorValue) : '—')}{independentScale ? ' (normalized)' : ''}<button type="button" className="telemetry-legend-remove" title={`Remove ${label}`} aria-label={`Remove ${label} from graph`} onClick={() => setSelectedKeys((current) => current.filter((id) => id !== item.id))}>×</button></span> })}</div>
        <div className="telemetry-graph-controls"><strong>Data elements</strong><div className="telemetry-field-review-filters" role="group" aria-label="Filter telemetry fields">{reviewFilterOptions.map((option) => <button key={option.value} type="button" className={fieldReviewFilter === option.value ? 'active' : ''} aria-pressed={fieldReviewFilter === option.value} onClick={() => setFieldReviewFilter(option.value)}>{option.label} ({option.count})</button>)}</div><small className="telemetry-graph-ignored">Ignored for now: {ignoredTelemetryLabels}</small>{reviewAvailableKeys.length === 0 && <span className="trip-empty">No numeric telemetry is available for this selection.</span>}{reviewAvailableKeys.map((id) => { const { sourceKey, fieldKey: key } = parseGraphSeriesId(id); const { group, profile: keyProfile } = contextForKey(key, sourceKey); const scale = displayScalesByKey[id] || 1; const element = elementLabel(key, keyProfile, group, scale); const sourceName = deviceForGroup(group)?.name || group?.label || sourceKey; const savedPersonalLabel = Boolean(element.personalLabel); const suggestedLabel = Boolean(element.suggestedLabel); const uncertain = savedPersonalLabel || suggestedLabel; const labelStatus = savedPersonalLabel ? 'Guess' : 'Suggestion'; return <div key={id} className="telemetry-graph-element-row"><label className="telemetry-graph-element-checkbox"><input type="checkbox" checked={selectedKeys.includes(id)} onChange={() => setSelectedKeys((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} aria-label={`${element.label}${uncertain ? ` (${labelStatus})` : ''}`} /></label><div className="telemetry-graph-element-details"><span title={uncertain ? labelStatus : undefined} className={uncertain ? 'telemetry-graph-guessed-label' : undefined}>{element.label}<small className="telemetry-unplotted-source">{sourceName}</small></span><button ref={(node) => { fieldTargetRefs.current[id] = node }} type="button" className="telemetry-graph-field-target" onClick={() => { setEditingSourceKey(sourceKey); setEditingFieldKey(key) }} title={`Edit ${element.label}`} aria-label={`Edit field details for ${element.label}`}>{element.suffix}</button><input className="telemetry-legend-color" type="color" value={seriesColors[id] || defaultColorForKey(id)} onChange={(event) => setSeriesColor(id, event.target.value)} title={`Set color for ${element.label} from ${sourceName}`} aria-label={`Set color for ${element.label} from ${sourceName}`} /></div></div>})}{reviewUnplottedFields.length > 0 && <details className="telemetry-unplotted-fields"><summary>Other received fields ({reviewUnplottedFields.length})</summary><p>Not shown as numeric graph series. Values stay in the received data.</p><div>{reviewUnplottedFields.map(({ key, sourceKey, deviceId, valueCount, observedTypes, firstSeen, lastSeen }) => { const { group, profile: keyProfile } = contextForKey(key, sourceKey); const element = elementLabel(key, keyProfile, group); const uncertain = Boolean(element.personalLabel || element.suggestedLabel); const sourceName = deviceForGroup(group)?.name || group?.label || (deviceId == null ? '' : `Device ${deviceId}`); const when = firstSeen && lastSeen ? `${new Date(firstSeen).toLocaleString()} – ${new Date(lastSeen).toLocaleString()}` : ''; const targetKey = `${sourceKey}:${key}`; return <div className="telemetry-unplotted-field" key={targetKey}><span title={uncertain ? 'Guess or suggestion' : undefined} className={uncertain ? 'telemetry-graph-guessed-label' : undefined}>{element.label}{sourceName ? <small className="telemetry-unplotted-source">{sourceName}</small> : null}</span><small>{observedTypes.join(', ')} · {valueCount} points{when ? ` · ${when}` : ''}</small><button ref={(node) => { fieldTargetRefs.current[targetKey] = node }} type="button" className="telemetry-graph-field-target" onClick={() => { setEditingSourceKey(sourceKey); setEditingFieldKey(key) }} title={`Edit ${element.label}`} aria-label={`Edit field details for ${element.label}${sourceName ? ` from ${sourceName}` : ''}`}>{element.suffix}</button></div> })}</div></details>}</div>
    </div>
    {editingFieldKey && editingContext && <TelemetryFieldEditor
      key={`${editingContext.profile?.id || 'unassigned'}:${editingContext.group?.vehicleId || 'unbound'}:${editingContext.group?.deviceId || 'unbound'}:${editingFieldKey}`}
      profile={editingContext.profile}
      candidateMappings={editingElement?.relatedSuggestions || []}
      fieldKey={editingFieldKey}
      vehicleLabel={vehicleMetadataList.find((item) => item.id === editingContext.group?.vehicleId)?.displayName || vehicleMetadata?.displayName || ''}
      deviceLabel={editingDevice?.name || ''}
      deviceModel={editingDevice?.model || ''}
      matchContext={editingMatchContext}
      sampleValue={editingFieldKey === SPEED_KEY ? editingContext.point?.speedMph ?? editingContext.point?.speed ?? null : editingContext.point?.attributes?.[editingFieldKey] ?? null}
      personalLabel={editingElement?.personalLabel || ''}
      suggestionsDismissed={Boolean(editingElement?.suggestionsDismissed)}
      canEditShared={canEditSharedProfiles}
      canEditSourceMapping={canEditSharedProfiles && !publicMode}
      traccarDeviceId={editingContext.group?.deviceId}
      sourceMappingHistory={editingSourceHistory}
      supportsSharedMapping={editingFieldKey !== SPEED_KEY}
      sharedProfileVehicleCount={profileVehicleCounts[editingContext.profile?.id] || 0}
      onSavePersonalLabel={(label) => savePersonalFieldLabel(editingElement.scopeKey, label)}
      onDismissSuggestion={(candidateProfileId) => dismissSuggestion(editingElement.scopeKey, candidateProfileId)}
      onDismissAllSuggestions={() => dismissAllSuggestions(editingElement.scopeKey, editingContext.profile, editingFieldKey, editingSourceKey)}
      onRestoreDismissedSuggestions={() => restoreDismissedSuggestions(editingElement.scopeKey, editingElement.legacyScopeKey)}
      onSaveSharedMapping={onSaveSharedMapping}
      onSaveSourceMapping={async (mapping) => {
        const deviceId = Number(editingContext.group?.deviceId)
        if (!Number.isInteger(deviceId) || deviceId <= 0) return { ok: false, message: 'This graph has no Traccar device id for a tracker-specific mapping.' }
        const validationError = validateAttributeMap({ [editingFieldKey]: mapping })
        if (validationError) return { ok: false, message: validationError }
        const history = sourceMappingState[deviceId] || []
        const expectedRevision = Math.max(0, ...history.filter((item) => item.fieldKey === editingFieldKey).map((item) => Number(item.revision) || 0))
        const saved = await saveTelemetrySourceMapping(vehicleApiBaseUrl, deviceId, editingFieldKey, mapping, expectedRevision, 'manual')
        const revision = { fieldKey: editingFieldKey, revision: saved.revision, effectiveAt: saved.effectiveAt, mapping, changeKind: 'manual' }
        setSourceMappingState((current) => ({ ...current, [deviceId]: appendSourceMappingRevision(current[deviceId], revision) }))
        onSourceMappingSaved?.(deviceId, revision)
        return { ok: true, message: 'Tracker mapping saved. It applies from now forward; earlier telemetry keeps its previous interpretation.' }
      }}
      onUndoSourceMapping={async () => {
        const deviceId = Number(editingContext.group?.deviceId)
        if (!Number.isInteger(deviceId) || deviceId <= 0) return { ok: false, message: 'This graph has no Traccar device id for a tracker-specific mapping.' }
        const history = (sourceMappingState[deviceId] || []).filter((item) => item.fieldKey === editingFieldKey)
        const target = sourceMappingUndoTarget(history)
        if (!target) return { ok: false, message: 'No tracker-only mapping exists to undo.' }
        const saved = await saveTelemetrySourceMapping(vehicleApiBaseUrl, deviceId, editingFieldKey, target.mapping, target.expectedRevision, 'undo')
        const mapping = target.mapping
        const revision = { fieldKey: editingFieldKey, revision: saved.revision, effectiveAt: saved.effectiveAt, mapping, changeKind: 'undo' }
        setSourceMappingState((state) => ({ ...state, [deviceId]: appendSourceMappingRevision(state[deviceId], revision) }))
        return { ok: true, message: target.restoredRevision ? 'The prior tracker-only mapping is active again from now forward.' : 'The tracker override was removed; the shared profile applies from now forward.' }
      }}
      onClose={() => { setEditingFieldKey(null); setEditingSourceKey(null) }}
    />}
  </div>
}

export default TelemetryGraphViewer

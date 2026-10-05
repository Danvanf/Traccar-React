import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, offset, shift, useFloating } from '@floating-ui/react-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import HistoryNavigator from './components/HistoryNavigator'
import DeviceList from './components/DeviceList'
import ExportPanel from './components/ExportPanel'
import SettingsModal from './components/SettingsModal'
import StatusCard from './components/StatusCard'
import TripPanel from './components/TripPanel'
import VehicleStatusCard from './components/VehicleStatusCard'
import VehicleStatsPanel from './components/VehicleStatsPanel'
import NotificationsPanel from './components/NotificationsPanel'
import TelemetryGraphViewer from './components/TelemetryGraphViewer'
import { buildRangeCsv, downloadCsvFile, parseAppPositionCsv } from './lib/csvExport'
import { buildProfileMap, DEFAULT_PROFILE_ID, validateAttributeMap } from './lib/carProfiles'
import { metersBetween, toHistoryPosition } from './lib/geo'
import {
  loadDeviceProfileAssignments,
  loadProfileDefinitions,
  saveDeviceProfileAssignments,
  saveProfileDefinitions,
} from './lib/profileStore'
import { DEFAULT_SETTINGS, PALETTE, readSettings, saveSettings } from './lib/settings'
import { createRequestGate } from './lib/requestGate'
import { getExportRangePreset, getRangeFromMode, toDateInputValue, toLocalInputValue } from './lib/time'
import { createTraccarApi } from './lib/traccarApi'
import { buildTripsForDevice, getTripMaxSpeedMph, summarizeTripsByDay } from './lib/trips'
import { parseBouncieCsv } from './lib/bouncieCsv'
import { collapseTripEvents, detectTripEvents, formatEventMeasurement, resolveEventThresholds } from './lib/tripEvents'
import { DEFAULT_SPEED_BANDS, getSpeedBandsForVehicle, speedBandFor } from './lib/speedBands'
import { DEFAULT_STATUS_CARD_FIELDS } from './lib/statusCardFields'
import {
  addTagToTrip,
  deleteDeviceBinding,
  resolveTrip,
  fetchTripTagsForTrip,
  deleteNamedPlace,
  fetchActiveDeviceBindings,
  fetchNearestDeviceBinding,
  fetchNamedPlaces,
  fetchTripTags,
  fetchOperationsReport,
  fetchTripEvents,
  fetchTripRoutePoints,
  fetchTripEventNotifications,
  fetchTripHistorySpan,
  fetchTripHistoryMonthSummaries,
  fetchTripDaySummaries,
  deleteCalculatedTripEvents,
  fetchVehicleCatalog,
  upsertVehicle,
  importTripsByDevice,
  importBouncieTrips,
  fetchBouncieStatus,
  fetchBouncieBackfillCoverage,
  beginBouncieAuthorization,
  beginStoredBouncieAuthorization,
  startBouncieImport,
  cancelBouncieImport,
  forgetBouncieCredentials,
  restoreBouncieConnection,
  repairMissingDeviceBinding,
  removeTagFromTrip,
  saveTripEvents,
  updateTripNotes,
  upsertNamedPlace,
  upsertTripTag,
  deleteTripTag,
  upsertDeviceBinding,
  fetchVehicleAuthStatus,
  fetchUserPreference,
  saveUserPreference,
  fetchVehicleSpeedBands,
  fetchStatusCardFields,
  saveStatusCardFields as persistStatusCardFields,
  loginVehicleApi,
  logoutVehicleApi,
} from './lib/vehicleAppApi'

const MAX_INT32 = 2147483647
const METERS_PER_YARD = 0.9144
const YARDS_PER_METER = 1 / METERS_PER_YARD
const MAP_CONTENT_SHIFT_PX = 50

function fitBoundsWithPanelOffset(map, bounds, padding) {
  map.fitBounds(bounds, { padding })
  // Move the fitted content right to leave room for the floating Trips panel.
  map.panBy([-MAP_CONTENT_SHIFT_PX, 0], { animate: false })
}
const TAG_COLOR_PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4f46e5']

function toPositiveInt32(value) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > MAX_INT32) {
    return null
  }

  return numeric
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function suggestVehicleIdForDevice(deviceId, devices, vehicles) {
  if (!deviceId || !Array.isArray(devices) || !Array.isArray(vehicles) || vehicles.length === 0) {
    return null
  }

  const device = devices.find((item) => item.id === deviceId)
  if (!device?.name) {
    return vehicles.length === 1 ? vehicles[0].id : null
  }

  const deviceName = normalizeName(device.name)
  if (!deviceName) {
    return vehicles.length === 1 ? vehicles[0].id : null
  }

  const exact = vehicles.filter((vehicle) => normalizeName(vehicle.displayName) === deviceName)
  if (exact.length === 1) {
    return exact[0].id
  }

  const fuzzy = vehicles.filter((vehicle) => {
    const vehicleName = normalizeName(vehicle.displayName)
    return vehicleName.includes(deviceName) || deviceName.includes(vehicleName)
  })

  if (fuzzy.length === 1) {
    return fuzzy[0].id
  }

  return vehicles.length === 1 ? vehicles[0].id : null
}

function distanceMetersBetween(latitudeA, longitudeA, latitudeB, longitudeB) {
  const earthRadius = 6371000
  const toRadians = (value) => (value * Math.PI) / 180
  const dLat = toRadians(latitudeB - latitudeA)
  const dLon = toRadians(longitudeB - longitudeA)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(dLon / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function labelForNamedPlace(latitude, longitude, places, vehicleId) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const candidates = places
    .filter((place) => !place.vehicleId || place.vehicleId === vehicleId)
    .map((place) => ({ place, distance: distanceMetersBetween(latitude, longitude, place.latitude, place.longitude) }))
    .filter(({ place, distance }) => distance <= Math.max(1, Number(place.radiusMeters) || 1))
    .sort((a, b) => a.distance - b.distance)
  return candidates[0]?.place.name || null
}

function summarizeSavedTrips(rows) {
  const grouped = new Map()
  rows.forEach((row) => {
    const date = new Date(row.startedAt)
    if (Number.isNaN(date.getTime())) return
    const dayKey = row.dayKey || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const current = grouped.get(dayKey) || { dayKey, tripCount: 0, distanceM: 0, durationSeconds: 0, maxSpeedMph: null, eventCount: 0 }
    current.tripCount += 1
    current.distanceM += Number(row.distanceMeters) || 0
    current.durationSeconds += Number(row.durationSeconds) || 0
    const maxSpeed = Number(row.maxSpeedMph)
    if (Number.isFinite(maxSpeed)) current.maxSpeedMph = current.maxSpeedMph == null ? maxSpeed : Math.max(current.maxSpeedMph, maxSpeed)
    current.eventCount += Number(row.eventCount) || 0
    grouped.set(dayKey, current)
  })
  return [...grouped.values()].sort((a, b) => b.dayKey.localeCompare(a.dayKey))
}

function rowMatchesTripIdentity(row, trip) {
  const rowDeviceId = Number(row?.traccarDeviceId)
  const tripDeviceId = Number(trip?.deviceId)
  if (!Number.isFinite(rowDeviceId) || !Number.isFinite(tripDeviceId) || rowDeviceId !== tripDeviceId) {
    return false
  }

  const rowStartSourceId = Number(row?.startTraccarPositionId)
  const rowEndSourceId = Number(row?.endTraccarPositionId)
  const tripStartSourceId = Number(trip?.startTraccarPositionId)
  const tripEndSourceId = Number(trip?.endTraccarPositionId)
  const hasRowSourceIdentity = Number.isFinite(rowStartSourceId) && rowStartSourceId > 0
    && Number.isFinite(rowEndSourceId) && rowEndSourceId > 0
  const hasTripSourceIdentity = Number.isFinite(tripStartSourceId) && tripStartSourceId > 0
    && Number.isFinite(tripEndSourceId) && tripEndSourceId > 0

  if (hasRowSourceIdentity && hasTripSourceIdentity) {
    // A trip can be synchronized while it is still receiving positions. Its
    // end position may move forward later, but the unique Traccar start
    // position still identifies the same trip.
    return rowStartSourceId === tripStartSourceId
  }

  const rowStarted = new Date(row?.startedAt)
  const rowEnded = new Date(row?.endedAt)
  const tripStartedAt = trip?.start instanceof Date ? trip.start : new Date(trip?.start)
  const tripEndedAt = trip?.end instanceof Date ? trip.end : new Date(trip?.end)
  if (
    Number.isNaN(rowStarted.getTime())
    || Number.isNaN(rowEnded.getTime())
    || Number.isNaN(tripStartedAt.getTime())
    || Number.isNaN(tripEndedAt.getTime())
  ) {
    return false
  }

  return Math.abs(rowStarted.getTime() - tripStartedAt.getTime()) < 5000
    && Math.abs(rowEnded.getTime() - tripEndedAt.getTime()) < 2000
}

function mergeHistoryRows(existingRows, incomingRows) {
  return [...new Map([...(existingRows || []), ...(incomingRows || [])]
    .map((row) => [row.id || `${row.startedAt}|${row.endedAt}|${row.vehicleId || ''}`, row])).values()]
}

function toMonthKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function buildMonthRangeKeys(earliestIso, latestIso) {
  const earliest = new Date(earliestIso)
  const latest = new Date(latestIso)
  if (Number.isNaN(earliest.getTime()) || Number.isNaN(latest.getTime())) return []
  const cursor = new Date(earliest.getFullYear(), earliest.getMonth(), 1)
  const end = new Date(latest.getFullYear(), latest.getMonth(), 1)
  const keys = []
  while (cursor <= end) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return keys.reverse()
}

function formatUtcIsoForUi(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

function formatTripSourceIdsForUi(startId, endId) {
  const start = Number.isFinite(Number(startId)) ? String(startId) : null
  const end = Number.isFinite(Number(endId)) ? String(endId) : null
  if (!start && !end) return null
  return `${start || '?'} -> ${end || '?'}`
}

function summarizeConflictTripForUi(trip) {
  if (!trip || typeof trip !== 'object') return null
  return {
    id: trip.id || null,
    idShort: trip.id ? String(trip.id).slice(0, 8) : null,
    startedAtLabel: formatUtcIsoForUi(trip.startedAt),
    endedAtLabel: formatUtcIsoForUi(trip.endedAt),
    sourceIdsLabel: formatTripSourceIdsForUi(trip.startTraccarPositionId, trip.endTraccarPositionId),
  }
}

function describeTripImportConflict(error, fallbackDeviceId = null) {
  if (!error || Number(error.status) !== 409) return null
  const problem = error.problem && typeof error.problem === 'object' ? error.problem : {}
  const code = String(problem.code || error.code || '').trim()
  const detail = String(problem.detail || '').trim()
  const conflictReason = String(problem.conflictReason || '').trim() || null
  const incomingTrip = problem.incomingTrip && typeof problem.incomingTrip === 'object' ? problem.incomingTrip : null
  const startedAtLabel = formatUtcIsoForUi(incomingTrip?.startedAt || problem.startedAt)
  const endedAtLabel = formatUtcIsoForUi(incomingTrip?.endedAt || problem.endedAt)
  const incomingSourceIdsLabel = formatTripSourceIdsForUi(incomingTrip?.startTraccarPositionId, incomingTrip?.endTraccarPositionId)
  const traccarDeviceId = toPositiveInt32(problem.traccarDeviceId) || toPositiveInt32(fallbackDeviceId)
  const conflictingTripIds = Array.isArray(problem.conflictingTripIds) ? problem.conflictingTripIds : []
  const conflictingTrips = Array.isArray(problem.conflictingTrips)
    ? problem.conflictingTrips.map(summarizeConflictTripForUi).filter(Boolean)
    : []
  const firstConflictingTrip = conflictingTrips[0] || null
  const conflictingTripIdsShort = conflictingTripIds
    .map((value) => String(value || '').slice(0, 8))
    .filter(Boolean)

  const withFacts = (payload) => ({
    ...payload,
    code: code || null,
    traccarDeviceId,
    startedAt: incomingTrip?.startedAt || problem.startedAt || null,
    endedAt: incomingTrip?.endedAt || problem.endedAt || null,
    startedAtLabel,
    endedAtLabel,
    incomingSourceIdsLabel,
    conflictReason,
    conflictingTripIds,
    conflictingTripIdsShort,
    conflictingTrips,
    firstConflictingTrip,
  })

  if (code === 'trip_import_binding_missing') {
    const rangeLabel = startedAtLabel && endedAtLabel ? ` for ${startedAtLabel} to ${endedAtLabel}` : ''
    return withFacts({
      title: 'Import blocked by missing device assignment',
      detail: `A complete vehicle binding was not found${rangeLabel}.`,
      status: 'Binding required before import',
      steps: [
        traccarDeviceId
          ? `Confirm the nearby Vehicle Catalog assignment suggested for device id ${traccarDeviceId}.`
          : 'Confirm the nearby Vehicle Catalog assignment suggested for this Traccar device.',
        'Set Effective From at or before the trip start time.',
        'Click Save Binding and Retry Import.',
      ],
      bindingHintDeviceId: traccarDeviceId,
    })
  }

  if (code === 'trip_import_binding_ambiguous') {
    return withFacts({
      title: 'Import blocked by overlapping bindings',
      detail: startedAtLabel && endedAtLabel
        ? `More than one binding covers ${startedAtLabel} to ${endedAtLabel}.`
        : 'More than one binding covers this trip window.',
      status: 'Binding history conflict',
      steps: [
        'Review the assignment list at the bottom of Settings > Vehicle Catalog.',
        'Ensure exactly one binding covers each imported trip time window.',
        'Retry the same import range after the overlap is resolved.',
      ],
      bindingHintDeviceId: traccarDeviceId,
    })
  }

  if (code === 'trip_import_conflict') {
    const duplicateLabel = conflictingTripIds.length > 0 ? ` (${conflictingTripIds.length} conflicting saved trip(s) detected).` : '.'
    const compareWindow = firstConflictingTrip?.startedAtLabel && firstConflictingTrip?.endedAtLabel && startedAtLabel && endedAtLabel
      ? ` Saved trip ${firstConflictingTrip.idShort || 'record'} covers ${firstConflictingTrip.startedAtLabel} to ${firstConflictingTrip.endedAtLabel}, while the current derived trip is ${startedAtLabel} to ${endedAtLabel}.`
      : ''
    const compareSource = firstConflictingTrip?.sourceIdsLabel && incomingSourceIdsLabel && firstConflictingTrip.sourceIdsLabel !== incomingSourceIdsLabel
      ? ` Saved source IDs are ${firstConflictingTrip.sourceIdsLabel}; current derived source IDs are ${incomingSourceIdsLabel}.`
      : ''
    const mismatchHint = conflictReason === 'source_id_mismatch'
      ? 'The saved and derived source position IDs do not match.'
      : (conflictReason === 'time_window_mismatch'
          ? 'The saved and derived time windows do not match.'
          : 'The saved and derived trip identity does not match.')
    return withFacts({
      title: 'Import blocked by saved-history identity conflict',
      detail: `${mismatchHint}${duplicateLabel}${compareWindow}${compareSource}`.trim(),
      status: 'Saved history conflict',
      steps: [
        'Open the conflict details and compare the saved vs current time windows and source IDs.',
        'If this is background sync, keep the saved trip as authoritative and avoid repeated retries for the same day.',
        'If you need to regenerate that period, reconcile the conflicting saved trip first, then rerun import once.',
      ],
      bindingHintDeviceId: null,
    })
  }

  if (code === 'trip_import_concurrent_conflict') {
    return withFacts({
      title: 'Import collided with another active write',
      detail: detail || 'Another operation changed trip history while this batch was saving.',
      status: 'Concurrent import conflict',
      steps: [
        'Wait for other import activity on this device to finish.',
        'Retry once with the same range and settings.',
      ],
      bindingHintDeviceId: traccarDeviceId,
    })
  }

  if (detail.includes('No complete vehicle binding covers')) {
    return withFacts({
      title: 'Import blocked by missing device assignment',
      detail: 'A complete vehicle binding was not found for this import window.',
      status: 'Binding required before import',
      steps: [
        'Review the assignment list at the bottom of Settings > Vehicle Catalog.',
        'Set Effective From at or before the trip start time.',
        'Retry the same range.',
      ],
      bindingHintDeviceId: traccarDeviceId,
    })
  }

  if (detail.includes('Multiple vehicle bindings cover')) {
    return withFacts({
      title: 'Import blocked by overlapping bindings',
      detail: 'More than one assignment covers the same trip window.',
      status: 'Binding history conflict',
      steps: [
        'Review the assignment list at the bottom of Settings > Vehicle Catalog.',
        'Retry the same range after one binding remains for the period.',
      ],
      bindingHintDeviceId: traccarDeviceId,
    })
  }

  if (detail.includes('overlaps saved history') || detail.includes('conflicts with saved history')) {
    return withFacts({
      title: 'Import blocked by saved-history identity conflict',
      detail: 'The selected range conflicts with existing saved trips.',
      status: 'Saved history conflict',
      steps: [
        'Retry using the original range and movement threshold.',
        'If you must change boundaries, reconcile conflicting saved trips first.',
      ],
      bindingHintDeviceId: null,
    })
  }

  return withFacts({
    title: 'Trip import returned a conflict',
    detail: detail || 'The server rejected this batch to protect saved history.',
    status: 'Trip import conflict',
    steps: [
      'Review Vehicle Catalog assignments and effective dates.',
      'Retry once with the same date range and movement threshold.',
    ],
    bindingHintDeviceId: traccarDeviceId,
  })
}

function App() {
  const [settings, setSettings] = useState(readSettings)
  const [vehicleAuth, setVehicleAuth] = useState({ checking: true, enabled: false, authenticated: false, username: null, role: null })
  const [vehicleLoginUsername, setVehicleLoginUsername] = useState('')
  const [vehicleLoginPassword, setVehicleLoginPassword] = useState('')
  const [vehicleLoginError, setVehicleLoginError] = useState('')
  // Bouncie client credentials are transient in the browser and are sent only
  // to the API to begin OAuth. The API encrypts them after a successful flow.
  const [bouncieClientId, setBouncieClientId] = useState('traccar-react')
  const [bouncieClientSecret, setBouncieClientSecret] = useState('')
  const [bouncieRedirectUri, setBouncieRedirectUri] = useState('http://localhost:5124/signin-bouncie')
  const [bouncieAuthorizationUrl, setBouncieAuthorizationUrl] = useState('')
  const [bouncieImportFrom, setBouncieImportFrom] = useState(() => toDateInputValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
  const [bouncieImportThrough, setBouncieImportThrough] = useState(() => toDateInputValue(new Date()))
  const [bouncieStatus, setBouncieStatus] = useState({ connected: false, storedCredentials: false, import: { state: 'disconnected', message: 'Not connected to Bouncie.' }, vehicles: [] })
  const [bouncieCoverage, setBouncieCoverage] = useState([])
  const [bouncieBusy, setBouncieBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  const { refs: tripFlyoutRefs, floatingStyles: tripFlyoutStyles } = useFloating({
    placement: 'right-start',
    strategy: 'fixed',
    middleware: [offset({ mainAxis: 8, crossAxis: 40 }), shift({ padding: 16 })],
    whileElementsMounted: autoUpdate,
  })
  const [showTripsPanel, setShowTripsPanel] = useState(false)
  const [tripFlyoutPosition, setTripFlyoutPosition] = useState(null)
  const [vehicleStatusPosition, setVehicleStatusPosition] = useState(null)
  const [error, setError] = useState('')
  const [sessionState, setSessionState] = useState('unknown')
  const [isAutoFitPaused, setIsAutoFitPaused] = useState(false)
  const [devices, setDevices] = useState([])
  const [deviceColors, setDeviceColors] = useState({})
  const [deviceVisibility, setDeviceVisibility] = useState({})
  const [deviceListSelectedId, setDeviceListSelectedId] = useState(null)
  const [statusDeviceId, setStatusDeviceId] = useState(null)
  const [selectedMapPoint, setSelectedMapPoint] = useState(null)
  const [historyByDevice, setHistoryByDevice] = useState({})
  const [historyDaySummaries, setHistoryDaySummaries] = useState([])
  const [historyDayRows, setHistoryDayRows] = useState([])
  const historyDayRowsRef = useRef([])
  const [historyRoutePoints, setHistoryRoutePoints] = useState([])
  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsRefreshNonce, setNotificationsRefreshNonce] = useState(0)
  const [timeMode, setTimeMode] = useState('history')
  const [customFrom, setCustomFrom] = useState(() => toLocalInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000)))
  const [customTo, setCustomTo] = useState(() => toLocalInputValue(new Date()))
  const DEFAULT_HISTORY_LOOKBACK_DAYS = 365
  const [historyWindow, setHistoryWindow] = useState(() => ({ from: new Date(Date.now() - DEFAULT_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000), to: new Date() }))
  const [historySpan, setHistorySpan] = useState({ earliestStartedAt: null, latestEndedAt: null, tripCount: 0 })
  const [historyMonthSummaryByKey, setHistoryMonthSummaryByKey] = useState({})
  const [historyMonthLoadState, setHistoryMonthLoadState] = useState({})
  const [selectedDayKey, setSelectedDayKey] = useState(null)
  const [selectedDayKeys, setSelectedDayKeys] = useState([])
  const notificationSelectedDays = useMemo(() => (selectedDayKeys.length > 0
    ? [...selectedDayKeys].sort()
    : (selectedDayKey ? [selectedDayKey] : [])), [selectedDayKey, selectedDayKeys])
  const notificationsRangeLabel = useMemo(() => {
    if (notificationSelectedDays.length === 0) return 'Last 7 days'
    if (notificationSelectedDays.length > 1) return `${notificationSelectedDays.length} selected days`
    return new Date(`${notificationSelectedDays[0]}T12:00:00`).toLocaleDateString()
  }, [notificationSelectedDays])
  const [daySelectionAnchor, setDaySelectionAnchor] = useState(null)
  const [selectedTripId, setSelectedTripId] = useState(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDataTransferOpen, setIsDataTransferOpen] = useState(false)
  const [operationsReport, setOperationsReport] = useState(null)
  const [operationsReportBusy, setOperationsReportBusy] = useState(false)
  const [isPickingLocation, setIsPickingLocation] = useState(false)
  const [showNamedPlaces, setShowNamedPlaces] = useState(true)
  // `null` represents All devices for trip imports. CSV export still requires
  // selecting one concrete device.
  const [exportDeviceId, setExportDeviceId] = useState(null)
  const [exportRangePreset, setExportRangePreset] = useState('today')
  const [exportStartDate, setExportStartDate] = useState(() => toDateInputValue(new Date()))
  const [exportEndDate, setExportEndDate] = useState(() => toDateInputValue(new Date()))
  const [exportHeaderMode, setExportHeaderMode] = useState('translated')
  const [profileDefinitions, setProfileDefinitions] = useState(loadProfileDefinitions)
  const [deviceProfileById, setDeviceProfileById] = useState(loadDeviceProfileAssignments)
  const [selectedProfileId, setSelectedProfileId] = useState(DEFAULT_PROFILE_ID)
  const [profileName, setProfileName] = useState('')
  const [profileAttributesJson, setProfileAttributesJson] = useState('{}')
  const [profileEditorStatus, setProfileEditorStatus] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [importRecovery, setImportRecovery] = useState(null)
  const [bindingRepairSuggestion, setBindingRepairSuggestion] = useState(null)
  const [bindingRepairBusy, setBindingRepairBusy] = useState(false)
  const [bindingRepairStatus, setBindingRepairStatus] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [dataImportMessage, setDataImportMessage] = useState('')
  const [isImportingTrips, setIsImportingTrips] = useState(false)
  const [bindingStatus, setBindingStatus] = useState('')
  const [bindingVehicles, setBindingVehicles] = useState([])
  const [speedBandsByVehicle, setSpeedBandsByVehicle] = useState({})
  const [statusCardFieldsByVehicle, setStatusCardFieldsByVehicle] = useState({})
  const [vehicleEditId, setVehicleEditId] = useState(null)
  const [vehicleName, setVehicleName] = useState('')
  const [vehicleVin, setVehicleVin] = useState('')
  const [vehicleYear, setVehicleYear] = useState('')
  const [vehicleMake, setVehicleMake] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehicleNotes, setVehicleNotes] = useState('')
  const [vehicleProfileById, setVehicleProfileById] = useState(() => {
    try { return JSON.parse(localStorage.getItem('traccarVehicleProfileAssignments') || '{}') } catch { return {} }
  })
  const [vehicleEditorStatus, setVehicleEditorStatus] = useState('')
  const [vehicleProfileId, setVehicleProfileId] = useState('')
  const [vehicleDeviceId, setVehicleDeviceId] = useState('')
  const [vehicleEffectiveFrom, setVehicleEffectiveFrom] = useState(() => {
    const date = new Date()
    date.setSeconds(0, 0)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })
  const [activeBindings, setActiveBindings] = useState([])
  const [filterBindingsToSelectedDevice, setFilterBindingsToSelectedDevice] = useState(false)
  const [bindingDeviceId, setBindingDeviceId] = useState(null)
  const [bindingVehicleId, setBindingVehicleId] = useState(null)
  const [bindingEffectiveFrom, setBindingEffectiveFrom] = useState(() => {
    const date = new Date()
    date.setSeconds(0, 0)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })
  const [isBindingBusy, setIsBindingBusy] = useState(false)
  const [importBindingHintDeviceId, setImportBindingHintDeviceId] = useState(null)
  const [enrichmentStatus, setEnrichmentStatus] = useState('')
  const [namedPlaces, setNamedPlaces] = useState([])
  const [mapReady, setMapReady] = useState(false)
  const [tripTags, setTripTags] = useState([])
  const [placeVehicleId, setPlaceVehicleId] = useState(null)
  const [placeName, setPlaceName] = useState('')
  const [placeEditId, setPlaceEditId] = useState(null)
  const [placeLatitude, setPlaceLatitude] = useState('')
  const [placeLongitude, setPlaceLongitude] = useState('')
  const [placeRadiusYards, setPlaceRadiusYards] = useState('75')
  const [placeNotes, setPlaceNotes] = useState('')
  const [tagVehicleId, setTagVehicleId] = useState(null)
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('')
  const [selectedTrip, setSelectedTrip] = useState(null)
  const [selectedTripMaxSpeedMph, setSelectedTripMaxSpeedMph] = useState(null)
  const [selectedBackendTripId, setSelectedBackendTripId] = useState(null)
  const [selectedTripRoutePoints, setSelectedTripRoutePoints] = useState([])
  const [graphGroups, setGraphGroups] = useState(null)
  const tripSelectionGate = useRef(createRequestGate())
  const [tripEditorBusy, setTripEditorBusy] = useState(false)
  const tripWritePending = useRef(false)
  const autoCalculatedDaysRef = useRef(new Set())
  // The point cache contains one selected day at a time. This tracks which
  // day is currently in that cache; revisiting an earlier day must fetch it
  // again after another day replaced the points.
  const loadedPointDaysRef = useRef(new Set())
  const loadedHistoryMonthsRef = useRef(new Set())
  const pointLoadRequestRef = useRef(0)
  const startupLoadRef = useRef(false)
  const initialCurrentLocationsLoadedRef = useRef(false)
  const [tripEditorLoading, setTripEditorLoading] = useState(false)
  const [tripEditorStatus, setTripEditorStatus] = useState('')
  const [tripEditorAvailableTags, setTripEditorAvailableTags] = useState([])
  const [tripEditorTags, setTripEditorTags] = useState([])
  const [selectedTripEvents, setSelectedTripEvents] = useState([])
  const [tagToAdd, setTagToAdd] = useState('')
  const [tripNoteDraft, setTripNoteDraft] = useState('')

  const runOperationsReport = useCallback(async (report) => {
    setOperationsReportBusy(true)
    try {
      setOperationsReport(await fetchOperationsReport(settings.vehicleApiBaseUrl, report))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operations report failed')
    } finally {
      setOperationsReportBusy(false)
    }
  }, [settings.vehicleApiBaseUrl])

  const downloadOperationsReport = useCallback(() => {
    if (!operationsReport) return
    const blob = new Blob([JSON.stringify(operationsReport, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `vehicle-app-${operationsReport.report}-report.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [operationsReport])

  const selectDay = useCallback((dayKey, { ctrlKey = false, metaKey = false, shiftKey = false, toggle = false } = {}) => {
    setNotifications([])
    if (!dayKey) {
      setSelectedDayKey(null)
      setSelectedDayKeys([])
      setDaySelectionAnchor(null)
      return
    }
    // Selecting a day is an explicit request to inspect its trips. Reopen the
    // flyout even when the user previously hid it manually.
    setShowTripsPanel(true)
    const modifierToggle = ctrlKey || metaKey || toggle
    const currentSelection = selectedDayKeys.length > 0 ? selectedDayKeys : (selectedDayKey ? [selectedDayKey] : [])
    let nextSelection
    if (shiftKey && daySelectionAnchor) {
      const ordered = historyDaySummaries.map((day) => day.dayKey)
      const start = ordered.indexOf(daySelectionAnchor)
      const end = ordered.indexOf(dayKey)
      if (start >= 0 && end >= 0) {
        const range = ordered.slice(Math.min(start, end), Math.max(start, end) + 1)
        nextSelection = range
      }
    } else if (modifierToggle) {
      nextSelection = currentSelection.includes(dayKey) ? currentSelection.filter((key) => key !== dayKey) : [...currentSelection, dayKey]
    } else {
      nextSelection = [dayKey]
    }
    nextSelection ||= [dayKey]
    setSelectedDayKeys(nextSelection)
    const nextAnchor = nextSelection.at(-1) || null
    setDaySelectionAnchor(nextAnchor)
    setSelectedDayKey(nextAnchor)
    setSelectedTrip(null)
    setSelectedTripId(null)
    setSelectedBackendTripId(null)
    setSelectedTripRoutePoints([])
    setSelectedTripMaxSpeedMph(null)
    setTripEditorStatus('')
    mapAutoFitRef.current = true
  }, [daySelectionAnchor, historyDaySummaries, selectedDayKey, selectedDayKeys])

  const mapElementRef = useRef(null)
  const mapRef = useRef(null)
  const markerLayerRef = useRef(null)
  const trailLayerRef = useRef(null)
  const selectedTripLayerRef = useRef(null)
  const eventMarkerRefs = useRef({})
  const namedPlaceLayerRef = useRef(null)
  const namedPlacesControlRef = useRef(null)
  const resetAutoZoomControlRef = useRef(null)
  const cancelLocationControlRef = useRef(null)
  const resetMapAutoFitActionRef = useRef(null)
  const mapAutoFitRef = useRef(true)
  const programmaticMapMoveRef = useRef(false)
  const liveIntervalRef = useRef(null)
  const sessionAttemptedRef = useRef(false)
  const bouncieHistoryRefreshRef = useRef(null)

  const updateSetting = useCallback((key, value) => {
    if (key === 'vehicleApiBaseUrl') {
      tripSelectionGate.current.begin()
      setSelectedBackendTripId(null)
      setTripEditorTags([])
      setTripNoteDraft('')
      setTripEditorLoading(false)
      setTripEditorStatus('Vehicle API changed. Select the trip again to load its metadata.')
    }
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }))
  }, [])

  const refreshBouncieStatus = useCallback(async () => {
    try {
      const status = await fetchBouncieStatus(settings.vehicleApiBaseUrl)
      setBouncieStatus(status)
      setBouncieCoverage(await fetchBouncieBackfillCoverage(settings.vehicleApiBaseUrl))
    } catch (err) {
      if (err?.status !== 401) setBouncieStatus((current) => ({ ...current, import: { ...current.import, message: err instanceof Error ? err.message : 'Unable to read Bouncie status.' } }))
    }
  }, [settings.vehicleApiBaseUrl])

  const connectBouncieAccount = useCallback(async () => {
    const popup = window.open('', 'bouncie-oauth', 'popup,width=640,height=760')
    setBouncieBusy(true)
    try {
      const authorization = bouncieStatus?.storedCredentials && !bouncieClientSecret
        ? await beginStoredBouncieAuthorization(settings.vehicleApiBaseUrl)
        : await beginBouncieAuthorization(settings.vehicleApiBaseUrl, {
          clientId: bouncieClientId,
          clientSecret: bouncieClientSecret,
          redirectUri: bouncieRedirectUri,
        })
      setBouncieAuthorizationUrl(authorization.authorizationUrl || '')
      if (popup && authorization.authorizationUrl) popup.location = authorization.authorizationUrl
      else if (!popup) setBouncieStatus((current) => ({ ...current, import: { ...current.import, state: 'running', message: 'Authorization URL ready below. Open it to connect Bouncie.' } }))
      setBouncieClientSecret('')
    } catch (err) {
      if (popup) popup.close()
      setBouncieStatus((current) => ({ ...current, import: { ...current.import, state: 'failed', message: err instanceof Error ? err.message : 'Bouncie connection failed.' } }))
    } finally {
      setBouncieBusy(false)
    }
  }, [bouncieClientId, bouncieClientSecret, bouncieRedirectUri, bouncieStatus?.storedCredentials, settings.vehicleApiBaseUrl])

  useEffect(() => {
    const handleBouncieAuthorizationComplete = (event) => {
      if (event?.data?.type !== 'bouncie-oauth-complete') return
      setBouncieAuthorizationUrl('')
      if (event.data.connected === false) {
        setBouncieStatus((current) => ({
          ...current,
          import: {
            ...current.import,
            state: 'failed',
            message: event.data.message || 'Bouncie authorization did not complete.',
          },
        }))
        return
      }
      refreshBouncieStatus()
    }

    window.addEventListener('message', handleBouncieAuthorizationComplete)
    return () => window.removeEventListener('message', handleBouncieAuthorizationComplete)
  }, [refreshBouncieStatus])

  const startBouncieSync = useCallback(async () => {
    setBouncieBusy(true)
    try {
      const from = new Date(`${bouncieImportFrom}T00:00:00`)
      const through = new Date(`${bouncieImportThrough}T23:59:59.999`)
      if (Number.isNaN(from.getTime()) || Number.isNaN(through.getTime()) || from > through) throw new Error('Choose a valid Bouncie From and Through date.')
      await startBouncieImport(settings.vehicleApiBaseUrl, { from, through })
      await refreshBouncieStatus()
    } catch (err) {
      setBouncieStatus((current) => ({ ...current, import: { ...current.import, state: 'failed', message: err instanceof Error ? err.message : 'Bouncie import failed to start.' } }))
    } finally {
      setBouncieBusy(false)
    }
  }, [bouncieImportFrom, bouncieImportThrough, refreshBouncieStatus, settings.vehicleApiBaseUrl])

  const cancelBouncieSync = useCallback(async () => {
    setBouncieBusy(true)
    try { setBouncieStatus(await cancelBouncieImport(settings.vehicleApiBaseUrl)) } catch (err) {
      setBouncieStatus((current) => ({ ...current, import: { ...current.import, message: err instanceof Error ? err.message : 'Unable to cancel Bouncie import.' } }))
    } finally { setBouncieBusy(false) }
  }, [settings.vehicleApiBaseUrl])

  const forgetBouncieConnection = useCallback(async () => {
    setBouncieBusy(true)
    try {
      setBouncieStatus(await forgetBouncieCredentials(settings.vehicleApiBaseUrl))
    } catch (err) {
      setBouncieStatus((current) => ({ ...current, import: { ...current.import, message: err instanceof Error ? err.message : 'Unable to forget Bouncie credentials.' } }))
    } finally { setBouncieBusy(false) }
  }, [settings.vehicleApiBaseUrl])

  const restoreBouncieStoredConnection = useCallback(async () => {
    setBouncieBusy(true)
    try {
      setBouncieStatus(await restoreBouncieConnection(settings.vehicleApiBaseUrl))
    } catch (err) {
      setBouncieStatus((current) => ({ ...current, import: { ...current.import, state: 'failed', message: err instanceof Error ? err.message : 'Unable to restore the stored Bouncie connection.' } }))
    } finally { setBouncieBusy(false) }
  }, [settings.vehicleApiBaseUrl])

  const selectStatusPoint = useCallback((deviceId, point) => {
    const candidates = historyByDevice[deviceId] || []
    const nearest = candidates
      .filter((candidate) => Object.keys(candidate.attributes || {}).length > 0)
      .sort((a, b) => Math.abs(a.timestamp - point.timestamp) - Math.abs(b.timestamp - point.timestamp))[0]
    const mergedPoint = nearest
      ? { ...nearest, ...point, attributes: { ...(nearest.attributes || {}), ...(point.attributes || {}) } }
      : point
    setStatusDeviceId(deviceId)
    setSelectedMapPoint({ deviceId, point: mergedPoint })
  }, [historyByDevice])

  const fitMapToVisibleDevices = useCallback(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const bounds = []
    devices.forEach((device) => {
      if (deviceVisibility[device.id] === false) {
        return
      }

      const points = (historyByDevice[device.id] || []).filter((point) => {
        if (!selectedDayKey && selectedDayKeys.length === 0) return true
        const date = point.timestamp
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        return selectedDayKeys.includes(key) || key === selectedDayKey
      })
      if (points.length === 0) {
        return
      }

      points.forEach((point) => {
        bounds.push([point.latitude, point.longitude])
      })
    })

    if (bounds.length > 0) {
      programmaticMapMoveRef.current = true
      fitBoundsWithPanelOffset(map, bounds, [20, 20])
      setTimeout(() => {
        programmaticMapMoveRef.current = false
      }, 0)
    }
  }, [deviceVisibility, devices, historyByDevice])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    saveProfileDefinitions(profileDefinitions)
  }, [profileDefinitions])

  useEffect(() => {
    saveDeviceProfileAssignments(deviceProfileById)
  }, [deviceProfileById])

  useEffect(() => {
    localStorage.setItem('traccarVehicleProfileAssignments', JSON.stringify(vehicleProfileById))
  }, [vehicleProfileById])

  const profileMap = useMemo(() => buildProfileMap(profileDefinitions), [profileDefinitions])
  const profileOptions = useMemo(() => Object.values(profileDefinitions), [profileDefinitions])

  useEffect(() => {
    if (!profileOptions.length) {
      return
    }

    const hasSelected = profileOptions.some((profile) => profile.id === selectedProfileId)
    if (!hasSelected) {
      setSelectedProfileId(profileOptions[0].id)
    }
  }, [profileOptions, selectedProfileId])

  useEffect(() => {
    const selected = profileDefinitions[selectedProfileId]
    if (!selected) {
      return
    }

    setProfileName(selected.name || '')
    setProfileAttributesJson(JSON.stringify(selected.attributeMap || {}, null, 2))
    setProfileEditorStatus('')
  }, [profileDefinitions, selectedProfileId])

  useEffect(() => {
    function applyTheme() {
      let resolved = settings.theme

      if (resolved === 'auto') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }

      document.body.setAttribute('data-theme', resolved)
    }

    applyTheme()

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleThemeChange = () => {
      if (settings.theme === 'auto') {
        applyTheme()
      }
    }

    media.addEventListener('change', handleThemeChange)
    return () => media.removeEventListener('change', handleThemeChange)
  }, [settings.theme])

  useEffect(() => {
    if (!isSettingsOpen) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isSettingsOpen])

  useEffect(() => {
    if (!isSettingsOpen) return undefined
    refreshBouncieStatus()
    const state = bouncieStatus?.import?.state
    if (state !== 'running') return undefined
    const timer = window.setInterval(refreshBouncieStatus, 2000)
    return () => window.clearInterval(timer)
  }, [bouncieStatus?.import?.state, isSettingsOpen, refreshBouncieStatus])

  useEffect(() => {
    if (mapRef.current || !mapElementRef.current) {
      return
    }

    const map = L.map(mapElementRef.current).setView([39.8283, -98.5795], 4)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    markerLayerRef.current = L.layerGroup().addTo(map)
    trailLayerRef.current = L.layerGroup().addTo(map)
    selectedTripLayerRef.current = L.layerGroup().addTo(map)
    namedPlaceLayerRef.current = L.layerGroup().addTo(map)
    const namedPlacesPane = map.createPane('namedPlacesPane')
    namedPlacesPane.style.zIndex = '650'

    const mapActions = L.control({ position: 'topleft' })
    mapActions.onAdd = () => {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-action-control')
      const createButton = (className, label, icon, action) => {
        const button = L.DomUtil.create('a', className, container)
        button.href = '#'
        button.title = label
        button.setAttribute('role', 'button')
        button.setAttribute('aria-label', label)
        button.innerHTML = icon
        L.DomEvent.on(button, 'click', L.DomEvent.stop)
        L.DomEvent.on(button, 'click', action)
        return button
      }
      namedPlacesControlRef.current = createButton(
        'map-action-named-places',
        'Hide named places from the map',
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-12a6 6 0 1 0-12 0c0 6.8 6 12 6 12Z"/><circle cx="12" cy="9" r="2.2"/></svg>',
        () => setShowNamedPlaces((visible) => !visible),
      )
      resetAutoZoomControlRef.current = createButton(
        'map-action-auto-zoom leaflet-disabled',
        'Resume automatic zoom and fit the visible map data',
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/><path d="m3 8 5-5m8 0 5 5m0 8-5 5M8 21l-5-5"/></svg>',
        (event) => {
          if (event.currentTarget.getAttribute('aria-disabled') === 'true') return
          resetMapAutoFitActionRef.current?.()
        },
      )
      resetAutoZoomControlRef.current.setAttribute('aria-disabled', 'true')
      cancelLocationControlRef.current = createButton(
        'map-action-cancel-location',
        'Cancel map location selection',
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>',
        () => setIsPickingLocation(false),
      )
      cancelLocationControlRef.current.hidden = true
      L.DomEvent.disableClickPropagation(container)
      L.DomEvent.disableScrollPropagation(container)
      return container
    }
    mapActions.addTo(map)

    map.on('zoomstart', () => {
      if (!programmaticMapMoveRef.current) {
        mapAutoFitRef.current = false
        setIsAutoFitPaused(true)
      }
    })

    map.on('dragstart', () => {
      if (!programmaticMapMoveRef.current) {
        mapAutoFitRef.current = false
        setIsAutoFitPaused(true)
      }
    })

    mapRef.current = map
    setMapReady(true)

    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current)
      }
      map.remove()
      mapRef.current = null
      markerLayerRef.current = null
      trailLayerRef.current = null
      selectedTripLayerRef.current = null
      namedPlaceLayerRef.current = null
      namedPlacesControlRef.current = null
      resetAutoZoomControlRef.current = null
      cancelLocationControlRef.current = null
      setMapReady(false)
    }
  }, [vehicleAuth.checking, vehicleAuth.enabled, vehicleAuth.authenticated])

  useEffect(() => {
    const map = mapRef.current
    if (!isPickingLocation || !map) return undefined

    map.closePopup()
    map.invalidateSize()
    const selectPosition = (event) => {
      const position = event.latlng.wrap()
      setPlaceLatitude(Math.max(-90, Math.min(90, position.lat)).toFixed(6))
      setPlaceLongitude(position.lng.toFixed(6))
      setIsPickingLocation(false)
    }
    const cancelOnEscape = (event) => {
      if (event.key === 'Escape') setIsPickingLocation(false)
    }
    map.on('click', selectPosition)
    window.addEventListener('keydown', cancelOnEscape)
    return () => {
      map.off('click', selectPosition)
      window.removeEventListener('keydown', cancelOnEscape)
      requestAnimationFrame(() => {
        if (mapRef.current === map) map.invalidateSize()
        document.querySelector('.location-picker-button')?.focus({ preventScroll: true })
      })
    }
  }, [isPickingLocation])

  const startLocationPicker = () => {
    mapAutoFitRef.current = false
    setIsAutoFitPaused(true)
    setIsPickingLocation(true)
  }

  const resetMapAutoFit = useCallback(() => {
    mapAutoFitRef.current = true
    setIsAutoFitPaused(false)
    fitMapToVisibleDevices()
  }, [fitMapToVisibleDevices])

  useEffect(() => {
    resetMapAutoFitActionRef.current = resetMapAutoFit
  }, [resetMapAutoFit])

  useEffect(() => {
    const button = namedPlacesControlRef.current
    if (!button) return
    const label = showNamedPlaces ? 'Hide named places from the map' : 'Show named places on the map'
    button.title = label
    button.setAttribute('aria-label', label)
    button.classList.toggle('is-active', showNamedPlaces)
  }, [mapReady, showNamedPlaces])

  useEffect(() => {
    const button = resetAutoZoomControlRef.current
    if (!button) return
    const disabled = !isAutoFitPaused || isPickingLocation
    button.classList.toggle('leaflet-disabled', disabled)
    button.setAttribute('aria-disabled', String(disabled))
  }, [isAutoFitPaused, isPickingLocation, mapReady])

  useEffect(() => {
    const button = cancelLocationControlRef.current
    if (button) button.hidden = !isPickingLocation
  }, [isPickingLocation, mapReady])

  const speedBandsForVehicle = useCallback((vehicleId) => (
    speedBandsByVehicle[vehicleId] || getSpeedBandsForVehicle(vehicleId)
  ), [speedBandsByVehicle])
  const selectedTripVehicleId = selectedTrip?.vehicleId
    || activeBindings.find((binding) => Number(binding.traccarDeviceId) === Number(selectedTrip?.deviceId))?.vehicleId

  useEffect(() => {
    const map = mapRef.current
    const markerLayer = markerLayerRef.current
    const trailLayer = trailLayerRef.current
    const selectedTripLayer = selectedTripLayerRef.current

    if (!map || !markerLayer || !trailLayer) {
      return
    }

    markerLayer.clearLayers()
    trailLayer.clearLayers()
    selectedTripLayer?.clearLayers()

    const bounds = []
    let selectedTripBounds = []

    devices.forEach((device) => {
      if (deviceVisibility[device.id] === false) {
        return
      }

      const color = selectedDayKey || selectedDayKeys.length > 0 ? '#22c55e' : (deviceColors[device.id] || '#f97316')
      const sourcePoints = [...(historyByDevice[device.id] || []), ...historyRoutePoints.filter((point) => Number(point.deviceId) === Number(device.id))]
        .sort((a, b) => a.timestamp - b.timestamp)
      const points = sourcePoints.filter((point) => {
        if (!selectedDayKey && selectedDayKeys.length === 0) {
          return point.timestamp.getTime() >= Date.now() - 48 * 60 * 60 * 1000
        }
        const date = point.timestamp
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        return selectedDayKeys.includes(key) || key === selectedDayKey
      })
      if (points.length === 0) {
        return
      }

      const coords = points.map((point) => [point.latitude, point.longitude])

      if (coords.length > 1) {
        L.polyline(coords, {
          color,
          weight: 3,
          opacity: 0.9,
        }).addTo(trailLayer)
      }

      const last = points[points.length - 1]
      const marker = L.circleMarker([last.latitude, last.longitude], {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.9,
        weight: 2,
      })

      marker.bindPopup(`<strong>${device.name}</strong><br/>${last.timestamp.toLocaleString()}`)
      marker.on('click', () => selectStatusPoint(device.id, last))
      marker.addTo(markerLayer)
      points.forEach((point) => {
        const pointMarker = L.circleMarker([point.latitude, point.longitude], { radius: 7, stroke: false, fillOpacity: 0 })
        pointMarker.on('click', () => selectStatusPoint(device.id, point))
        pointMarker.addTo(markerLayer)
      })
      if (selectedDayKey || selectedDayKeys.length > 0) {
        points.forEach((point) => bounds.push([point.latitude, point.longitude]))
      } else {
        bounds.push([last.latitude, last.longitude])
      }
    })

    if (selectedTrip && selectedTripLayer) {
      const loadedTripPoints = (historyByDevice[selectedTrip.deviceId] || []).filter((point) => point.timestamp >= selectedTrip.start && point.timestamp <= selectedTrip.end)
      const tripPoints = selectedTripRoutePoints.length > 0
        ? selectedTripRoutePoints
        : loadedTripPoints.length > 0
        ? loadedTripPoints
        : (selectedTrip.points || []).map(([latitude, longitude, metadata = {}]) => ({ latitude, longitude, ...metadata, timestamp: metadata.timestamp instanceof Date ? metadata.timestamp : new Date(metadata.timestamp || selectedTrip.start) }))
      selectedTripBounds = tripPoints.map((point) => [point.latitude, point.longitude])
      if (tripPoints.length > 1) {
        for (let index = 1; index < tripPoints.length; index += 1) {
          const previous = tripPoints[index - 1]
          const current = tripPoints[index]
          const band = speedBandFor(Number.isFinite(Number(current.speedMph)) ? current.speedMph : Number(current.speed || 0) * 1.15078, speedBandsForVehicle(selectedTripVehicleId))
          L.polyline([[previous.latitude, previous.longitude], [current.latitude, current.longitude]], { color: band.color, weight: 5, opacity: 1 }).addTo(selectedTripLayer)
        }
      }
      tripPoints.forEach((point) => {
        const pointSpeedMph = Number.isFinite(Number(point.speedMph)) ? Number(point.speedMph) : Number(point.speed || 0) * 1.15078
        const pointBand = speedBandFor(pointSpeedMph, speedBandsForVehicle(selectedTripVehicleId))
        const marker = L.circleMarker([point.latitude, point.longitude], { radius: 4, color: pointBand.color, fillColor: pointBand.color, fillOpacity: 1, weight: 1 })
        const speedMph = Number(point.speed || 0) * 1.15078
        const telemetry = Object.entries(point.attributes || {})
          .filter(([key]) => /obd|fuel|rpm|engine|coolant|accel|g.?force/i.test(key))
          .slice(0, 8)
          .map(([key, value]) => `<br/>${key}: ${String(value)}`)
          .join('')
        const popup = `<strong>${point.timestamp.toLocaleString()}</strong><br/>Location: ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}<br/>Speed: ${speedMph.toFixed(1)} mph${telemetry}`
        marker.bindPopup(popup)
        marker.on('click', () => selectStatusPoint(selectedTrip.deviceId, point))
        marker.addTo(selectedTripLayer)
        // Keep the visible dot compact, but make the point easy to select on
        // dense five-second trails. The transparent circle receives pointer
        // events without changing the rendered route or marker size.
        const hitTarget = L.circleMarker([point.latitude, point.longitude], { radius: 12, stroke: false, fillOpacity: 0, interactive: true })
        hitTarget.bindPopup(popup)
        hitTarget.on('click', () => selectStatusPoint(selectedTrip.deviceId, point))
        hitTarget.addTo(selectedTripLayer)
      })

      eventMarkerRefs.current = {}
      selectedTripEvents.forEach((event) => {
        const latitude = Number(event.latitude)
        const longitude = Number(event.longitude)
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
        const symbols = { maximum_speed: '⚡', hard_braking: '!', hard_acceleration: '↑', long_idle: '⏱' }
        const colors = { maximum_speed: '#f59e0b', hard_braking: '#dc2626', hard_acceleration: '#16a34a', long_idle: '#2563eb' }
        const eventType = String(event.eventType || 'event')
        const icon = L.divIcon({ className: 'trip-event-icon', html: `<span style="background:${colors[eventType] || '#475569'}">${symbols[eventType] || '•'}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] })
        const marker = L.marker([latitude, longitude], { icon })
        marker.bindPopup(`<strong>${eventType.replaceAll('_', ' ')}</strong><br/>Source: ${event.source || 'unknown'}<br/>${new Date(event.occurredAt).toLocaleString()}${event.measuredValue == null ? '' : `<br/>Value: ${formatEventMeasurement(event)}`}`)
        marker.on('click', () => selectStatusPoint(selectedTrip.deviceId, {
          timestamp: new Date(event.occurredAt),
          latitude,
          longitude,
          attributes: {},
        }))
        marker.addTo(selectedTripLayer)
        if (event.id) eventMarkerRefs.current[event.id] = marker
      })
    }

    const fitBounds = selectedTripBounds.length > 0 ? selectedTripBounds : bounds
    if (fitBounds.length > 0 && mapAutoFitRef.current) {
      programmaticMapMoveRef.current = true
      fitBoundsWithPanelOffset(map, fitBounds, [20, 20])
      setTimeout(() => {
        programmaticMapMoveRef.current = false
      }, 0)
    }
  }, [activeBindings, deviceColors, deviceVisibility, devices, historyByDevice, historyRoutePoints, selectStatusPoint, selectedDayKey, selectedDayKeys, selectedTrip, selectedTripEvents, selectedTripRoutePoints, selectedTripVehicleId, speedBandsForVehicle])

  const focusTripEvent = useCallback((event) => {
    const latitude = Number(event?.latitude)
    const longitude = Number(event?.longitude)
    if (!mapRef.current || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    if (selectedTrip?.deviceId != null) {
      selectStatusPoint(selectedTrip.deviceId, {
        timestamp: new Date(event.occurredAt),
        latitude,
        longitude,
        attributes: {},
      })
    }
    mapRef.current.setView([latitude, longitude], Math.max(mapRef.current.getZoom(), 15))
    if (event.id && eventMarkerRefs.current[event.id]) eventMarkerRefs.current[event.id].openPopup()
  }, [selectStatusPoint, selectedTrip])

  useEffect(() => {
    const selectedDays = selectedDayKeys.length > 0 ? selectedDayKeys : (selectedDayKey ? [selectedDayKey] : [])
    if (selectedDays.length === 0 || selectedTrip || !mapRef.current) return
    const ranges = selectedDays.map((dayKey) => [new Date(`${dayKey}T00:00:00`).getTime(), new Date(`${dayKey}T23:59:59.999`).getTime()])
    const bounds = []
    Object.values(historyByDevice).forEach((points) => {
      points.forEach((point) => {
        const timestamp = point.timestamp.getTime()
        if (ranges.some(([dayStart, dayEnd]) => timestamp >= dayStart && timestamp <= dayEnd)) bounds.push([point.latitude, point.longitude])
      })
    })
    if (bounds.length > 0) {
      programmaticMapMoveRef.current = true
      fitBoundsWithPanelOffset(mapRef.current, bounds, [30, 30])
      setTimeout(() => { programmaticMapMoveRef.current = false }, 0)
    }
  }, [historyByDevice, selectedDayKey, selectedDayKeys, selectedTrip])

  useEffect(() => {
    const selectedDays = selectedDayKeys.length > 0 ? selectedDayKeys : (selectedDayKey ? [selectedDayKey] : [])
    if (selectedDays.length === 0 || historyDayRows.length === 0) {
      setHistoryRoutePoints([])
      return undefined
    }
    let cancelled = false
    const rows = historyDayRows.filter((row) => {
      const date = new Date(row.startedAt)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      return selectedDays.includes(key)
    })
    Promise.all(rows.map(async (row) => {
      const route = await fetchTripRoutePoints(settings.vehicleApiBaseUrl, row.id).catch(() => [])
      return route.map((point) => ({
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
        timestamp: point.occurredAt ? new Date(point.occurredAt) : new Date(row.startedAt),
        deviceId: Number(row.traccarDeviceId),
        speedMph: Number.isFinite(Number(point.speedMph)) ? Number(point.speedMph) : null,
        speed: Number.isFinite(Number(point.speedMph)) ? Number(point.speedMph) / 1.15078 : 0,
        attributes: {},
      }))
    })).then((routes) => {
      if (!cancelled) setHistoryRoutePoints(routes.flat())
    })
    return () => { cancelled = true }
  }, [historyDayRows, selectedDayKey, selectedDayKeys, settings.vehicleApiBaseUrl])

  useEffect(() => {
    const placeLayer = namedPlaceLayerRef.current
    if (!placeLayer) {
      return
    }

    placeLayer.clearLayers()
    if (!showNamedPlaces) return

    const activeDeviceByVehicle = new Map(
      activeBindings.map((binding) => [binding.vehicleId, binding.traccarDeviceId]),
    )

    namedPlaces.forEach((place) => {
      const mappedDeviceId = place.vehicleId ? activeDeviceByVehicle.get(place.vehicleId) : null
      if (mappedDeviceId && deviceVisibility[mappedDeviceId] === false) {
        return
      }

      const center = [place.latitude, place.longitude]
      const radiusMeters = Math.max(1, Number(place.radiusMeters) || 1)
      const vehicleName = place.vehicleId
        ? (bindingVehicles.find((vehicle) => vehicle.id === place.vehicleId)?.displayName || 'Vehicle scoped')
        : 'All vehicles'

      const circle = L.circle(center, {
        radius: radiusMeters,
        color: '#16a34a',
        weight: 2,
        fillColor: '#22c55e',
        fillOpacity: 0.15,
        pane: 'namedPlacesPane',
      })

      const notesBlock = place.notes ? `<br/>${place.notes}` : ''
      circle.bindPopup(
        `<strong>${place.name}</strong><br/>${vehicleName}<br/>Radius: ${Math.round(radiusMeters * YARDS_PER_METER)} yd${notesBlock}`,
      )
      circle.addTo(placeLayer)
    })
  }, [activeBindings, bindingVehicles, deviceVisibility, mapReady, namedPlaces, showNamedPlaces])

  useEffect(() => {
    sessionAttemptedRef.current = false
    setSessionState('unknown')
  }, [settings.apiBaseUrl, settings.password, settings.username])

  const apiFetch = useMemo(() => createTraccarApi({
    settings,
    onSessionStateChange: setSessionState,
    sessionAttemptedRef,
  }), [settings])

  useEffect(() => {
    let active = true
    fetchVehicleAuthStatus(settings.vehicleApiBaseUrl)
      .then((result) => { if (active) setVehicleAuth({ checking: false, enabled: Boolean(result.enabled), authenticated: Boolean(result.authenticated), username: result.username || null, role: result.role || null }) })
      .catch(() => { if (active) setVehicleAuth({ checking: false, enabled: false, authenticated: false, username: null, role: null }) })
    return () => { active = false }
  }, [settings.vehicleApiBaseUrl])

  const tripFlyoutPreferenceKey = useMemo(() => {
    if (vehicleAuth.checking) return null
    const userKey = vehicleAuth.authenticated && vehicleAuth.username
      ? vehicleAuth.username.trim().toLowerCase()
      : 'local'
    return `vehicleApp:tripFlyoutPosition:${userKey}`
  }, [vehicleAuth.authenticated, vehicleAuth.checking, vehicleAuth.username])

  useEffect(() => {
    if (!tripFlyoutPreferenceKey) return
    let active = true
    const applyPosition = (saved) => {
      if (!active) return
      const left = Number(saved?.left)
      const top = Number(saved?.top)
      setTripFlyoutPosition(Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null)
    }
    try {
      const saved = JSON.parse(localStorage.getItem(tripFlyoutPreferenceKey) || 'null')
      applyPosition(saved)
    } catch {
      applyPosition(null)
    }

    if (vehicleAuth.authenticated) {
      fetchUserPreference(settings.vehicleApiBaseUrl, 'trips-panel-position')
        .then((saved) => { if (saved) applyPosition(saved) })
        .catch(() => {})
    }
    return () => { active = false }
  }, [settings.vehicleApiBaseUrl, tripFlyoutPreferenceKey, vehicleAuth.authenticated])

  const persistTripFlyoutPosition = useCallback((position) => {
    setTripFlyoutPosition(position)
    if (tripFlyoutPreferenceKey) {
      localStorage.setItem(tripFlyoutPreferenceKey, JSON.stringify(position))
    }
    if (vehicleAuth.authenticated) {
      saveUserPreference(settings.vehicleApiBaseUrl, 'trips-panel-position', position).catch(() => {})
    }
  }, [settings.vehicleApiBaseUrl, tripFlyoutPreferenceKey, vehicleAuth.authenticated])

  const vehicleStatusPreferenceKey = useMemo(() => {
    if (vehicleAuth.checking) return null
    const userKey = vehicleAuth.authenticated && vehicleAuth.username
      ? vehicleAuth.username.trim().toLowerCase()
      : 'local'
    return `vehicleApp:vehicleStatusPosition:${userKey}`
  }, [vehicleAuth.authenticated, vehicleAuth.checking, vehicleAuth.username])

  useEffect(() => {
    if (!vehicleStatusPreferenceKey) return
    let active = true
    const applyPosition = (saved) => {
      if (!active) return
      const left = Number(saved?.left)
      const top = Number(saved?.top)
      setVehicleStatusPosition(Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null)
    }
    try {
      applyPosition(JSON.parse(localStorage.getItem(vehicleStatusPreferenceKey) || 'null'))
    } catch {
      applyPosition(null)
    }
    if (vehicleAuth.authenticated) {
      fetchUserPreference(settings.vehicleApiBaseUrl, 'vehicle-status-position')
        .then((saved) => { if (saved) applyPosition(saved) })
        .catch(() => {})
    }
    return () => { active = false }
  }, [settings.vehicleApiBaseUrl, vehicleAuth.authenticated, vehicleStatusPreferenceKey])

  const persistVehicleStatusPosition = useCallback((position) => {
    setVehicleStatusPosition(position)
    if (vehicleStatusPreferenceKey) {
      localStorage.setItem(vehicleStatusPreferenceKey, JSON.stringify(position))
    }
    if (vehicleAuth.authenticated) {
      saveUserPreference(settings.vehicleApiBaseUrl, 'vehicle-status-position', position).catch(() => {})
    }
  }, [settings.vehicleApiBaseUrl, vehicleAuth.authenticated, vehicleStatusPreferenceKey])

  const submitVehicleLogin = useCallback(async (event) => {
    event.preventDefault()
    setVehicleLoginError('')
    try {
      await loginVehicleApi(settings.vehicleApiBaseUrl, vehicleLoginUsername, vehicleLoginPassword)
      setVehicleLoginPassword('')
      // Start the normal data-loading effects with the new session cookie.
      window.location.reload()
    } catch (err) {
      setVehicleLoginError(err instanceof Error ? err.message : 'Login failed')
    }
  }, [settings.vehicleApiBaseUrl, vehicleLoginPassword, vehicleLoginUsername])

  const logoutVehicleSession = useCallback(async () => {
    try {
      await logoutVehicleApi(settings.vehicleApiBaseUrl)
    } finally {
      window.location.reload()
    }
  }, [settings.vehicleApiBaseUrl])

  const trips = useMemo(() => {
    const allTrips = []

    Object.entries(historyByDevice).forEach(([rawDeviceId, points]) => {
      const deviceId = Number(rawDeviceId)
      if (deviceVisibility[deviceId] === false) {
        return
      }

      const deviceTrips = buildTripsForDevice(deviceId, points, settings.movementThresholdM)
      allTrips.push(...deviceTrips.map((trip) => {
        const saved = historyDayRows.find((row) => rowMatchesTripIdentity(row, trip))
        return {
          ...trip,
          savedTripId: saved?.id || trip.savedTripId,
          vehicleId: trip.vehicleId || saved?.vehicleId,
          vehicleName: bindingVehicles.find((vehicle) => vehicle.id === (trip.vehicleId || saved?.vehicleId))?.displayName,
          maxSpeedMph: Number.isFinite(Number(saved?.maxSpeedMph)) ? Number(saved.maxSpeedMph) : getTripMaxSpeedMph(trip),
          eventCount: Number(saved?.eventCount) || 0,
        }
      }))
    })

    historyDayRows.forEach((row) => {
      const deviceId = Number(row.traccarDeviceId)
      if (!Number.isFinite(deviceId) || deviceVisibility[deviceId] === false) return
      const start = new Date(row.startedAt)
      const end = new Date(row.endedAt)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return
      const duplicate = allTrips.some((trip) => rowMatchesTripIdentity(row, trip))
      if (duplicate) return
      const hasStart = Number.isFinite(Number(row.startLatitude)) && Number.isFinite(Number(row.startLongitude))
      const hasEnd = Number.isFinite(Number(row.endLatitude)) && Number.isFinite(Number(row.endLongitude))
      const points = []
      if (hasStart) points.push([Number(row.startLatitude), Number(row.startLongitude), { timestamp: start, speedMph: 0, attributes: {}, address: row.startAddress }])
      if (hasEnd) points.push([Number(row.endLatitude), Number(row.endLongitude), { timestamp: end, speedMph: 0, attributes: {}, address: row.endAddress }])
      allTrips.push({
        tripId: `saved-${row.id}`,
        savedTripId: row.id,
        vehicleId: row.vehicleId,
        vehicleName: bindingVehicles.find((vehicle) => vehicle.id === row.vehicleId)?.displayName,
        deviceId,
        start,
        end,
        distance: Number(row.distanceMeters) || 0,
        points,
        dayKey: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
        maxSpeedMph: Number.isFinite(Number(row.maxSpeedMph)) ? Number(row.maxSpeedMph) : null,
        eventCount: Number(row.eventCount) || 0,
      })
    })

    allTrips.sort((a, b) => b.start - a.start)
    return allTrips
  }, [bindingVehicles, deviceVisibility, historyByDevice, historyDayRows, settings.movementThresholdM])

  const daySummaries = useMemo(() => {
    const localSummaries = summarizeSavedTrips(trips.map((trip) => {
        const saved = historyDayRows.find((row) => rowMatchesTripIdentity(row, trip))
        return {
          startedAt: trip.start,
          distanceMeters: saved?.distanceMeters ?? trip.distance,
          durationSeconds: saved?.durationSeconds ?? (trip.end - trip.start) / 1000,
          maxSpeedMph: saved?.maxSpeedMph ?? trip.maxSpeedMph,
          eventCount: saved?.eventCount ?? trip.eventCount,
        }
      }))
    const selectedDeviceIds = new Set(devices.filter((device) => deviceVisibility[device.id] !== false).map((device) => device.id))
    const matchingRows = historyDayRows.filter((row) => selectedDeviceIds.has(Number(row.traccarDeviceId)))
    const summaries = historyDayRows.length > 0
      ? summarizeSavedTrips(matchingRows)
      : (historyDaySummaries.length > 0 ? historyDaySummaries : localSummaries)
    localSummaries.forEach((local) => {
      const current = summaries.find((summary) => summary.dayKey === local.dayKey)
      if (!current) return
      if (current.maxSpeedMph == null || local.maxSpeedMph > current.maxSpeedMph) current.maxSpeedMph = local.maxSpeedMph
      if (!current.eventCount && local.eventCount) current.eventCount = local.eventCount
    })
    if (selectedDeviceIds.size === 0) return []
    const now = new Date()
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const includesToday = historyWindow.from <= now && historyWindow.to >= todayStart
    if (!includesToday || summaries.some((day) => day.dayKey === todayKey)) return summaries
    return [{ dayKey: todayKey, tripCount: 0, distanceM: 0 }, ...summaries]
  }, [devices, deviceVisibility, historyDayRows, historyDaySummaries, historyWindow, trips])

  const historyMonthKeys = useMemo(() => {
    if (historySpan.earliestStartedAt && historySpan.latestEndedAt) {
      return buildMonthRangeKeys(historySpan.earliestStartedAt, historySpan.latestEndedAt)
    }
    if (daySummaries.length === 0) return []
    const earliestDay = daySummaries[daySummaries.length - 1]?.dayKey
    const latestDay = daySummaries[0]?.dayKey
    if (!earliestDay || !latestDay) return []
    return buildMonthRangeKeys(`${earliestDay}T00:00:00`, `${latestDay}T23:59:59`)
  }, [daySummaries, historySpan.earliestStartedAt, historySpan.latestEndedAt])

  const visibleTrips = useMemo(() => {
    if (!selectedDayKey && selectedDayKeys.length === 0) return trips
    return trips.filter((trip) => selectedDayKeys.includes(trip.dayKey) || trip.dayKey === selectedDayKey)
  }, [selectedDayKey, selectedDayKeys, trips])

  const openTripGraph = useCallback((trip) => {
    if (!trip) return
    const points = trip === selectedTrip && selectedTripRoutePoints.length > 0
      ? selectedTripRoutePoints
      : (trip.points || [])
    setGraphGroups([{ id: trip.tripId, label: `Trip ${trip.start.toLocaleString()}`, points }])
  }, [selectedTrip, selectedTripRoutePoints])

  const openSelectedDaysGraph = useCallback(() => {
    const days = selectedDayKeys.length > 0 ? selectedDayKeys : (selectedDayKey ? [selectedDayKey] : [])
    const groups = visibleTrips
      .filter((trip) => days.length === 0 || days.includes(trip.dayKey))
      .sort((a, b) => a.start - b.start)
      .map((trip) => ({ id: trip.tripId, label: `${trip.start.toLocaleTimeString()} – ${trip.end.toLocaleTimeString()}`, points: trip.points || [] }))
      .filter((group) => group.points.length > 0)
    setGraphGroups(groups)
  }, [selectedDayKey, selectedDayKeys, visibleTrips])

  const recalculateTripSet = useCallback(async (candidateTrips, { force = false } = {}) => {
    // v4 adds plausibility filtering for calculated acceleration and braking.
    // Imports continue to use the older metric-only version so the first day
    // view recalculates them automatically.
    const derivationVersion = `trip-v4-plausible-events-movement-${settings.movementThresholdM}`
    const hasSavedRowForTrip = (trip) => historyDayRows.some((row) => rowMatchesTripIdentity(row, trip))
    const results = await Promise.allSettled(candidateTrips.map(async (trip) => {
      // Do not persist a completed derivation until the selected trip's points
      // have arrived. A range summary can briefly contain trips without points.
      if (!Array.isArray(trip.points) || trip.points.length === 0) return { skipped: true }
      // Days can include Traccar-only trips that were intentionally not
      // imported (for example unmanaged phone trackers). Skip identity
      // resolution unless backend history already has a matching saved trip.
      const hasTripPositionIdentity = Number.isFinite(Number(trip.startTraccarPositionId))
        && Number(trip.startTraccarPositionId) > 0
        && Number.isFinite(Number(trip.endTraccarPositionId))
        && Number(trip.endTraccarPositionId) > 0
      if (!hasTripPositionIdentity) return { skipped: true }
      if (!hasSavedRowForTrip(trip)) return { skipped: true }
      let saved
      try {
        saved = await resolveTrip(settings.vehicleApiBaseUrl, trip)
      } catch (error) {
        if (error?.status === 404) return { skipped: true }
        throw error
      }
      const calculatedMaxSpeedMph = getTripMaxSpeedMph(trip)
      const needsSpeedRepair = calculatedMaxSpeedMph != null
        && (saved.maxSpeedMph == null || saved.maxSpeedMph < calculatedMaxSpeedMph)
      if (!force && saved.derivationVersion === derivationVersion && !needsSpeedRepair) return { skipped: true }
      let distanceMeters = 0
      const points = Array.isArray(trip.points) ? trip.points : []
      for (let index = 1; index < points.length; index += 1) {
        distanceMeters += metersBetween(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1])
      }
      await recalculateTrip(settings.vehicleApiBaseUrl, saved.id, {
        durationSeconds: Math.max(1, Math.round((trip.end - trip.start) / 1000)),
        distanceMeters,
        maxSpeedMph: calculatedMaxSpeedMph,
        derivationVersion,
      })
      await deleteCalculatedTripEvents(settings.vehicleApiBaseUrl, saved.id)
      const events = detectTripEvents(trip, resolveEventThresholds())
      if (events.length > 0) await saveTripEvents(settings.vehicleApiBaseUrl, saved.id, events)
      return { recalculated: true }
    }))
    return {
      recalculated: results.filter((result) => result.status === 'fulfilled' && result.value.recalculated).length,
      skipped: results.filter((result) => result.status === 'fulfilled' && result.value.skipped).length,
      failed: results.filter((result) => result.status === 'rejected').length,
    }
  }, [historyDayRows, settings.movementThresholdM, settings.vehicleApiBaseUrl])

  const refreshHistoryMetadata = useCallback(async () => {
    if (historyDayRows.length === 0) return
    try {
      const rows = await fetchTripDaySummaries(settings.vehicleApiBaseUrl, {
        from: historyWindow.from,
        to: historyWindow.to,
      })
      historyDayRowsRef.current = rows
      setHistoryDayRows(rows)
      setHistoryDaySummaries(summarizeSavedTrips(rows))
    } catch {
      // The loaded trips remain usable if a metadata refresh is transiently unavailable.
    }
  }, [historyDayRows.length, historyWindow.from, historyWindow.to, settings.vehicleApiBaseUrl])

  useEffect(() => {
    const readyTrips = visibleTrips.filter((trip) => Array.isArray(trip.points) && trip.points.length > 0)
    if (!selectedDayKey || readyTrips.length === 0) return
    const key = `${selectedDayKey}:${settings.movementThresholdM}`
    if (autoCalculatedDaysRef.current.has(key)) return
    autoCalculatedDaysRef.current.add(key)
    recalculateTripSet(readyTrips).then(async (result) => {
      if (result.recalculated > 0) {
        await refreshHistoryMetadata()
        setNotificationsRefreshNonce((value) => value + 1)
      }
      // A transient API failure should be retryable if the user selects the
      // same day again, while successful or skipped trips remain completed.
      if (result.failed > 0) autoCalculatedDaysRef.current.delete(key)
    }).catch(() => autoCalculatedDaysRef.current.delete(key))
  }, [recalculateTripSet, refreshHistoryMetadata, selectedDayKey, settings.movementThresholdM, visibleTrips])

  const loadDevices = useCallback(async () => {
    let normalized = []

    if (settings.useBackendVehicleCatalog) {
      try {
        const backendVehicles = await fetchVehicleCatalog(settings.vehicleApiBaseUrl)

        normalized = backendVehicles
          .filter((vehicle) => Number.isFinite(vehicle.traccarDeviceId))
          .map((vehicle) => ({
            id: Number(vehicle.traccarDeviceId),
            name: vehicle.displayName || `Vehicle ${vehicle.id}`,
            appVehicleId: vehicle.id,
          }))

        if (normalized.length === 0) {
          throw new Error('Backend vehicle catalog has no active Traccar device bindings.')
        }
      } catch (backendErr) {
        const message = backendErr instanceof Error ? backendErr.message : 'Unknown backend vehicle API error'
        setStatus(`Backend vehicle catalog unavailable (${message}). Falling back to Traccar /devices.`)
      }
    }

    if (normalized.length === 0) {
      const payload = await apiFetch('/devices')
      normalized = Array.isArray(payload) ? payload : []
    }

    setDevices(normalized)
    setDeviceColors((prev) => {
      const next = { ...prev }
      normalized.forEach((device, index) => {
        if (!next[device.id]) {
          next[device.id] = PALETTE[index % PALETTE.length]
        }
      })
      return next
    })

    setDeviceVisibility((prev) => {
      const next = { ...prev }
      normalized.forEach((device) => {
        if (next[device.id] === undefined) {
          next[device.id] = true
        }
      })
      return next
    })

    setDeviceProfileById((prev) => {
      const next = { ...prev }
      normalized.forEach((device) => {
        if (next[device.id] && !profileDefinitions[next[device.id]]) {
          next[device.id] = ''
        }
      })
      return next
    })

    setExportDeviceId((prev) => {
      if (prev && normalized.some((device) => device.id === prev)) {
        return prev
      }

      return normalized.length > 0 ? normalized[0].id : null
    })

    return normalized
  }, [apiFetch, profileDefinitions, settings.useBackendVehicleCatalog, settings.vehicleApiBaseUrl])

  useEffect(() => {
    if (deviceListSelectedId != null && devices.some((device) => device.id === deviceListSelectedId)) {
      return
    }
    setDeviceListSelectedId(devices[0]?.id ?? null)
  }, [deviceListSelectedId, devices])

  const refreshBindingData = useCallback(async () => {
    setIsBindingBusy(true)
    setBindingStatus('Loading vehicles and active bindings...')

    let vehicles = []
    let bindings = []

    try {
      [vehicles, bindings] = await Promise.all([
        fetchVehicleCatalog(settings.vehicleApiBaseUrl),
        fetchActiveDeviceBindings(settings.vehicleApiBaseUrl),
      ])

      setBindingVehicles(vehicles)
      setVehicleProfileById((prev) => {
        const next = { ...prev }
        vehicles.forEach((vehicle) => {
          if (vehicle.profileId !== undefined) next[vehicle.id] = vehicle.profileId || ''
        })
        return next
      })
      setActiveBindings(bindings)

      setBindingVehicleId((prev) => {
        if (prev && vehicles.some((vehicle) => vehicle.id === prev)) {
          return prev
        }
        return vehicles.length > 0 ? vehicles[0].id : null
      })

      setBindingDeviceId((prev) => {
        const hinted = toPositiveInt32(importBindingHintDeviceId)
        if (hinted && devices.some((device) => device.id === hinted)) {
          return hinted
        }

        if (prev && devices.some((device) => device.id === prev)) {
          return prev
        }
        return devices.length > 0 ? devices[0].id : null
      })

      const hinted = toPositiveInt32(importBindingHintDeviceId)
      if (hinted) {
        const suggestedVehicleId = suggestVehicleIdForDevice(hinted, devices, vehicles)
        if (suggestedVehicleId) {
          setBindingVehicleId(suggestedVehicleId)
          setBindingStatus(`Import is blocked: device id ${hinted} is not bound. A suggested vehicle was selected; click Save Binding and Retry Import.`)
        } else {
          setBindingStatus(`Import is blocked: device id ${hinted} is not bound. Select a vehicle, then click Save Binding and Retry Import.`)
        }
      } else {
        setBindingStatus(`Loaded ${bindings.length} active binding(s).`)
      }
    } catch (err) {
      setBindingStatus(err instanceof Error ? err.message : 'Failed to load binding data.')
      setBindingVehicles([])
      setActiveBindings([])
    }

    try {
      const [places, tags] = await Promise.all([
        fetchNamedPlaces(settings.vehicleApiBaseUrl),
        fetchTripTags(settings.vehicleApiBaseUrl),
      ])

      setNamedPlaces(places)
      setTripTags(tags)
      setEnrichmentStatus(`Loaded ${places.length} named place(s) and ${tags.length} trip tag(s).`)
    } catch (err) {
      setNamedPlaces([])
      setTripTags([])
      setEnrichmentStatus(err instanceof Error ? err.message : 'Failed to load enrichment data.')
    } finally {
      setIsBindingBusy(false)
    }
  }, [devices, importBindingHintDeviceId, settings.vehicleApiBaseUrl])

  useEffect(() => {
    const canSuggest = importRecovery?.code === 'trip_import_binding_missing'
      && importRecovery.traccarDeviceId
      && importRecovery.startedAt
      && importRecovery.endedAt
    if (!canSuggest) {
      setBindingRepairSuggestion(null)
      setBindingRepairStatus('')
      return undefined
    }

    let active = true
    setBindingRepairSuggestion(null)
    setBindingRepairStatus('Finding the nearest assignment for this device...')
    fetchNearestDeviceBinding(settings.vehicleApiBaseUrl, {
      traccarDeviceId: importRecovery.traccarDeviceId,
      startedAt: importRecovery.startedAt,
      endedAt: importRecovery.endedAt,
    }).then((suggestion) => {
      if (!active) return
      setBindingRepairSuggestion(suggestion)
      setBindingRepairStatus(suggestion ? '' : 'No nearby assignment exists for this device.')
    }).catch((error) => {
      if (active) setBindingRepairStatus(error instanceof Error ? error.message : 'Unable to find a nearby assignment.')
    })
    return () => { active = false }
  }, [importRecovery?.code, importRecovery?.endedAt, importRecovery?.startedAt, importRecovery?.traccarDeviceId, settings.vehicleApiBaseUrl])

  useEffect(() => {
    let active = true
    if (!settings.vehicleApiBaseUrl || bindingVehicles.length === 0) {
      setSpeedBandsByVehicle({})
      setStatusCardFieldsByVehicle({})
      return () => { active = false }
    }
    Promise.all(bindingVehicles.map(async (vehicle) => {
      try {
        const [speedPayload, cardPayload] = await Promise.all([
          fetchVehicleSpeedBands(settings.vehicleApiBaseUrl, vehicle.id).catch(() => null),
          fetchStatusCardFields(settings.vehicleApiBaseUrl, vehicle.id).catch(() => null),
        ])
        return {
          speed: speedPayload?.bands ? [vehicle.id, speedPayload.bands] : null,
          card: cardPayload?.fields ? [vehicle.id, cardPayload.fields] : null,
        }
      } catch {
        return null
      }
    })).then((entries) => {
      if (!active) return
      setSpeedBandsByVehicle(Object.fromEntries(entries.filter(Boolean).map((entry) => entry.speed).filter(Boolean)))
      setStatusCardFieldsByVehicle(Object.fromEntries(entries.filter(Boolean).map((entry) => entry.card).filter(Boolean)))
    })
    return () => { active = false }
  }, [bindingVehicles, settings.vehicleApiBaseUrl])

  useEffect(() => {
    const handleSpeedBandsUpdated = (event) => {
      const vehicleId = event.detail?.vehicleId
      const bands = event.detail?.bands
      if (!vehicleId || !Array.isArray(bands)) return
      setSpeedBandsByVehicle((current) => ({ ...current, [vehicleId]: bands }))
    }
    window.addEventListener('vehicle-speed-bands-updated', handleSpeedBandsUpdated)
    return () => window.removeEventListener('vehicle-speed-bands-updated', handleSpeedBandsUpdated)
  }, [])

  const saveStatusCardFields = useCallback(async (vehicleId, fields) => {
    await persistStatusCardFields(settings.vehicleApiBaseUrl, vehicleId, fields)
    setStatusCardFieldsByVehicle((current) => ({ ...current, [vehicleId]: fields }))
  }, [settings.vehicleApiBaseUrl])

  const saveNamedPlace = useCallback(async () => {
    const latitude = Number(placeLatitude)
    const longitude = Number(placeLongitude)
    const radiusYards = Number(placeRadiusYards)

    if (!placeName.trim()) {
      setEnrichmentStatus('Named place requires a name.')
      return
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setEnrichmentStatus('Named place requires valid latitude and longitude values.')
      return
    }

    if (!Number.isFinite(radiusYards) || radiusYards <= 0) {
      setEnrichmentStatus('Named place radius must be a positive number.')
      return
    }

    try {
      const radiusMeters = Math.max(1, Math.round(radiusYards * METERS_PER_YARD))

      await upsertNamedPlace(settings.vehicleApiBaseUrl, {
        id: placeEditId,
        vehicleId: placeVehicleId || null,
        name: placeName.trim(),
        latitude,
        longitude,
        radiusMeters,
        notes: placeNotes.trim() || null,
      })

      const places = await fetchNamedPlaces(settings.vehicleApiBaseUrl)
      setNamedPlaces(places)
      const roundingNote = radiusYards * METERS_PER_YARD < 1 ? ' Radius values below 1 yard are saved as 1 meter.' : ''
      const actionLabel = placeEditId ? 'Updated' : 'Saved'
      setEnrichmentStatus(`${actionLabel} named place ${placeName.trim()}. Named places total: ${places.length}.${roundingNote}`)
      setPlaceEditId(null)
      setPlaceVehicleId(null)
      setPlaceName('')
      setPlaceLatitude('')
      setPlaceLongitude('')
      setPlaceRadiusYards('75')
      setPlaceNotes('')
    } catch (err) {
      setEnrichmentStatus(err instanceof Error ? err.message : 'Failed to save named place.')
    }
  }, [placeEditId, placeLatitude, placeLongitude, placeName, placeNotes, placeRadiusYards, placeVehicleId, settings.vehicleApiBaseUrl])

  const beginEditNamedPlace = useCallback((place) => {
    if (!place?.id) {
      return
    }

    setPlaceEditId(place.id)
    setPlaceVehicleId(place.vehicleId || null)
    setPlaceName(place.name || '')
    setPlaceLatitude(String(place.latitude ?? ''))
    setPlaceLongitude(String(place.longitude ?? ''))
    setPlaceRadiusYards(String(Math.round((Number(place.radiusMeters) || METERS_PER_YARD * 75) * YARDS_PER_METER)))
    setPlaceNotes(place.notes || '')
    setEnrichmentStatus(`Editing named place ${place.name}. Update fields and click Save Named Place.`)
  }, [])

  const cancelEditNamedPlace = useCallback(() => {
    setPlaceEditId(null)
    setPlaceVehicleId(null)
    setPlaceName('')
    setPlaceLatitude('')
    setPlaceLongitude('')
    setPlaceRadiusYards('75')
    setPlaceNotes('')
    setEnrichmentStatus('Named place edit canceled.')
  }, [])

  const deleteNamedPlaceById = useCallback(async (placeId) => {
    if (!placeId) {
      return
    }

    try {
      await deleteNamedPlace(settings.vehicleApiBaseUrl, placeId)
      const places = await fetchNamedPlaces(settings.vehicleApiBaseUrl)
      setNamedPlaces(places)
      setEnrichmentStatus('Deleted named place.')
    } catch (err) {
      setEnrichmentStatus(err instanceof Error ? err.message : 'Failed to delete named place.')
    }
  }, [settings.vehicleApiBaseUrl])

  const saveTripTag = useCallback(async () => {
    if (!tagName.trim()) {
      setEnrichmentStatus('Trip tag requires a name.')
      return
    }

    try {
      const usedColors = new Set(tripTags.map((tag) => String(tag.color || '').toLowerCase()).filter(Boolean))
      const requestedColor = String(tagColor || '').toLowerCase()
      const color = requestedColor && !usedColors.has(requestedColor)
        ? requestedColor
        : TAG_COLOR_PALETTE.find((candidate) => !usedColors.has(candidate)) || '#2563eb'
      await upsertTripTag(settings.vehicleApiBaseUrl, {
        vehicleId: tagVehicleId || null,
        name: tagName.trim(),
        color,
      })

      const tags = await fetchTripTags(settings.vehicleApiBaseUrl)
      setTripTags(tags)
      setEnrichmentStatus(`Saved trip tag ${tagName.trim()}.`)
      setTagName('')
      const nextUsedColors = new Set([...usedColors, color])
      setTagColor(TAG_COLOR_PALETTE.find((candidate) => !nextUsedColors.has(candidate)) || '#2563eb')
    } catch (err) {
      setEnrichmentStatus(err instanceof Error ? err.message : 'Failed to save trip tag.')
    }
  }, [settings.vehicleApiBaseUrl, tagColor, tagName, tagVehicleId, tripTags])

  const deleteTripTagById = useCallback(async (tagId) => {
    if (!tagId) return
    try {
      await deleteTripTag(settings.vehicleApiBaseUrl, tagId)
      setTripTags(await fetchTripTags(settings.vehicleApiBaseUrl))
      setEnrichmentStatus('Deleted trip tag.')
    } catch (err) {
      setEnrichmentStatus(err instanceof Error ? err.message : 'Failed to delete trip tag.')
    }
  }, [settings.vehicleApiBaseUrl])

  const saveBinding = useCallback(async () => {
    const traccarDeviceId = toPositiveInt32(bindingDeviceId)
    if (!traccarDeviceId) {
      setBindingStatus('Select a valid Traccar device id for binding.')
      return false
    }

    setIsBindingBusy(true)
    setBindingStatus(bindingVehicleId ? 'Saving binding...' : 'Removing device assignment...')

    try {
      if (!bindingVehicleId) {
        const deviceBindings = activeBindings.filter((binding) => binding.traccarDeviceId === traccarDeviceId)
        await Promise.all(deviceBindings.map((binding) => deleteDeviceBinding(settings.vehicleApiBaseUrl, binding.id)))
        await refreshBindingData()
        setBindingStatus(deviceBindings.length
          ? `Device ${traccarDeviceId} is now unassigned; ${deviceBindings.length} binding record(s) removed.`
          : `Device ${traccarDeviceId} is already unassigned.`)
        setImportBindingHintDeviceId(null)
        return true
      }

      await upsertDeviceBinding(settings.vehicleApiBaseUrl, {
        vehicleId: bindingVehicleId,
        traccarDeviceId,
        effectiveFrom: bindingEffectiveFrom ? new Date(bindingEffectiveFrom).toISOString() : undefined,
        isPrimary: true,
      })

      await refreshBindingData()
      setBindingStatus(`Binding saved: device id ${traccarDeviceId} is now mapped to the selected vehicle.`)
      setImportBindingHintDeviceId(null)
      return true
    } catch (err) {
      setBindingStatus(err?.status === 409
        ? 'This effective date overlaps an existing device binding. Choose a date after the current binding, or remove/reconcile the existing binding before assigning an earlier historical date.'
        : err instanceof Error ? err.message : 'Failed to save device binding.')
      return false
    } finally {
      setIsBindingBusy(false)
    }
  }, [activeBindings, bindingDeviceId, bindingEffectiveFrom, bindingVehicleId, refreshBindingData, settings.vehicleApiBaseUrl])

  const selectVehicleForEdit = useCallback((vehicleId) => {
    const vehicle = bindingVehicles.find((item) => item.id === vehicleId)
    setVehicleEditId(vehicle?.id || null)
    setVehicleName(vehicle?.displayName || '')
    setVehicleVin(vehicle?.vin || '')
    setVehicleYear(vehicle?.year == null ? '' : String(vehicle.year))
    setVehicleMake(vehicle?.make || '')
    setVehicleModel(vehicle?.model || '')
    setVehicleNotes(vehicle?.notes || '')
    setVehicleProfileId(vehicleId ? (vehicleProfileById[vehicleId] || '') : '')
    const currentBinding = vehicleId ? activeBindings.find((binding) => binding.vehicleId === vehicleId) : null
    setVehicleDeviceId(currentBinding ? String(currentBinding.traccarDeviceId) : '')
    if (currentBinding?.startsAt) {
      const date = new Date(currentBinding.startsAt)
      setVehicleEffectiveFrom(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16))
    } else {
      const date = new Date()
      date.setSeconds(0, 0)
      setVehicleEffectiveFrom(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16))
    }
  }, [activeBindings, bindingVehicles, vehicleProfileById])

  useEffect(() => {
    if (!vehicleEditId && bindingVehicles.length > 0) selectVehicleForEdit(bindingVehicles[0].id)
  }, [bindingVehicles, selectVehicleForEdit, vehicleEditId])

  const saveVehicle = useCallback(async () => {
    if (!vehicleName.trim()) { setVehicleEditorStatus('Vehicle name is required.'); return }
    try {
      const selectedDeviceId = vehicleDeviceId ? Number(vehicleDeviceId) : null
      const existingDeviceBindings = selectedDeviceId
        ? activeBindings.filter((binding) => Number(binding.traccarDeviceId) === selectedDeviceId && binding.vehicleId !== vehicleEditId)
        : []
      const alreadyAssignedToVehicle = selectedDeviceId
        ? activeBindings.some((binding) => Number(binding.traccarDeviceId) === selectedDeviceId && binding.vehicleId === vehicleEditId)
        : false
      const sameVehicleBinding = selectedDeviceId
        ? activeBindings.find((binding) => Number(binding.traccarDeviceId) === selectedDeviceId && binding.vehicleId === vehicleEditId)
        : null
      if (existingDeviceBindings.length > 0) {
        const oldVehicleNames = [...new Set(existingDeviceBindings.map((binding) => binding.vehicleDisplayName))].join(', ')
        const deviceName = devices.find((device) => Number(device.id) === selectedDeviceId)?.name || `device ${selectedDeviceId}`
        const confirmed = window.confirm(`${deviceName} is currently assigned to ${oldVehicleNames}. Saving this vehicle will remove it from ${oldVehicleNames} and assign it to ${vehicleName.trim()}. Do you want to continue?`)
        if (!confirmed) { setVehicleEditorStatus('Vehicle save canceled; the existing device assignment was unchanged.'); return }
      }
      const result = await upsertVehicle(settings.vehicleApiBaseUrl, {
        id: vehicleEditId || undefined,
        displayName: vehicleName.trim(), vin: vehicleVin.trim() || null,
        year: vehicleYear ? Number(vehicleYear) : null,
        make: vehicleMake.trim() || null, model: vehicleModel.trim() || null,
        notes: vehicleNotes.trim() || null, profileId: vehicleProfileId || null, active: true,
      })
      const vehicles = await fetchVehicleCatalog(settings.vehicleApiBaseUrl)
      setBindingVehicles(vehicles)
      const id = result?.id || vehicleEditId
      if (id) setVehicleProfileById((prev) => ({ ...prev, [id]: vehicleProfileId || '' }))
      const desiredEffectiveFrom = vehicleEffectiveFrom ? new Date(vehicleEffectiveFrom).toISOString() : new Date().toISOString()
      const effectiveDateChanged = sameVehicleBinding && Math.abs(new Date(sameVehicleBinding.startsAt).getTime() - new Date(desiredEffectiveFrom).getTime()) > 1000
      if (selectedDeviceId && id && (!alreadyAssignedToVehicle || effectiveDateChanged)) {
        if (sameVehicleBinding) await deleteDeviceBinding(settings.vehicleApiBaseUrl, sameVehicleBinding.id)
        await Promise.all(existingDeviceBindings.map((binding) => deleteDeviceBinding(settings.vehicleApiBaseUrl, binding.id)))
        await upsertDeviceBinding(settings.vehicleApiBaseUrl, {
          vehicleId: id,
          traccarDeviceId: selectedDeviceId,
          effectiveFrom: desiredEffectiveFrom,
          isPrimary: true,
        })
        await refreshBindingData()
      }
      setVehicleEditorStatus(`Saved vehicle ${vehicleName.trim()}.`)
      if (!vehicleEditId && id) selectVehicleForEdit(id)
    } catch (err) { setVehicleEditorStatus(err instanceof Error ? err.message : 'Failed to save vehicle.') }
  }, [activeBindings, deleteDeviceBinding, devices, fetchVehicleCatalog, refreshBindingData, selectVehicleForEdit, settings.vehicleApiBaseUrl, upsertDeviceBinding, vehicleDeviceId, vehicleEditId, vehicleEffectiveFrom, vehicleMake, vehicleModel, vehicleName, vehicleNotes, vehicleProfileId, vehicleVin, vehicleYear])

  const deleteBindingById = useCallback(async (bindingId) => {
    if (!bindingId) {
      return
    }

    setIsBindingBusy(true)
    setBindingStatus('Deleting binding...')

    try {
      await deleteDeviceBinding(settings.vehicleApiBaseUrl, bindingId)
      await refreshBindingData()
      setBindingStatus('Binding deleted and lists refreshed.')
    } catch (err) {
      setBindingStatus(err instanceof Error ? err.message : 'Failed to delete device binding.')
    } finally {
      setIsBindingBusy(false)
    }
  }, [refreshBindingData, settings.vehicleApiBaseUrl])

  useEffect(() => {
    // Load enrichment data for the map on startup as well as when Settings is
    // opened. Previously named places were only fetched by the Settings flow.
    if (!isSettingsOpen && namedPlaces.length > 0) {
      return
    }

    refreshBindingData()
  }, [isSettingsOpen, namedPlaces.length, refreshBindingData])

  const loadHistorySummaries = useCallback(async (fromDate, toDate, label, { merge = false, selectFirstDay = false } = {}) => {
    setError('')
    setStatus(`Loading ${label} summary...`)
    const rows = await fetchTripDaySummaries(settings.vehicleApiBaseUrl, { from: fromDate, to: toDate })
    const mergedRows = merge ? mergeHistoryRows(historyDayRowsRef.current, rows) : rows
    const nextSummaries = summarizeSavedTrips(mergedRows)
    historyDayRowsRef.current = mergedRows
    setHistoryDayRows(mergedRows)
    setHistoryDaySummaries(nextSummaries)
    setHistoryWindow((previous) => ({
      from: merge ? new Date(Math.min(previous.from.getTime(), fromDate.getTime())) : fromDate,
      to: merge ? new Date(Math.max(previous.to.getTime(), toDate.getTime())) : toDate,
    }))
    if ((selectFirstDay || !merge) && nextSummaries.length > 0) {
      setSelectedDayKey(nextSummaries[0].dayKey)
      setSelectedDayKeys([nextSummaries[0].dayKey])
      setDaySelectionAnchor(nextSummaries[0].dayKey)
    }
    setStatus(`Loaded history summary for ${nextSummaries.length} active day${nextSummaries.length === 1 ? '' : 's'}`)
    return { rows, summaries: nextSummaries }
  }, [settings.vehicleApiBaseUrl])

  useEffect(() => {
    const selectedDays = notificationSelectedDays
    let from
    let to
    if (selectedDays.length > 0) {
      from = new Date(`${selectedDays[0]}T00:00:00`)
      to = new Date(`${selectedDays.at(-1)}T23:59:59.999`)
    } else {
      to = new Date()
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
    }
    let active = true
    setNotificationsLoading(true)
    fetchTripEventNotifications(settings.vehicleApiBaseUrl, { from, to })
      .then((rows) => {
        if (!active) return
        const result = Array.isArray(rows) ? rows : []
        if (selectedDays.length === 0) {
          setNotifications(result)
          return
        }
        const selected = new Set(selectedDays)
        setNotifications(result.filter((row) => {
          const occurred = new Date(row.occurredAt)
          if (Number.isNaN(occurred.getTime())) return false
          const dayKey = `${occurred.getFullYear()}-${String(occurred.getMonth() + 1).padStart(2, '0')}-${String(occurred.getDate()).padStart(2, '0')}`
          return selected.has(dayKey)
        }))
      })
      .catch(() => { if (active) setNotifications([]) })
      .finally(() => { if (active) setNotificationsLoading(false) })
    return () => { active = false }
  }, [notificationSelectedDays, notificationsRefreshNonce, settings.vehicleApiBaseUrl])

  const loadHistoryMonth = useCallback(async (monthKey, { force = false, selectFirstDay = false } = {}) => {
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return
    if (!force && loadedHistoryMonthsRef.current.has(monthKey)) return
    setHistoryMonthLoadState((previous) => ({ ...previous, [monthKey]: 'loading' }))
    loadedHistoryMonthsRef.current.add(monthKey)
    const [year, month] = monthKey.split('-').map(Number)
    const from = new Date(year, month - 1, 1)
    const through = new Date(year, month, 1)
    through.setMilliseconds(-1)
    try {
      const result = await loadHistorySummaries(from, through, `${monthKey} history`, { merge: true, selectFirstDay })
      setHistoryMonthLoadState((previous) => ({ ...previous, [monthKey]: result.rows.length > 0 ? 'loaded' : 'empty' }))
    } catch (err) {
      loadedHistoryMonthsRef.current.delete(monthKey)
      setHistoryMonthLoadState((previous) => ({ ...previous, [monthKey]: 'error' }))
      throw err
    }
  }, [loadHistorySummaries])

  useEffect(() => {
    const imported = bouncieStatus?.import
    if (imported?.state !== 'completed' || !imported.jobId || bouncieHistoryRefreshRef.current === imported.jobId) return
    const from = imported.from ? new Date(imported.from) : null
    const through = imported.through ? new Date(imported.through) : null
    if (!from || !through || Number.isNaN(from.getTime()) || Number.isNaN(through.getTime())) return
    bouncieHistoryRefreshRef.current = imported.jobId
    try {
      const existing = JSON.parse(localStorage.getItem('vehicleApp:lastBouncieImportRange') || 'null')
      const existingFrom = existing?.from ? new Date(existing.from) : null
      const existingThrough = existing?.through ? new Date(existing.through) : null
      const savedFrom = existingFrom && !Number.isNaN(existingFrom.getTime()) ? new Date(Math.min(existingFrom.getTime(), from.getTime())) : from
      const savedThrough = existingThrough && !Number.isNaN(existingThrough.getTime()) ? new Date(Math.max(existingThrough.getTime(), through.getTime())) : through
      localStorage.setItem('vehicleApp:lastBouncieImportRange', JSON.stringify({ from: savedFrom.toISOString(), through: savedThrough.toISOString() }))
    } catch {
      // Local storage may be unavailable in private or restricted browser contexts.
    }
    loadHistorySummaries(from, through, 'Bouncie import', { merge: true }).catch(() => {
      // The import itself has completed; leave the existing history visible if
      // a follow-up summary refresh cannot be completed.
    })
  }, [bouncieStatus?.import, loadHistorySummaries])

  const loadHistoryRange = useCallback(
    async (fromDate, toDate, label, { merge = false, pointOnly = false, requestId = null } = {}) => {
      setError('')
      setStatus(`Loading ${label}...`)

      const workingDevices = devices.length > 0 ? devices : await loadDevices()

      if (!workingDevices.length) {
        setHistoryByDevice({})
        setStatus('No devices found in Traccar')
        return
      }

      const fromIso = fromDate.toISOString()
      const toIso = toDate.toISOString()

      const histories = await Promise.all(
        workingDevices.map(async (device) => {
          const params = new URLSearchParams({
            deviceId: String(device.id),
            from: fromIso,
            to: toIso,
          })

          const data = await apiFetch(`/positions?${params.toString()}`)
          const mapped = (Array.isArray(data) ? data : []).map(toHistoryPosition)
          mapped.sort((a, b) => a.timestamp - b.timestamp)
          return [device.id, mapped]
        }),
      )

      const nextHistory = Object.fromEntries(histories)
      if (pointOnly && requestId !== pointLoadRequestRef.current) return
      const pointCount = Object.values(nextHistory).reduce((acc, points) => acc + points.length, 0)

      setHistoryByDevice((previous) => {
        if (!merge) return nextHistory
        const merged = {}
        workingDevices.forEach((device) => {
          const points = [...(previous[device.id] || []), ...(nextHistory[device.id] || [])]
          const unique = new Map(points.map((point) => [`${point.positionId || ''}:${point.timestamp.getTime()}`, point]))
          merged[device.id] = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp)
        })
        return merged
      })
      if (!pointOnly) {
        setHistoryWindow((previous) => ({
          from: merge ? new Date(Math.min(previous.from.getTime(), fromDate.getTime())) : fromDate,
          to: merge ? new Date(Math.max(previous.to.getTime(), toDate.getTime())) : toDate,
        }))
      }
      const loadedDayKeys = Object.values(nextHistory).flat().map((point) => {
        const date = point.timestamp
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      })
      if (!merge && !pointOnly && loadedDayKeys.length > 0) setSelectedDayKey([...new Set(loadedDayKeys)].sort().at(-1))
      setStatus(`Loaded ${workingDevices.length} devices and ${pointCount} points; syncing trips...`)

      // Keep the normal day view synchronized with VehicleApp. The import API
      // is idempotent, so revisiting a range only skips existing identities.
      let imported = 0
      let skipped = 0
      for (const device of workingDevices) {
        const traccarDeviceId = toPositiveInt32(device.id)
        if (!traccarDeviceId) continue
        const derivedTrips = buildTripsForDevice(device.id, nextHistory[device.id] || [], settings.movementThresholdM)
        const tripsPayload = derivedTrips.map((trip) => ({
          startTraccarPositionId: trip.startTraccarPositionId,
          endTraccarPositionId: trip.endTraccarPositionId,
          startLabel: labelForNamedPlace(trip.startLatitude, trip.startLongitude, namedPlaces, device.appVehicleId),
          endLabel: labelForNamedPlace(trip.endLatitude, trip.endLongitude, namedPlaces, device.appVehicleId),
          startLatitude: trip.startLatitude ?? null,
          startLongitude: trip.startLongitude ?? null,
          endLatitude: trip.endLatitude ?? null,
          endLongitude: trip.endLongitude ?? null,
          startedAt: trip.start.toISOString(),
          endedAt: trip.end.toISOString(),
          durationSeconds: Math.max(1, Math.round((trip.end - trip.start) / 1000)),
          distanceMeters: Number(Number(trip.distance).toFixed(2)),
          maxSpeedMph: getTripMaxSpeedMph(trip),
        }))
        if (!tripsPayload.length) continue
        try {
          const result = await importTripsByDevice(settings.vehicleApiBaseUrl, {
            traccarDeviceId,
            derivationVersion: `trip-v1-movement-${settings.movementThresholdM}`,
            treatOverlappingAsExisting: true,
            trips: tripsPayload,
          })
          imported += result.imported || 0
          skipped += result.skipped || 0
        } catch (importErr) {
          // A missing binding should remain actionable through the transfer
          // dialog; it must not prevent the map from displaying history.
          const recovery = describeTripImportConflict(importErr, traccarDeviceId)
          const bindingMissingForUnmanagedDevice = recovery?.code === 'trip_import_binding_missing'
            && !device.appVehicleId
            && !activeBindings.some((binding) => Number(binding.traccarDeviceId) === traccarDeviceId)
            && !bindingVehicles.some((vehicle) => Number(vehicle?.traccarDeviceId) === traccarDeviceId)
            && !historyDayRows.some((row) => Number(row?.traccarDeviceId) === traccarDeviceId)
          if (bindingMissingForUnmanagedDevice) {
            setImportStatus(`Automatic trip sync skipped for ${device.name}: device id ${traccarDeviceId} is not mapped to a vehicle.`)
            continue
          }
          if (recovery) {
            setImportRecovery(recovery)
            setImportStatus(`Automatic trip sync skipped for ${device.name}: ${recovery.title}. ${recovery.steps[0] || ''}`.trim())
            if (recovery.bindingHintDeviceId) setImportBindingHintDeviceId(recovery.bindingHintDeviceId)
          } else {
            setImportStatus(importErr instanceof Error ? importErr.message : 'Automatic trip sync failed.')
          }
        }
      }
      setStatus(`Loaded ${workingDevices.length} devices and ${pointCount} points; trips synchronized (${imported} new, ${skipped} already saved)`)
    },
    [
      activeBindings,
      apiFetch,
      bindingVehicles,
      devices,
      historyDayRows,
      loadDevices,
      namedPlaces,
      settings.movementThresholdM,
      settings.vehicleApiBaseUrl,
    ],
  )

  useEffect(() => {
    const requestedDays = selectedDayKeys.length > 0 ? selectedDayKeys : (selectedDayKey ? [selectedDayKey] : [])
    if (requestedDays.length === 0 || daySummaries.length === 0) return
    const daysToLoad = requestedDays.filter((dayKey) => !loadedPointDaysRef.current.has(dayKey))
    if (daysToLoad.length === 0) return
    const requestId = pointLoadRequestRef.current + 1
    pointLoadRequestRef.current = requestId
    daysToLoad.forEach((dayKey) => loadedPointDaysRef.current.add(dayKey))
    Promise.all(daysToLoad.map((dayKey) => {
      const dayStart = new Date(`${dayKey}T00:00:00`)
      const dayEnd = new Date(`${dayKey}T23:59:59.999`)
      return loadHistoryRange(dayStart, dayEnd, `day ${dayKey}`, { pointOnly: true, merge: true, requestId })
    })).catch(() => {
      daysToLoad.forEach((dayKey) => loadedPointDaysRef.current.delete(dayKey))
    })
  }, [daySummaries.length, loadHistoryRange, selectedDayKey, selectedDayKeys])

  const fetchLiveSnapshot = useCallback(async () => {
    try {
      const payload = await apiFetch('/positions')
      const positions = Array.isArray(payload) ? payload : []
      const cutoff = Date.now() - settings.realtimeHours * 60 * 60 * 1000

      setHistoryByDevice((prev) => {
        const next = { ...prev }

        positions.forEach((position) => {
          const id = position.deviceId
          const mapped = toHistoryPosition(position)
          const existing = next[id] ? [...next[id]] : []

          const last = existing[existing.length - 1]
          if (!last || last.timestamp.getTime() !== mapped.timestamp.getTime()) {
            existing.push(mapped)
          }

          next[id] = existing.filter((point) => point.timestamp.getTime() >= cutoff)
        })

        return next
      })

      setStatus(`Live update: ${positions.length} active positions @ ${new Date().toLocaleTimeString()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown live update error')
      setStatus('Live update failed')
    }
  }, [apiFetch, settings.realtimeHours])

  const applyTimeRange = useCallback(async () => {
    setSelectedDayKey(null)
    setSelectedDayKeys([])
    setDaySelectionAnchor(null)
    setShowTripsPanel(false)
    historyDayRowsRef.current = []
    setHistoryDayRows([])
    setHistoryDaySummaries([])
    loadedHistoryMonthsRef.current.clear()
    setHistoryMonthLoadState({})

    try {
      setStatus('Loading history index...')
      const [span, monthSummaries] = await Promise.all([
        fetchTripHistorySpan(settings.vehicleApiBaseUrl),
        fetchTripHistoryMonthSummaries(settings.vehicleApiBaseUrl),
      ])
      setHistorySpan(span)
      setHistoryMonthSummaryByKey(Object.fromEntries(monthSummaries
        .filter((row) => row?.monthKey)
        .map((row) => [row.monthKey, {
          activeDayCount: Number(row.activeDayCount) || 0,
          tripCount: Number(row.tripCount) || 0,
        }])))

      if (!span?.tripCount || !span?.latestEndedAt) {
        setStatus('No history is available yet.')
        return
      }

      const latestMonthKey = toMonthKey(span.latestEndedAt)
      if (!latestMonthKey) {
        setStatus('History is available, but the latest month could not be resolved.')
        return
      }

      await loadHistoryMonth(latestMonthKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown history load error')
      setStatus('History load failed')
    }
  }, [loadHistoryMonth, settings.vehicleApiBaseUrl])

  useEffect(() => {
    if (startupLoadRef.current) return
    startupLoadRef.current = true
    loadDevices().catch((err) => {
      setError(err instanceof Error ? err.message : 'Unable to load Traccar devices.')
      setStatus('Device load failed')
    })
    applyTimeRange()
  }, [applyTimeRange, loadDevices])

  useEffect(() => {
    if (initialCurrentLocationsLoadedRef.current || devices.length === 0) return
    initialCurrentLocationsLoadedRef.current = true
    const through = new Date()
    const from = new Date(through.getTime() - 48 * 60 * 60 * 1000)
    loadHistoryRange(from, through, 'current device locations', { merge: true }).catch(() => {
      initialCurrentLocationsLoadedRef.current = false
    })
  }, [devices.length, loadHistoryRange])

  useEffect(() => {
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current)
      liveIntervalRef.current = null
    }

    if (timeMode !== 'realtime') {
      return
    }

    liveIntervalRef.current = setInterval(() => {
      fetchLiveSnapshot()
    }, Math.max(1000, settings.pollIntervalMs))

    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current)
      }
    }
  }, [fetchLiveSnapshot, settings.pollIntervalMs, timeMode])

  const focusTrip = useCallback(async (trip) => {
    const map = mapRef.current
    if (!map || !trip?.points?.length) {
      return
    }

    const bounds = L.latLngBounds(trip.points)
    mapAutoFitRef.current = true
    programmaticMapMoveRef.current = true
    fitBoundsWithPanelOffset(map, bounds, [30, 30])
    setTimeout(() => {
      programmaticMapMoveRef.current = false
    }, 0)
    const selection = tripSelectionGate.current.begin()
    const isCurrent = () => tripSelectionGate.current.isCurrent(selection)
    setSelectedTripId(trip.tripId)
    setSelectedTrip(trip)
    setStatusDeviceId(trip.deviceId)
    const firstPoint = trip.points[0]
    const firstPointMetadata = Array.isArray(firstPoint) ? (firstPoint[2] || {}) : firstPoint
    const firstLatitude = Array.isArray(firstPoint) ? firstPoint[0] : firstPoint?.latitude
    const firstLongitude = Array.isArray(firstPoint) ? firstPoint[1] : firstPoint?.longitude
    setSelectedMapPoint(Number.isFinite(Number(firstLatitude)) && Number.isFinite(Number(firstLongitude))
      ? {
          deviceId: trip.deviceId,
          point: {
            ...firstPointMetadata,
            latitude: Number(firstLatitude),
            longitude: Number(firstLongitude),
            timestamp: firstPointMetadata?.timestamp instanceof Date ? firstPointMetadata.timestamp : new Date(firstPointMetadata?.timestamp || trip.start),
          },
        }
      : null)
    setSelectedBackendTripId(null)
    setSelectedTripRoutePoints([])
    setSelectedTripMaxSpeedMph(null)
    setTripEditorTags([])
    setSelectedTripEvents([])
    setTagToAdd('')
    setTripNoteDraft('')
    setTripEditorStatus('Resolving saved trip...')
    setTripEditorLoading(true)

    try {
      let savedTrip
      if (trip.savedTripId) {
        savedTrip = { id: trip.savedTripId, vehicleId: trip.vehicleId, maxSpeedMph: trip.maxSpeedMph, notes: trip.notes, derivationVersion: trip.derivationVersion }
      } else {
        try {
          savedTrip = await resolveTrip(settings.vehicleApiBaseUrl, trip)
        } catch (resolveError) {
          if (resolveError?.status !== 404) throw resolveError

          const device = devices.find((item) => Number(item.id) === Number(trip.deviceId))
          const vehicleId = trip.vehicleId
            || device?.appVehicleId
            || activeBindings.find((binding) => Number(binding.traccarDeviceId) === Number(trip.deviceId))?.vehicleId
          const startPositionId = Number(trip.startTraccarPositionId)
          const endPositionId = Number(trip.endTraccarPositionId)
          if (!vehicleId || !Number.isFinite(startPositionId) || !Number.isFinite(endPositionId) || startPositionId <= 0 || endPositionId <= 0) {
            throw resolveError
          }

          setTripEditorStatus('Trip is not synchronized yet. Importing this trip…')
          await importTripsByDevice(settings.vehicleApiBaseUrl, {
            traccarDeviceId: Number(trip.deviceId),
            derivationVersion: `trip-v1-movement-${settings.movementThresholdM}`,
            treatOverlappingAsExisting: true,
            trips: [{
              startTraccarPositionId: startPositionId,
              endTraccarPositionId: endPositionId,
              startLabel: labelForNamedPlace(trip.startLatitude, trip.startLongitude, namedPlaces, vehicleId),
              endLabel: labelForNamedPlace(trip.endLatitude, trip.endLongitude, namedPlaces, vehicleId),
              startLatitude: trip.startLatitude ?? null,
              startLongitude: trip.startLongitude ?? null,
              endLatitude: trip.endLatitude ?? null,
              endLongitude: trip.endLongitude ?? null,
              startedAt: trip.start.toISOString(),
              endedAt: trip.end.toISOString(),
              durationSeconds: Math.max(1, Math.round((trip.end - trip.start) / 1000)),
              distanceMeters: Number(Number(trip.distance || 0).toFixed(2)),
              maxSpeedMph: getTripMaxSpeedMph(trip),
            }],
          })
          savedTrip = await resolveTrip(settings.vehicleApiBaseUrl, trip)
        }
      }
      if (!isCurrent()) return
      const [tagResults, initialEvents, routeRows] = await Promise.all([
        Promise.all([
          fetchTripTagsForTrip(settings.vehicleApiBaseUrl, savedTrip.id),
          fetchTripTags(settings.vehicleApiBaseUrl, savedTrip.vehicleId),
        ]),
        fetchTripEvents(settings.vehicleApiBaseUrl, savedTrip.id),
        fetchTripRoutePoints(settings.vehicleApiBaseUrl, savedTrip.id).catch(() => []),
      ])
      const [mappedTags, knownTags] = tagResults
      let events = initialEvents
      if (!isCurrent()) return

      if (!Array.isArray(events) || events.length === 0) {
        const detectedEvents = detectTripEvents(trip, resolveEventThresholds())
        if (detectedEvents.length > 0) {
          await saveTripEvents(settings.vehicleApiBaseUrl, savedTrip.id, detectedEvents)
          events = await fetchTripEvents(settings.vehicleApiBaseUrl, savedTrip.id)
        }
      }

      // Enable writes only after this selection's complete metadata has loaded.
      setSelectedBackendTripId(savedTrip.id)
      if (isCurrent() && routeRows.length > 0) {
        setSelectedTripRoutePoints(routeRows.map((point) => ({
          latitude: Number(point.latitude),
          longitude: Number(point.longitude),
          timestamp: point.occurredAt ? new Date(point.occurredAt) : trip.start,
          speedMph: Number.isFinite(Number(point.speedMph)) ? Number(point.speedMph) : null,
          speed: Number.isFinite(Number(point.speedMph)) ? Number(point.speedMph) / 1.15078 : 0,
          attributes: {},
        })))
      }
      const computedMaxSpeedMph = getTripMaxSpeedMph(trip)
      const persistedMaxSpeedMph = Number(savedTrip.maxSpeedMph)
      // Older imports may contain a placeholder zero. Prefer the current
      // telemetry-derived value whenever it is available.
      setSelectedTripMaxSpeedMph(Number.isFinite(computedMaxSpeedMph) && computedMaxSpeedMph > persistedMaxSpeedMph
        ? computedMaxSpeedMph
        : (Number.isFinite(persistedMaxSpeedMph) ? persistedMaxSpeedMph : computedMaxSpeedMph))
      setTripNoteDraft(savedTrip.notes || '')
      setTripEditorTags(mappedTags)
      setSelectedTripEvents(collapseTripEvents(events))
      setTripEditorAvailableTags(knownTags)
      setTripEditorStatus('')
    } catch (err) {
      if (isCurrent()) {
        if (err?.status === 404) {
      setTripEditorStatus('This trip is visible in Traccar but has not been synchronized into VehicleApp yet. Refresh or select its day to synchronize saved trip data before adding notes or tags.')
        } else {
          setTripEditorStatus(err instanceof Error ? err.message : 'Failed to load trip metadata.')
        }
      }
    } finally {
      if (isCurrent()) setTripEditorLoading(false)
    }
  }, [activeBindings, devices, namedPlaces, settings.movementThresholdM, settings.vehicleApiBaseUrl])

  const editSelectedTrip = useCallback(async (action, successMessage, reloadTags = false) => {
    if (!selectedBackendTripId || tripEditorLoading || tripWritePending.current) return
    const selection = tripSelectionGate.current.current()
    const isCurrent = () => tripSelectionGate.current.isCurrent(selection)
    tripWritePending.current = true
    setTripEditorBusy(true)
    try {
      await action(selectedBackendTripId)
      if (!isCurrent()) return
      if (reloadTags) {
        const mapped = await fetchTripTagsForTrip(settings.vehicleApiBaseUrl, selectedBackendTripId)
        if (!isCurrent()) return
        setTripEditorTags(mapped)
        setTagToAdd('')
      }
      setTripEditorStatus(successMessage)
    } catch (err) {
      if (isCurrent()) setTripEditorStatus(err instanceof Error ? err.message : 'Failed to save trip metadata.')
    } finally {
      tripWritePending.current = false
      setTripEditorBusy(false)
    }
  }, [selectedBackendTripId, settings.vehicleApiBaseUrl, tripEditorLoading])

  const addSelectedTripTag = useCallback(() => {
    if (!tagToAdd) return
    return editSelectedTrip(
      (id) => addTagToTrip(settings.vehicleApiBaseUrl, id, tagToAdd),
      'Tag added to trip.', true,
    )
  }, [editSelectedTrip, settings.vehicleApiBaseUrl, tagToAdd])

  const removeSelectedTripTag = useCallback((tagId) => {
    if (!tagId) return
    return editSelectedTrip(
      (id) => removeTagFromTrip(settings.vehicleApiBaseUrl, id, tagId),
      'Tag removed from trip.', true,
    )
  }, [editSelectedTrip, settings.vehicleApiBaseUrl])

  const saveSelectedTripNote = useCallback(() => editSelectedTrip(
    (id) => updateTripNotes(settings.vehicleApiBaseUrl, id, tripNoteDraft),
    'Trip note saved.',
  ), [editSelectedTrip, settings.vehicleApiBaseUrl, tripNoteDraft])

  const testApi = useCallback(async () => {
    setError('')
    setStatus('Testing API...')

    try {
      const payload = await apiFetch('/server')
      const version = payload?.version ? ` (${payload.version})` : ''
      setStatus(`Connected to Traccar${version}`)
    } catch (err) {
      setStatus('Connection failed')
      setError(err instanceof Error ? err.message : 'Unknown API error')
    }
  }, [apiFetch])

  const exportRangeData = useCallback(async () => {
    if (!exportDeviceId) {
      setExportMessage('Select a device before exporting.')
      setError('Select a device to export.')
      return
    }

    const device = devices.find((item) => item.id === exportDeviceId)
    if (!device) {
      setExportMessage('The selected device could not be found.')
      setError('Selected device was not found.')
      return
    }

    let range
    try {
      range = getExportRangePreset(exportRangePreset, exportStartDate, exportEndDate)
    } catch (rangeErr) {
      setExportMessage(rangeErr instanceof Error ? rangeErr.message : 'Invalid export range.')
      setError(rangeErr instanceof Error ? rangeErr.message : 'Invalid export range')
      return
    }

    setExportMessage(`Loading ${range.label} from Traccar...`)
    setError('')
    setStatus(`Exporting ${range.label} from Traccar...`)

    let rangedPoints = []
    try {
      const params = new URLSearchParams({
        deviceId: String(exportDeviceId),
        from: range.start.toISOString(),
        to: range.end.toISOString(),
      })

      const payload = await apiFetch(`/positions?${params.toString()}`)
      rangedPoints = (Array.isArray(payload) ? payload : []).map(toHistoryPosition)
      rangedPoints.sort((a, b) => a.timestamp - b.timestamp)
    } catch (exportErr) {
      setExportMessage(exportErr instanceof Error ? exportErr.message : 'Failed to load export data from Traccar.')
      setError(exportErr instanceof Error ? exportErr.message : 'Failed to load export data from Traccar')
      setStatus('Export failed')
      return
    }

    if (rangedPoints.length === 0) {
      setExportMessage(`No points were found for ${range.label} on ${device.name}.`)
      setError(`No points were found for ${range.label} on this device.`)
      setStatus('Nothing to export')
      return
    }

    const assignedProfileId = deviceProfileById[exportDeviceId] || DEFAULT_PROFILE_ID
    const selectedProfile = profileMap[assignedProfileId] || profileMap[DEFAULT_PROFILE_ID]
    if (!selectedProfile) {
      setExportMessage('No valid device protocol profile was found for this export.')
      setError('No valid car profile found for export.')
      return
    }

    const dayKey = range.start.toISOString().slice(0, 10)
    const csv = buildRangeCsv({
      dayKey,
      deviceName: device.name,
      points: rangedPoints,
      carProfile: selectedProfile,
      headerMode: exportHeaderMode,
    })

    downloadCsvFile(csv)
    setExportMessage(`Exported ${rangedPoints.length} points for ${range.label} on ${device.name}.`)
    setError('')
    setStatus(`Exported ${rangedPoints.length} points for ${range.label} on ${device.name}`)
  }, [
    devices,
    exportDeviceId,
    exportEndDate,
    exportHeaderMode,
    exportRangePreset,
    exportStartDate,
    deviceProfileById,
    profileMap,
    apiFetch,
  ])

  const importDataFile = useCallback(async (file) => {
    if (!file) return
    setDataImportMessage('Reading CSV and detecting its format...')
    try {
      const text = await file.text()
      const appCsv = parseAppPositionCsv(text, exportDeviceId || 0)

      if (appCsv.format === 'traccar-react-positions-v1') {
        if (!exportDeviceId) {
          setDataImportMessage('This is a Traccar React position export. Select its target device above before restoring it.')
          return
        }

        const device = devices.find((item) => item.id === exportDeviceId)
        if (!device || appCsv.rows.length === 0) {
          setDataImportMessage('The Traccar React export did not contain any valid positions.')
          return
        }

        setHistoryByDevice((previous) => ({ ...previous, [exportDeviceId]: appCsv.rows }))
        setDeviceVisibility((previous) => ({ ...previous, [exportDeviceId]: true }))
        const first = appCsv.rows[0].timestamp
        const last = appCsv.rows[appCsv.rows.length - 1].timestamp
        setHistoryWindow({ from: first, to: last })
        const firstDay = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`
        setSelectedDayKey(firstDay)
        setSelectedDayKeys([firstDay])
        setDaySelectionAnchor(firstDay)

        const derivedTrips = buildTripsForDevice(exportDeviceId, appCsv.rows, settings.movementThresholdM)
        if (derivedTrips.length === 0) {
          setDataImportMessage(`Restored ${appCsv.rows.length} positions for ${device.name}; no movement trips were found.`)
          setStatus(`Restored ${appCsv.rows.length} positions from Traccar React CSV`)
          return
        }

        const primaryDeviceId = toPositiveInt32(exportDeviceId)
        const importVehicleId = device.appVehicleId
          || activeBindings.find((binding) => binding.traccarDeviceId === primaryDeviceId)?.vehicleId
        const tripsPayload = derivedTrips.map((trip) => ({
          startTraccarPositionId: null,
          endTraccarPositionId: null,
          startLabel: labelForNamedPlace(trip.startLatitude, trip.startLongitude, namedPlaces, importVehicleId),
          endLabel: labelForNamedPlace(trip.endLatitude, trip.endLongitude, namedPlaces, importVehicleId),
          startedAt: trip.start.toISOString(),
          endedAt: trip.end.toISOString(),
          durationSeconds: Math.max(1, Math.round((trip.end - trip.start) / 1000)),
          distanceMeters: Number(trip.distance.toFixed(2)),
          maxSpeedMph: getTripMaxSpeedMph(trip),
        }))

        try {
          const result = await importTripsByDevice(settings.vehicleApiBaseUrl, {
            traccarDeviceId: primaryDeviceId,
            derivationVersion: `trip-v1-restored-csv-${settings.movementThresholdM}`,
            treatOverlappingAsExisting: true,
            trips: tripsPayload,
          })
          setImportRecovery(null)
          setDataImportMessage(`Restored ${appCsv.rows.length} positions for ${device.name}; saved ${result.imported} trips and skipped ${result.skipped} duplicates.`)
          await loadHistorySummaries(first, last, 'restored history')
        } catch (tripError) {
          const recovery = describeTripImportConflict(tripError, primaryDeviceId)
          if (recovery) {
            setImportRecovery(recovery)
            if (recovery.bindingHintDeviceId) setImportBindingHintDeviceId(recovery.bindingHintDeviceId)
            setDataImportMessage(`Restored ${appCsv.rows.length} positions for ${device.name}, but trip import was blocked: ${recovery.title}. ${recovery.steps[0] || ''}`)
          } else {
            setDataImportMessage(`Restored ${appCsv.rows.length} positions for ${device.name}, but trips were not saved: ${tripError instanceof Error ? tripError.message : 'backend import failed'}`)
          }
        }
        setStatus(`Restored ${appCsv.rows.length} positions from Traccar React CSV`)
        return
      }

      const vehicles = await fetchVehicleCatalog(settings.vehicleApiBaseUrl)
      const parsed = parseBouncieCsv(text, vehicles)
      if (parsed.rows.length === 0) {
        setDataImportMessage(appCsv.error || `No importable rows found. ${parsed.unmatched.length} row(s) did not match a catalog vehicle.`)
        return
      }
      const result = await importBouncieTrips(settings.vehicleApiBaseUrl, parsed.rows)
      setDataImportMessage(`Bouncie import complete: ${result.imported} added, ${result.skipped} duplicates skipped, ${result.importedEvents} events saved${parsed.unmatched.length ? `, ${parsed.unmatched.length} unmatched row(s)` : ''}.`)
      await loadHistorySummaries(historyWindow.from, historyWindow.to, 'updated history')
    } catch (err) {
      setDataImportMessage(err instanceof Error ? err.message : 'Data import failed.')
    }
  }, [activeBindings, devices, exportDeviceId, historyWindow.from, historyWindow.to, loadHistorySummaries, namedPlaces, settings.movementThresholdM, settings.vehicleApiBaseUrl])

  const importTripsToBackend = useCallback(async () => {
    if (!exportDeviceId) {
      setError('Select a device to import trips.')
      return
    }

    const primaryDeviceId = toPositiveInt32(exportDeviceId)
    if (!primaryDeviceId) {
      setError('Selected device id is not a valid 32-bit integer for backend import binding.')
      return
    }

    const device = devices.find((item) => item.id === exportDeviceId)
    if (!device) {
      setError('Selected device was not found.')
      return
    }

    let range
    try {
      range = getExportRangePreset(exportRangePreset, exportStartDate, exportEndDate)
    } catch (rangeErr) {
      setError(rangeErr instanceof Error ? rangeErr.message : 'Invalid import range')
      return
    }

    setError('')
    setImportBindingHintDeviceId(null)
    setImportRecovery(null)
    setImportStatus('Loading range points from Traccar...')
    setStatus(`Preparing derived trips for ${device.name} (${range.label})...`)
    setIsImportingTrips(true)

    try {
      const params = new URLSearchParams({
        deviceId: String(exportDeviceId),
        from: range.start.toISOString(),
        to: range.end.toISOString(),
      })

      const payload = await apiFetch(`/positions?${params.toString()}`)
      const rangedPoints = (Array.isArray(payload) ? payload : []).map(toHistoryPosition)
      rangedPoints.sort((a, b) => a.timestamp - b.timestamp)

      const derivedTrips = buildTripsForDevice(exportDeviceId, rangedPoints, settings.movementThresholdM)

      if (derivedTrips.length === 0) {
        setImportStatus(`No derived trips found for ${range.label} on ${device.name}.`)
        setStatus('No derived trips to import')
        return
      }

      const tripsPayload = derivedTrips
        .map((trip) => {
          const importVehicleId = device.appVehicleId
            || activeBindings.find((binding) => binding.traccarDeviceId === primaryDeviceId)?.vehicleId
          const durationSeconds = Math.max(0, Math.round((trip.end.getTime() - trip.start.getTime()) / 1000))
          const distanceMeters = Number(trip.distance)

          if (
            !(trip.start instanceof Date)
            || !(trip.end instanceof Date)
            || Number.isNaN(trip.start.getTime())
            || Number.isNaN(trip.end.getTime())
            || trip.end < trip.start
            || !Number.isFinite(distanceMeters)
            || durationSeconds <= 0
          ) {
            return null
          }

          return {
            startTraccarPositionId: trip.startTraccarPositionId,
            endTraccarPositionId: trip.endTraccarPositionId,
            startLabel: labelForNamedPlace(trip.startLatitude, trip.startLongitude, namedPlaces, importVehicleId),
            endLabel: labelForNamedPlace(trip.endLatitude, trip.endLongitude, namedPlaces, importVehicleId),
            startedAt: trip.start.toISOString(),
            endedAt: trip.end.toISOString(),
            durationSeconds,
            distanceMeters: Number(distanceMeters.toFixed(2)),
            maxSpeedMph: getTripMaxSpeedMph(trip),
          }
        })
        .filter(Boolean)

      const filteredOutCount = derivedTrips.length - tripsPayload.length
      if (tripsPayload.length === 0) {
        setImportStatus(`All ${derivedTrips.length} derived trips were invalid for import payload.`)
        setStatus('No valid derived trips to import')
        return
      }

      const result = await importTripsByDevice(settings.vehicleApiBaseUrl, {
        traccarDeviceId: primaryDeviceId,
        derivationVersion: `trip-v1-movement-${settings.movementThresholdM}`,
        trips: tripsPayload,
      })
      setImportRecovery(null)
      setImportStatus(
        `Import complete for ${device.name}: imported ${result.imported}, skipped ${result.skipped} duplicates${filteredOutCount > 0 ? `; filtered ${filteredOutCount} invalid trip(s)` : ''}.`,
      )
      setStatus(`Trip import complete for ${device.name}`)
    } catch (importErr) {
      const message = importErr instanceof Error ? importErr.message : 'Trip import failed'
      setError(message)
      const recovery = describeTripImportConflict(importErr, primaryDeviceId)
      if (recovery) {
        setImportRecovery(recovery)
        if (recovery.bindingHintDeviceId) setImportBindingHintDeviceId(recovery.bindingHintDeviceId)
        setImportStatus(`${recovery.title}: ${recovery.detail}`)
        setStatus(recovery.status || 'Trip import failed')
      } else {
        setImportStatus(importErr?.status === 409
          ? 'Import stopped: conflicting saved history. No trips were saved; existing notes and tags are unchanged.'
          : 'Trip import failed.')
        setStatus('Trip import failed')
      }
    } finally {
      setIsImportingTrips(false)
    }
  }, [
    activeBindings,
    apiFetch,
    devices,
    exportDeviceId,
    exportEndDate,
    exportRangePreset,
    exportStartDate,
    settings.movementThresholdM,
    settings.vehicleApiBaseUrl,
    namedPlaces,
  ])

  const saveBindingAndRetryImport = useCallback(async () => {
    setImportStatus('Saving binding, then retrying import...')
    const saved = await saveBinding()
    if (!saved) {
      setImportStatus('Binding save failed. Check binding status in Settings and try again.')
      return
    }

    setIsSettingsOpen(false)
    setImportStatus('Binding saved. Retrying import...')
    await importTripsToBackend()
  }, [importTripsToBackend, saveBinding])

  const repairBindingAndRetryTrip = useCallback(async () => {
    if (!bindingRepairSuggestion || !importRecovery?.startedAt || !importRecovery?.endedAt) return
    setBindingRepairBusy(true)
    setBindingRepairStatus(`Assigning this trip window to ${bindingRepairSuggestion.vehicleDisplayName}...`)
    try {
      await repairMissingDeviceBinding(settings.vehicleApiBaseUrl, {
        bindingId: bindingRepairSuggestion.id,
        traccarDeviceId: importRecovery.traccarDeviceId,
        startedAt: importRecovery.startedAt,
        endedAt: importRecovery.endedAt,
      })
      await refreshBindingData()
      const tripDate = new Date(importRecovery.startedAt)
      const dayStart = new Date(tripDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(tripDate)
      dayEnd.setHours(23, 59, 59, 999)
      setBindingRepairStatus('Assignment repaired. Retrying this day...')
      setImportRecovery(null)
      setImportBindingHintDeviceId(null)
      await loadHistoryRange(dayStart, dayEnd, `day ${toDateInputValue(tripDate)}`, { pointOnly: true, merge: true })
    } catch (error) {
      setBindingRepairStatus(error instanceof Error ? error.message : 'Unable to repair this assignment.')
    } finally {
      setBindingRepairBusy(false)
    }
  }, [bindingRepairSuggestion, importRecovery, loadHistoryRange, refreshBindingData, settings.vehicleApiBaseUrl])

  const dismissImportRecovery = useCallback(() => {
    setImportRecovery(null)
    setImportBindingHintDeviceId(null)
    setBindingRepairSuggestion(null)
    setBindingRepairStatus('')
  }, [])

  const saveProfileEdits = useCallback(() => {
    const trimmedName = profileName.trim()
    if (!trimmedName) {
      setProfileEditorStatus('Profile name is required.')
      return
    }

    let parsedAttributes
    try {
      parsedAttributes = JSON.parse(profileAttributesJson)
    } catch {
      setProfileEditorStatus('Attribute JSON is invalid.')
      return
    }

    if (!parsedAttributes || typeof parsedAttributes !== 'object' || Array.isArray(parsedAttributes)) {
      setProfileEditorStatus('Attribute JSON must be an object.')
      return
    }
    const mappingError = validateAttributeMap(parsedAttributes)
    if (mappingError) {
      setProfileEditorStatus(mappingError)
      return
    }

    setProfileDefinitions((prev) => ({
      ...prev,
      [selectedProfileId]: {
        id: selectedProfileId,
        name: trimmedName,
        attributeMap: parsedAttributes,
      },
    }))

    setProfileEditorStatus('Profile saved.')
  }, [profileAttributesJson, profileName, selectedProfileId])

  const createProfileFromEditor = useCallback(() => {
    const baseName = profileName.trim() || 'New Profile'
    const slug = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'profile'

    let nextId = slug
    let suffix = 2
    while (profileDefinitions[nextId]) {
      nextId = `${slug}-${suffix}`
      suffix += 1
    }

    let parsedAttributes
    try {
      parsedAttributes = JSON.parse(profileAttributesJson)
    } catch {
      setProfileEditorStatus('Attribute JSON is invalid.')
      return
    }

    if (!parsedAttributes || typeof parsedAttributes !== 'object' || Array.isArray(parsedAttributes)) {
      setProfileEditorStatus('Attribute JSON must be an object.')
      return
    }
    const mappingError = validateAttributeMap(parsedAttributes)
    if (mappingError) {
      setProfileEditorStatus(mappingError)
      return
    }

    const nextName = `${baseName} Copy`

    setProfileDefinitions((prev) => ({
      ...prev,
      [nextId]: {
        id: nextId,
        name: nextName,
        attributeMap: parsedAttributes,
      },
    }))
    setSelectedProfileId(nextId)
    setProfileEditorStatus(`Created profile ${nextName}.`)
  }, [profileAttributesJson, profileDefinitions, profileName])

  const deleteSelectedProfile = useCallback(() => {
    if (selectedProfileId === DEFAULT_PROFILE_ID) {
      setProfileEditorStatus('Default profile cannot be deleted.')
      return
    }

    if (profileOptions.length <= 1) {
      setProfileEditorStatus('At least one profile must remain.')
      return
    }

    const fallback = profileOptions.find((profile) => profile.id !== selectedProfileId) || profileOptions[0]
    if (!fallback) {
      setProfileEditorStatus('No fallback profile available.')
      return
    }

    setProfileDefinitions((prev) => {
      const next = { ...prev }
      delete next[selectedProfileId]
      return next
    })

    setDeviceProfileById((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((deviceId) => {
        if (next[deviceId] === selectedProfileId) {
          next[deviceId] = fallback.id
        }
      })
      return next
    })

    setSelectedProfileId(fallback.id)
    setProfileEditorStatus('Profile deleted.')
  }, [profileOptions, selectedProfileId])

  const statusEligibleDeviceIds = useMemo(() => {
    const ids = new Set()
    devices.forEach((device) => {
      if (device?.appVehicleId) ids.add(Number(device.id))
    })
    bindingVehicles.forEach((vehicle) => {
      const id = Number(vehicle?.traccarDeviceId)
      if (Number.isFinite(id) && id > 0) ids.add(id)
    })
    historyDayRows.forEach((row) => {
      const id = Number(row?.traccarDeviceId)
      if (Number.isFinite(id) && id > 0) ids.add(id)
    })
    return ids
  }, [bindingVehicles, devices, historyDayRows])

  const statusEligibleDevices = useMemo(
    () => devices.filter((device) => statusEligibleDeviceIds.has(Number(device.id))),
    [devices, statusEligibleDeviceIds],
  )

  useEffect(() => {
    if (statusDeviceId != null && statusEligibleDeviceIds.has(Number(statusDeviceId))) {
      return
    }
    const fallbackId = statusEligibleDevices[0]?.id ?? null
    if (fallbackId !== statusDeviceId) {
      setStatusDeviceId(fallbackId)
    }
  }, [statusDeviceId, statusEligibleDeviceIds, statusEligibleDevices])

  const firstCatalogVehicle = bindingVehicles.find((vehicle) => statusEligibleDeviceIds.has(Number(vehicle.traccarDeviceId)))
  const firstCatalogDevice = firstCatalogVehicle?.traccarDeviceId == null
    ? null
    : statusEligibleDevices.find((device) => Number(device.id) === Number(firstCatalogVehicle.traccarDeviceId))
  const statusDevice = statusEligibleDevices.find((device) => device.id === statusDeviceId)
    || statusEligibleDevices.find((device) => device.id === selectedTrip?.deviceId)
    || firstCatalogDevice
    || statusEligibleDevices[0]
    || null
  const statusPoint = selectedMapPoint && selectedMapPoint.deviceId === statusDevice?.id
    ? selectedMapPoint.point
    : (statusDevice ? (historyByDevice[statusDevice.id] || []).at(-1) : null)
  const statusVehicleId = statusDevice?.appVehicleId || bindingVehicles.find((vehicle) => vehicle.traccarDeviceId === statusDevice?.id)?.id
  const activeSpeedBands = speedBandsForVehicle(selectedTripVehicleId)
  const graphProfile = profileMap[deviceProfileById[selectedTrip?.deviceId || statusDevice?.id] || DEFAULT_PROFILE_ID]

  if (vehicleAuth.checking) {
    return <main className="auth-screen"><div className="auth-card"><h1>Traccar React</h1><p>Checking application access…</p></div></main>
  }

  if (vehicleAuth.enabled && !vehicleAuth.authenticated) {
    return <main className="auth-screen"><form className="auth-card" onSubmit={submitVehicleLogin}><h1>Traccar React</h1><p>Sign in to VehicleApp.</p><label>Username<input autoComplete="username" value={vehicleLoginUsername} onChange={(event) => setVehicleLoginUsername(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" value={vehicleLoginPassword} onChange={(event) => setVehicleLoginPassword(event.target.value)} /></label>{vehicleLoginError && <div className="trip-empty">{vehicleLoginError}</div>}<button type="submit">Sign in</button></form></main>
  }

  return (
    <main className="app-shell">
      <aside className="control-panel">
        <div className="panel-header">
          <div>
            <h1>Traccar React</h1>
          </div>
          <button
            type="button"
            className="small secondary settings-button"
            onClick={() => setIsSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
              <path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3H3.7a1.8 1.8 0 0 1 0-3h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3h-.2a1.8 1.8 0 0 0-.9 3Z" />
            </svg>
          </button>
          {vehicleAuth.enabled && <button type="button" className="small secondary" onClick={logoutVehicleSession}>Sign out</button>}
          <button
            type="button"
            className="small secondary transfer-button"
            title="Import/Export data"
            aria-label="Import/Export data"
            onClick={() => setIsDataTransferOpen(true)}
          >
            ⇅
          </button>
        </div>

        {importRecovery && (
          <section className="import-conflict-badge" role="status" aria-live="polite">
            <div className="import-conflict-badge-header">
              <strong>Trip Sync Needs Attention</strong>
              <span>HTTP 409</span>
            </div>
            <div className="import-conflict-badge-body">{importRecovery.title}</div>
            <div className="import-conflict-badge-detail">{importRecovery.detail}</div>
            <div className="import-conflict-badge-facts">
              {importRecovery.code && <div>Cause: {importRecovery.code}</div>}
              {importRecovery.traccarDeviceId && <div>Device ID: {importRecovery.traccarDeviceId}</div>}
              {(importRecovery.startedAtLabel || importRecovery.endedAtLabel) && (
                <div>
                  Incoming Window: {importRecovery.startedAtLabel || '?'} to {importRecovery.endedAtLabel || '?'}
                </div>
              )}
              {importRecovery.incomingSourceIdsLabel && <div>Incoming Source IDs: {importRecovery.incomingSourceIdsLabel}</div>}
              {bindingRepairSuggestion && <>
                <div>Suggested Vehicle: {bindingRepairSuggestion.vehicleDisplayName}</div>
                <div>Nearest Assignment: {new Date(bindingRepairSuggestion.startsAt).toLocaleString()} to {bindingRepairSuggestion.endsAt ? new Date(bindingRepairSuggestion.endsAt).toLocaleString() : 'present'} ({Math.round(Number(bindingRepairSuggestion.distanceSeconds || 0) / 86400)} days away)</div>
              </>}
              {(importRecovery.firstConflictingTrip?.startedAtLabel || importRecovery.firstConflictingTrip?.endedAtLabel) && (
                <div>
                  Saved Window ({importRecovery.firstConflictingTrip?.idShort || 'trip'}): {importRecovery.firstConflictingTrip?.startedAtLabel || '?'} to {importRecovery.firstConflictingTrip?.endedAtLabel || '?'}
                </div>
              )}
              {importRecovery.firstConflictingTrip?.sourceIdsLabel && (
                <div>Saved Source IDs: {importRecovery.firstConflictingTrip.sourceIdsLabel}</div>
              )}
              {Array.isArray(importRecovery.conflictingTripIdsShort) && importRecovery.conflictingTripIdsShort.length > 0 && (
                <div>
                  Conflicting Trip IDs: {importRecovery.conflictingTripIdsShort.slice(0, 3).join(', ')}
                  {importRecovery.conflictingTripIdsShort.length > 3 ? ` (+${importRecovery.conflictingTripIdsShort.length - 3} more)` : ''}
                </div>
              )}
            </div>
            {importRecovery.steps?.[0] && <div className="import-conflict-badge-hint">Next: {importRecovery.steps[0]}</div>}
            {bindingRepairStatus && <div className="import-conflict-badge-hint">{bindingRepairStatus}</div>}
            <div className="import-conflict-badge-actions">
              {bindingRepairSuggestion && <button type="button" className="small" onClick={repairBindingAndRetryTrip} disabled={bindingRepairBusy}>
                {bindingRepairBusy ? 'Repairing...' : `Assign to ${bindingRepairSuggestion.vehicleDisplayName} and Retry`}
              </button>}
              <button type="button" className="small secondary" onClick={() => { localStorage.setItem('openVehicleCatalogPanel', 'true'); setIsSettingsOpen(true) }}>
                Open Vehicle Catalog
              </button>
              <button type="button" className="small" onClick={dismissImportRecovery}>
                Dismiss
              </button>
            </div>
          </section>
        )}

        <DeviceList
          devices={devices}
          deviceVisibility={deviceVisibility}
          setDeviceVisibility={setDeviceVisibility}
          deviceColors={deviceColors}
          selectedDeviceId={deviceListSelectedId}
          onSelectDevice={setDeviceListSelectedId}
        />

        <div ref={tripFlyoutRefs.setReference} className="history-trips-row">
        <HistoryNavigator
          daySummaries={daySummaries}
          monthKeys={historyMonthKeys}
          monthSummaryByKey={historyMonthSummaryByKey}
          monthLoadState={historyMonthLoadState}
          selectedDayKey={selectedDayKey}
          selectedDayKeys={selectedDayKeys}
          setSelectedDayKey={selectDay}
          refreshHistory={applyTimeRange}
          loadMonth={loadHistoryMonth}
          onReportDays={openSelectedDaysGraph}
        />
        {!showTripsPanel && (selectedDayKey || selectedDayKeys.length > 0) && <button
          type="button"
          className="small secondary trip-panel-show-button"
          onClick={() => setShowTripsPanel(true)}
          title="Show Trips panel"
        >Show Trips</button>}

        {showTripsPanel && createPortal(<TripPanel
          floatingRef={tripFlyoutRefs.setFloating}
          style={tripFlyoutPosition
            ? { position: 'fixed', left: `${tripFlyoutPosition.left}px`, top: `${tripFlyoutPosition.top}px` }
            : tripFlyoutStyles}
          position={tripFlyoutPosition}
          onPositionChange={setTripFlyoutPosition}
          onPositionCommit={persistTripFlyoutPosition}
          onHide={() => setShowTripsPanel(false)}
          visibleTrips={visibleTrips}
          selectedDayKey={selectedDayKey}
          devices={devices}
          selectedTripId={selectedTripId}
          focusTrip={focusTrip}
          selectedTrip={selectedTrip}
          selectedTripMaxSpeedMph={selectedTripMaxSpeedMph}
          tripEditorLoading={tripEditorLoading}
          tripEditorDisabled={!selectedBackendTripId || tripEditorLoading || tripEditorBusy}
          tripEditorStatus={tripEditorStatus}
          tripEditorTags={tripEditorTags}
          selectedTripEvents={selectedTripEvents}
          focusTripEvent={focusTripEvent}
          availableTripTags={tripEditorAvailableTags}
          tagToAdd={tagToAdd}
          setTagToAdd={setTagToAdd}
          addSelectedTripTag={addSelectedTripTag}
          removeSelectedTripTag={removeSelectedTripTag}
          noteDraft={tripNoteDraft}
          setNoteDraft={setTripNoteDraft}
          saveSelectedTripNote={saveSelectedTripNote}
          openTripGraph={openTripGraph}
        />, document.body)}
        </div>
        <NotificationsPanel notifications={notifications} loading={notificationsLoading} rangeLabel={notificationsRangeLabel} />

        <StatusCard
          status={status}
          sessionState={sessionState}
          error={error}
        />
      </aside>

      <section className={`map-panel${isPickingLocation ? ' map-location-picker' : ''}`}>
        <VehicleStatusCard
          style={vehicleStatusPosition
            ? { position: 'fixed', left: `${vehicleStatusPosition.left}px`, top: `${vehicleStatusPosition.top}px`, right: 'auto' }
            : undefined}
          position={vehicleStatusPosition}
          onPositionChange={setVehicleStatusPosition}
          onPositionCommit={persistVehicleStatusPosition}
          device={statusDevice}
          point={statusPoint}
          historyPoints={statusDevice ? (historyByDevice[statusDevice.id] || []) : []}
          profile={statusDevice ? profileMap[deviceProfileById[statusDevice.id] || DEFAULT_PROFILE_ID] : null}
          cardFields={statusCardFieldsByVehicle[statusVehicleId] || DEFAULT_STATUS_CARD_FIELDS}
        />
        <VehicleStatsPanel baseUrl={settings.vehicleApiBaseUrl} vehicleId={statusVehicleId || null} traccarApi={apiFetch} />
        <div ref={mapElementRef} className="map-canvas" />
        <div
          className="speed-band-key"
          aria-label="Speed bands"
          title="Double-click to edit speed bands"
          onDoubleClick={() => { localStorage.setItem('openSpeedBandsPanel', 'true'); setIsSettingsOpen(true) }}
        >
          <strong>Speed bands</strong>
          <small>Double-click to edit</small>
          {activeSpeedBands.map((band, index) => <span key={`${band.label}-${index}`}><i style={{ backgroundColor: band.color }} />{band.upperMph == null ? `${index ? activeSpeedBands[index - 1].upperMph : 0}+ mph` : `${index ? activeSpeedBands[index - 1].upperMph : 0}–${band.upperMph} mph`}</span>)}
        </div>
      </section>

      {isSettingsOpen && (
        <SettingsModal
          isPickingLocation={isPickingLocation}
          startLocationPicker={startLocationPicker}
          settings={settings}
          vehicleApiBaseUrl={settings.vehicleApiBaseUrl}
          updateSetting={updateSetting}
          closeModal={() => setIsSettingsOpen(false)}
          refreshDevices={loadDevices}
          profileOptions={profileOptions}
          selectedProfileId={selectedProfileId}
          setSelectedProfileId={setSelectedProfileId}
          profileName={profileName}
          setProfileName={setProfileName}
          profileAttributesJson={profileAttributesJson}
          setProfileAttributesJson={setProfileAttributesJson}
          profileEditorStatus={profileEditorStatus}
          saveProfileEdits={saveProfileEdits}
          createProfileFromEditor={createProfileFromEditor}
          deleteSelectedProfile={deleteSelectedProfile}
          bindingDevices={devices}
          bindingVehicles={bindingVehicles}
          vehicleEditId={vehicleEditId}
          selectVehicleForEdit={selectVehicleForEdit}
          vehicleName={vehicleName}
          setVehicleName={setVehicleName}
          vehicleVin={vehicleVin}
          setVehicleVin={setVehicleVin}
          vehicleYear={vehicleYear}
          setVehicleYear={setVehicleYear}
          vehicleMake={vehicleMake}
          setVehicleMake={setVehicleMake}
          vehicleModel={vehicleModel}
          setVehicleModel={setVehicleModel}
          vehicleNotes={vehicleNotes}
          setVehicleNotes={setVehicleNotes}
          vehicleProfileId={vehicleProfileId}
          setVehicleProfileId={setVehicleProfileId}
          vehicleDeviceId={vehicleDeviceId}
          setVehicleDeviceId={setVehicleDeviceId}
          vehicleEffectiveFrom={vehicleEffectiveFrom}
          setVehicleEffectiveFrom={setVehicleEffectiveFrom}
          vehicleEditorStatus={vehicleEditorStatus}
          saveVehicle={saveVehicle}
          statusCardFieldsByVehicle={statusCardFieldsByVehicle}
          saveStatusCardFields={saveStatusCardFields}
          filterBindingsToSelectedDevice={filterBindingsToSelectedDevice}
          setFilterBindingsToSelectedDevice={setFilterBindingsToSelectedDevice}
          bindingDeviceId={bindingDeviceId}
          setBindingDeviceId={setBindingDeviceId}
          bindingVehicleId={bindingVehicleId}
          setBindingVehicleId={setBindingVehicleId}
          bindingEffectiveFrom={bindingEffectiveFrom}
          setBindingEffectiveFrom={setBindingEffectiveFrom}
          bindingStatus={bindingStatus}
          activeBindings={activeBindings}
          isBindingBusy={isBindingBusy}
          refreshBindings={refreshBindingData}
          saveBinding={saveBinding}
          deleteBindingById={deleteBindingById}
          saveBindingAndRetryImport={saveBindingAndRetryImport}
          showRetryAction={Boolean(importBindingHintDeviceId)}
          importRecovery={importRecovery}
          clearImportRecovery={dismissImportRecovery}
          enrichmentStatus={enrichmentStatus}
          namedPlaces={namedPlaces}
          placeVehicleId={placeVehicleId}
          setPlaceVehicleId={setPlaceVehicleId}
          placeName={placeName}
          placeEditId={placeEditId}
          beginEditNamedPlace={beginEditNamedPlace}
          cancelEditNamedPlace={cancelEditNamedPlace}
          setPlaceName={setPlaceName}
          placeLatitude={placeLatitude}
          setPlaceLatitude={setPlaceLatitude}
          placeLongitude={placeLongitude}
          setPlaceLongitude={setPlaceLongitude}
          placeRadiusYards={placeRadiusYards}
          setPlaceRadiusYards={setPlaceRadiusYards}
          placeNotes={placeNotes}
          setPlaceNotes={setPlaceNotes}
          saveNamedPlace={saveNamedPlace}
          deleteNamedPlaceById={deleteNamedPlaceById}
          tripTags={tripTags}
          tagVehicleId={tagVehicleId}
          setTagVehicleId={setTagVehicleId}
          tagName={tagName}
          setTagName={setTagName}
          tagColor={tagColor}
          setTagColor={setTagColor}
          saveTripTag={saveTripTag}
          deleteTripTagById={deleteTripTagById}
          bouncieClientId={bouncieClientId}
          setBouncieClientId={setBouncieClientId}
          bouncieClientSecret={bouncieClientSecret}
          setBouncieClientSecret={setBouncieClientSecret}
          bouncieRedirectUri={bouncieRedirectUri}
          setBouncieRedirectUri={setBouncieRedirectUri}
          bouncieAuthorizationUrl={bouncieAuthorizationUrl}
          bouncieImportFrom={bouncieImportFrom}
          setBouncieImportFrom={setBouncieImportFrom}
          bouncieImportThrough={bouncieImportThrough}
          setBouncieImportThrough={setBouncieImportThrough}
          bouncieStatus={bouncieStatus}
          bouncieCoverage={bouncieCoverage}
          bouncieBusy={bouncieBusy}
          connectBouncie={connectBouncieAccount}
          startBouncieImport={startBouncieSync}
          cancelBouncieImport={cancelBouncieSync}
          forgetBouncieCredentials={forgetBouncieConnection}
          restoreBouncieConnection={restoreBouncieStoredConnection}
          vehicleAuth={vehicleAuth}
        />
      )}

      {isDataTransferOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsDataTransferOpen(false)
        }}>
          <div className="data-transfer-modal" role="dialog" aria-modal="true" aria-label="Import and export data">
            <div className="modal-header">
              <h2>Import / Export Data</h2>
              <button type="button" className="small secondary" onClick={() => setIsDataTransferOpen(false)} aria-label="Close">×</button>
            </div>
            <ExportPanel
              devices={devices}
              exportDeviceId={exportDeviceId}
              setExportDeviceId={setExportDeviceId}
              exportRangePreset={exportRangePreset}
              setExportRangePreset={setExportRangePreset}
              exportStartDate={exportStartDate}
              setExportStartDate={setExportStartDate}
              exportEndDate={exportEndDate}
              setExportEndDate={setExportEndDate}
              exportHeaderMode={exportHeaderMode}
              setExportHeaderMode={setExportHeaderMode}
              exportRangeData={exportRangeData}
              exportMessage={exportMessage}
              importDataFile={importDataFile}
              dataImportMessage={dataImportMessage}
            />
            <section className="operations-report-card">
              <h3>Admin / Operations Reports</h3>
              <div className="operations-report-buttons">
                {['daily', 'growth', 'maintenance', 'retention-preview'].map((report) => (
                  <button key={report} type="button" className={`small secondary report-button${operationsReport?.report === report ? ' active' : ''}`} disabled={operationsReportBusy} onClick={() => runOperationsReport(report)}>
                    {report === 'retention-preview' ? 'Retention Preview' : `${report[0].toUpperCase()}${report.slice(1)} Report`}
                  </button>
                ))}
              </div>
              {operationsReport && (
                <div className="operations-report-output">
                  <div className="operations-report-toolbar">
                    <strong>{operationsReport.report === 'retention-preview' ? 'Retention Preview' : `${operationsReport.report[0].toUpperCase()}${operationsReport.report.slice(1)} Report`}</strong>
                    <span>Generated {new Date(operationsReport.generatedAtUtc).toLocaleString()}</span>
                    <button type="button" className="small secondary" onClick={downloadOperationsReport}>Download JSON</button>
                  </div>
                  <table className="operations-report-table">
                    <thead><tr>{Object.keys(operationsReport.rows?.[0] || {}).map((key) => <th key={key}>{key.replaceAll('_', ' ')}</th>)}</tr></thead>
                    <tbody>{(operationsReport.rows || []).map((row, rowIndex) => (
                      <tr key={rowIndex}>{Object.entries(row).map(([key, value]) => <td key={key}>{value == null ? '—' : typeof value === 'number' ? value.toLocaleString() : String(value)}</td>)}</tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {graphGroups && <TelemetryGraphViewer groups={graphGroups} profile={graphProfile} title={graphGroups.length === 1 ? 'Trip Telemetry Graph' : 'Selected Days Telemetry Graph'} onClose={() => setGraphGroups(null)} />}
    </main>
  )
}

export default App

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import BottomSheet from './BottomSheet'
import DesktopPanels from './DesktopPanels'
import MapOverlay from './MapOverlay'
import MobileNavigation from './MobileNavigation'
import MobileTopBar from './MobileTopBar'
import TaskDialog from './TaskDialog'
import LayoutDiagnostics from './LayoutDiagnostics'

const desktopQuery = '(min-width: 64rem)'

function AppLayout({
  map,
  mapOverlay,
  mapPicking = false,
  deviceName,
  connectionState,
  announcement = '',
  devices,
  trips,
  tripEditor,
  hasNotifications = false,
  onNotificationsClick,
  status,
  more,
  accountControls,
  desktopContent,
  task,
  onTaskClose,
  onCompactChange,
  layoutActionsRef,
}) {
  const [isCompact, setIsCompact] = useState(() => !window.matchMedia(desktopQuery).matches)
  const [activePanel, setActivePanel] = useState('status')
  const [diagnosticFlow, setDiagnosticFlow] = useState(false)
  const [sheetSize, setSheetSize] = useState('peek')
  const [tripEditorOpen, setTripEditorOpen] = useState(false)
  const mapAreaRef = useRef(null)
  const mapButtonRef = useRef(null)
  const tripEditorButtonRef = useRef(null)
  const cancelLocationRef = useRef(null)
  const visibleSheetSize = mapPicking ? 'peek' : sheetSize

  useEffect(() => {
    if (mapPicking && isCompact) cancelLocationRef.current?.focus()
  }, [mapPicking, isCompact])

  useEffect(() => {
    if (!tripEditor) setTripEditorOpen(false)
  }, [tripEditor])

  useEffect(() => {
    if (!tripEditorOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setTripEditorOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [tripEditorOpen])

  useLayoutEffect(() => {
    const media = window.matchMedia(desktopQuery)
    const updateLayout = () => {
      setIsCompact(!media.matches)
      onCompactChange?.(!media.matches)
    }
    media.addEventListener('change', updateLayout)
    onCompactChange?.(!media.matches)
    if (layoutActionsRef) {
      layoutActionsRef.current = {
        focus: () => {
          const target = mapButtonRef.current || mapAreaRef.current?.querySelector('.map-action-settings')
          target?.focus({ preventScroll: true })
        },
        openDeviceStatus: () => {
          setActivePanel('status')
          setSheetSize('half')
        },
      }
    }
    return () => {
      media.removeEventListener('change', updateLayout)
      if (layoutActionsRef) layoutActionsRef.current = null
    }
  }, [layoutActionsRef, onCompactChange])

  useEffect(() => {
    if (sheetSize === 'full' && mapAreaRef.current?.contains(document.activeElement)) {
      mapButtonRef.current?.focus()
    }
  }, [sheetSize])

  const changeSheetSize = (size) => {
    if (size !== 'peek' && size !== 'half' && size !== 'full') return
    if (size === 'full' && mapAreaRef.current?.contains(document.activeElement)) {
      mapButtonRef.current?.focus()
    }
    setSheetSize(size)
  }

  const selectPanel = (panel) => {
    setActivePanel(panel)
    setSheetSize(panel === 'status' ? 'peek' : 'half')
  }

  const returnToMap = () => {
    mapButtonRef.current?.focus()
    selectPanel('status')
  }

  const returnToDeviceStatus = () => {
    mapButtonRef.current?.focus()
    setActivePanel('status')
    setSheetSize('peek')
  }

  const selectedTitle = {
    status: deviceName || 'Status',
    devices: 'Devices',
    trips: 'Trips',
    more: 'More',
  }[activePanel]

  const selectedSummary = activePanel === 'status'
    ? 'Current device status'
    : activePanel === 'devices'
      ? 'Choose a device to see its status.'
      : activePanel === 'trips'
        ? 'Choose a day or trip to review its history.'
        : 'Settings and additional tools'

  return (
    <div className="scope-layout" data-debug-flow={import.meta.env.DEV && diagnosticFlow || undefined} data-sheet-size={visibleSheetSize} data-location-picker={mapPicking || undefined}>
      <div className="scope-announcement" role="status" aria-atomic="true">{announcement}</div>
      {import.meta.env.DEV && new URLSearchParams(window.location.search).has('layoutDebug') && <LayoutDiagnostics flow={diagnosticFlow} onFlowChange={setDiagnosticFlow} />}
      {isCompact && (
        <MobileTopBar deviceName={deviceName} connectionState={connectionState} onOpenDevices={() => selectPanel('devices')} accountControls={accountControls} />
      )}
      <div className="scope-workspace">
        {isCompact && mapPicking && <div className="scope-location-picker-bar" role="group" aria-label="Location picking">
          <span role="status">Tap the map to choose a location.</span>
          <button ref={cancelLocationRef} type="button" className="secondary" onClick={mapOverlay?.onCancelLocation}>Cancel location</button>
        </div>}
        <div ref={mapAreaRef} className="scope-map-area" data-location-picker={mapPicking || undefined} inert={isCompact && !mapPicking && sheetSize === 'full'}>
          {map}
          {isCompact && <MapOverlay {...mapOverlay} isPickingLocation={mapPicking} />}
          {isCompact && hasNotifications && !mapPicking && <button type="button" className="scope-map-notifications" onClick={onNotificationsClick} aria-label="Open notifications" title="Notifications">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          </button>}
          {isCompact && tripEditor && !mapPicking && <button ref={tripEditorButtonRef} type="button" className="scope-map-edit-trip" onClick={() => setTripEditorOpen(true)} aria-label="Edit selected trip" title="Edit selected trip">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
          </button>}
        </div>
        {isCompact && <BottomSheet panel={activePanel} size={sheetSize} title={selectedTitle} summary={selectedSummary} onSizeChange={changeSheetSize} onMap={returnToMap}>
          {({ tripsActionsTarget }) => <>
          {activePanel === 'devices' && devices && devices({ onDeviceSelected: () => {
            returnToDeviceStatus()
          } })}
          {activePanel === 'trips' && trips && trips({ compactHeaderActionsTarget: tripsActionsTarget, onTripSelected: () => {
            setActivePanel('trips')
            setSheetSize('half')
          } })}
          {activePanel === 'status' && status}
          {activePanel === 'more' && more}
          </>}
        </BottomSheet>}
      </div>
      {isCompact && tripEditorOpen && tripEditor && <div className="scope-trip-editor-backdrop">
        <section className="scope-trip-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="scope-trip-editor-title">
          <header><h2 id="scope-trip-editor-title">Edit trip</h2><button type="button" className="small secondary" onClick={() => { setTripEditorOpen(false); tripEditorButtonRef.current?.focus() }}>Close</button></header>
          {tripEditor}
        </section>
      </div>}
      {isCompact && <MobileNavigation activePanel={sheetSize === 'peek' ? 'status' : activePanel === 'status' ? 'more' : activePanel} onSelect={selectPanel} mapButtonRef={mapButtonRef} />}
      <DesktopPanels>{desktopContent}</DesktopPanels>
      <TaskDialog wide={task?.wide} open={Boolean(task) && !mapPicking && (isCompact || task.desktop)} title={task?.title || ''} onClose={onTaskClose} fallbackFocusRef={mapButtonRef}>{(isCompact || task?.desktop) ? task?.content : null}</TaskDialog>
    </div>
  )
}

export default AppLayout

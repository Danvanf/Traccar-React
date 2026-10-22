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
  pointTimestamp,
  announcement = '',
  devices,
  trips,
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
  const mapAreaRef = useRef(null)
  const mapButtonRef = useRef(null)
  const cancelLocationRef = useRef(null)
  const visibleSheetSize = mapPicking ? 'peek' : sheetSize

  useEffect(() => {
    if (mapPicking && isCompact) cancelLocationRef.current?.focus()
  }, [mapPicking, isCompact])

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
        <MobileTopBar deviceName={deviceName} connectionState={connectionState} pointTimestamp={pointTimestamp} onOpenDevices={() => selectPanel('devices')} accountControls={accountControls} />
      )}
      <div className="scope-workspace">
        {isCompact && mapPicking && <div className="scope-location-picker-bar" role="group" aria-label="Location picking">
          <span role="status">Tap the map to choose a location.</span>
          <button ref={cancelLocationRef} type="button" className="secondary" onClick={mapOverlay?.onCancelLocation}>Cancel location</button>
        </div>}
        <div ref={mapAreaRef} className="scope-map-area" data-location-picker={mapPicking || undefined} inert={isCompact && !mapPicking && sheetSize === 'full'}>
          {map}
          {isCompact && <MapOverlay {...mapOverlay} isPickingLocation={mapPicking} />}
        </div>
        {isCompact && <BottomSheet panel={activePanel} size={sheetSize} title={selectedTitle} summary={selectedSummary} onSizeChange={changeSheetSize} onMap={returnToMap}>
          {activePanel === 'devices' && devices && devices({ onDeviceSelected: () => {
            returnToDeviceStatus()
          } })}
          {activePanel === 'trips' && trips && trips({ onTripSelected: () => {
            setActivePanel('trips')
            setSheetSize('half')
          } })}
          {activePanel === 'status' && status}
          {activePanel === 'more' && more}
        </BottomSheet>}
      </div>
      {isCompact && <MobileNavigation activePanel={sheetSize === 'peek' ? 'status' : activePanel === 'status' ? 'more' : activePanel} onSelect={selectPanel} mapButtonRef={mapButtonRef} />}
      <DesktopPanels>{desktopContent}</DesktopPanels>
      <TaskDialog wide={task?.wide} open={Boolean(task) && !mapPicking && (isCompact || task.desktop)} title={task?.title || ''} onClose={onTaskClose} fallbackFocusRef={mapButtonRef}>{(isCompact || task?.desktop) ? task?.content : null}</TaskDialog>
    </div>
  )
}

export default AppLayout

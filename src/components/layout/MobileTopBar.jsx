function MobileTopBar({ deviceName, connectionState = 'unknown', onOpenDevices, accountControls }) {
  return (
    <header className="scope-topbar">
      <button type="button" className="scope-topbar-title" onClick={onOpenDevices}>
        <span className="scope-topbar-product">Traccar Scope</span>
        <strong title={deviceName || 'Choose a device'}>{deviceName || 'Choose a device'}</strong>
      </button>
      <span className="scope-visually-hidden" role="status" aria-live="polite" aria-atomic="true">Traccar API: {connectionState}</span>
      {accountControls}
    </header>
  )
}

export default MobileTopBar

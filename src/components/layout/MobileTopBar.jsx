function MobileTopBar({ deviceName, connectionState = 'unknown', pointTimestamp, onOpenDevices, accountControls }) {
  const timestamp = pointTimestamp instanceof Date ? pointTimestamp : null
  const hasTimestamp = timestamp && Number.isFinite(timestamp.getTime())
  return (
    <header className="scope-topbar">
      <button type="button" className="scope-topbar-title" onClick={onOpenDevices}>
        <span className="scope-topbar-product">Traccar Scope</span>
        <strong title={deviceName || 'Choose a device'}>{deviceName || 'Choose a device'}</strong>
        <span className="scope-topbar-status">Traccar API: {connectionState}</span>
        <span className="scope-topbar-status">{hasTimestamp
          ? <>Point: <time dateTime={timestamp.toISOString()}>{timestamp.toLocaleString()}</time></>
          : 'No point loaded'}</span>
      </button>
      <span className="scope-visually-hidden" role="status" aria-live="polite" aria-atomic="true">Traccar API: {connectionState}</span>
      {accountControls}
    </header>
  )
}

export default MobileTopBar
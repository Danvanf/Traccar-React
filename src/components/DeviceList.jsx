function DeviceList({
  devices,
  deviceVisibility,
  setDeviceVisibility,
  deviceColors,
  selectedDeviceId,
  onSelectDevice,
  expanded,
  onExpandedChange,
  showVisibilityControls = true,
}) {
  const selectedDevices = devices.filter((device) => deviceVisibility[device.id] !== false)
  const selectionLabel = selectedDevices.length < 3
    ? (selectedDevices.length === 0 ? 'none selected' : `${selectedDevices.map((device) => device.name).join(', ')} selected`)
    : `${selectedDevices.length} selected`
  return (
    <details className="device-list" open={expanded} onToggle={(event) => onExpandedChange(event.currentTarget.open)}>
      <summary>Devices ({devices.length}{showVisibilityControls ? `, ${selectionLabel}` : ''})</summary>
      <ul>
        {devices.map((device) => (
          <li key={device.id} className={selectedDeviceId === device.id ? 'selected-device' : ''}>
            {showVisibilityControls ? <label className="checkbox-row">
              <input
                type="checkbox"
                aria-label={`Show ${device.name} on map`}
                checked={deviceVisibility[device.id] !== false}
                onChange={(event) => {
                  const checked = event.target.checked
                  setDeviceVisibility((prev) => ({ ...prev, [device.id]: checked }))
                }}
              />
              <span className="color-dot" style={{ background: deviceColors[device.id] || '#777' }} />
            </label> : <span className="color-dot" aria-hidden="true" style={{ background: deviceColors[device.id] || '#777' }} />}
            <button
              type="button"
              className="device-list-select"
              aria-pressed={selectedDeviceId === device.id}
              onClick={() => onSelectDevice(device.id)}
            >
              {device.name}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

export default DeviceList

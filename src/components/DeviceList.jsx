import { useState } from 'react'

function DeviceList({
  devices,
  deviceVisibility,
  setDeviceVisibility,
  deviceColors,
  statusDeviceId,
  onSelectDevice,
}) {
  const [expanded, setExpanded] = useState(true)
  const selectedDevices = devices.filter((device) => deviceVisibility[device.id] !== false)
  const selectionLabel = selectedDevices.length < 3
    ? (selectedDevices.length === 0 ? 'none selected' : `${selectedDevices.map((device) => device.name).join(', ')} selected`)
    : `${selectedDevices.length} selected`
  return (
    <details className="device-list" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>Devices ({devices.length}, {selectionLabel})</summary>
      <ul>
        {devices.map((device) => (
          <li key={device.id} className={statusDeviceId === device.id ? 'selected-device' : ''} onClick={() => onSelectDevice(device.id)}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={deviceVisibility[device.id] !== false}
                onChange={(event) => {
                  const checked = event.target.checked
                  setDeviceVisibility((prev) => ({ ...prev, [device.id]: checked }))
                }}
              />
              <span className="color-dot" style={{ background: deviceColors[device.id] || '#777' }} />
              <span>{device.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  )
}

export default DeviceList

function ExportPanel({
  devices,
  exportDeviceId,
  setExportDeviceId,
  exportRangePreset,
  setExportRangePreset,
  exportStartDate,
  setExportStartDate,
  exportEndDate,
  setExportEndDate,
  exportHeaderMode,
  setExportHeaderMode,
  exportRangeData,
  exportMessage,
  importDataFile,
  dataImportMessage,
}) {
  return (
    <div className="export-panel">
      <h2>Import / Export Data</h2>
      <label>
        Device
        <select
          value={exportDeviceId || ''}
          onChange={(event) => setExportDeviceId(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">Select device</option>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>{device.name}</option>
          ))}
        </select>
      </label>
      <div className="export-hint">Export raw Traccar positions for spreadsheet analysis.</div>

      <label>
        Attribute Headers
        <select value={exportHeaderMode} onChange={(event) => setExportHeaderMode(event.target.value)}>
          <option value="translated">Human-readable labels (with Teltonika ID)</option>
          <option value="teltonika">Teltonika attribute IDs</option>
        </select>
      </label>

      <label>
        Range Preset
        <select value={exportRangePreset} onChange={(event) => setExportRangePreset(event.target.value)}>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="year">This Year</option>
          <option value="all">All Time</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      {exportRangePreset === 'custom' && (
        <div className="export-custom-range">
          <label>
            Start Date
            <input type="date" value={exportStartDate} onChange={(event) => setExportStartDate(event.target.value)} />
          </label>
          <label>
            End Date
            <input type="date" value={exportEndDate} onChange={(event) => setExportEndDate(event.target.value)} />
          </label>
        </div>
      )}

      <button type="button" className="secondary" onClick={exportRangeData}>
        Export All Data In Range (CSV)
      </button>
      <div className="export-output" role="status" aria-live="polite">
        {exportMessage || 'Export results will appear here.'}
      </div>
      <hr />
      <h3>Restore CSV Data</h3>
      <div className="export-hint">Choose a Bouncie trip export or a Traccar React position export. The format is detected from its headers. Traccar React exports restore raw positions to the selected device and rebuild duplicate-safe trips; notes, tags, and events remain server-side.</div>
      <input type="file" accept=".csv,text/csv" onChange={(event) => importDataFile(event.target.files?.[0] || null)} />
      <div className="export-output" role="status" aria-live="polite">{dataImportMessage || 'Restore results will appear here.'}</div>
    </div>
  )
}

export default ExportPanel

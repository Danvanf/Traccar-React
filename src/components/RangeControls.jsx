function RangeControls({
  timeMode,
  setTimeMode,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  applyTimeRange,
  testApi,
}) {
  return (
    <div className="range-controls">
      <label>
        Time Range
        <select value={timeMode} onChange={(event) => setTimeMode(event.target.value)}>
          <option value="realtime">Real Time</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">Last 7 Days</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      {timeMode === 'custom' && (
        <>
          <label>
            From
            <input type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
          </label>
        </>
      )}

      <div className="actions two-up">
        <button type="button" onClick={applyTimeRange}>Load Range</button>
        <button type="button" className="secondary" onClick={testApi}>Test API</button>
      </div>
    </div>
  )
}

export default RangeControls

function MapOverlay({ onZoomIn, onZoomOut, onFit, isAutoFitPaused, isPickingLocation = false }) {
  const fitLabel = isAutoFitPaused ? 'Resume map follow' : 'Fit visible devices'
  return (
    <div className="scope-map-overlay" role="group" aria-label="Map controls">
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">+</button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">−</button>
      <button type="button" onClick={onFit} disabled={isPickingLocation} aria-label={fitLabel} title={fitLabel}>
        <svg className="scope-map-action-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          {isAutoFitPaused
            ? <path d="m8 5 11 7-11 7Z" />
            : <><path d="M8 3H3v5m13-5h5v5m0 8v5h-5M3 16v5h5" /><circle cx="12" cy="12" r="3" /></>}
        </svg>
      </button>
    </div>
  )
}

export default MapOverlay
import { useState } from 'react'

function BottomSheet({ panel, size, title, summary, onSizeChange, onMap, children }) {
  const [tripsActionsTarget, setTripsActionsTarget] = useState(null)
  return (
    <section className="scope-sheet" data-panel={panel} aria-labelledby="scope-sheet-title">
      <header className="scope-sheet-header">
        <div className="scope-sheet-heading">
          <h2 id="scope-sheet-title" title={title}>{title}</h2>
          {summary && <p>{summary}</p>}
        </div>
        {panel === 'trips' && <div className="scope-sheet-trips-actions" ref={setTripsActionsTarget} />}
        <button type="button" onClick={() => onSizeChange(size === 'half' ? 'full' : 'half')}>
          {size === 'peek' ? 'Open' : size === 'full' ? 'Reduce' : 'Expand'}
        </button>
        {size !== 'peek' && <button type="button" className="secondary" onClick={onMap}>Map</button>}
      </header>
      <div key={panel} className="scope-sheet-body" hidden={size === 'peek'}>
        {typeof children === 'function' ? children({ tripsActionsTarget }) : children}
      </div>
    </section>
  )
}

export default BottomSheet

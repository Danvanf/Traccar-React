function BottomSheet({ panel, size, title, summary, onSizeChange, onMap, children }) {
  return (
    <section className="scope-sheet" aria-labelledby="scope-sheet-title">
      <header className="scope-sheet-header">
        <div className="scope-sheet-heading">
          <h2 id="scope-sheet-title" title={title}>{title}</h2>
          {summary && <p>{summary}</p>}
        </div>
        <button type="button" onClick={() => onSizeChange(size === 'half' ? 'full' : 'half')}>
          {size === 'peek' ? 'Open' : size === 'full' ? 'Reduce' : 'Expand'}
        </button>
        {size !== 'peek' && <button type="button" className="secondary" onClick={onMap}>Map</button>}
      </header>
      <div key={panel} className="scope-sheet-body" hidden={size === 'peek'}>
        {children}
      </div>
    </section>
  )
}

export default BottomSheet

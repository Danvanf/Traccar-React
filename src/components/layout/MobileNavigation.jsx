const items = [
  ['status', 'Map'],
  ['devices', 'Devices'],
  ['trips', 'Trips'],
  ['more', 'More'],
]

function MobileNavigation({ activePanel, onSelect, mapButtonRef }) {
  return (
    <nav className="scope-navigation" aria-label="Main navigation">
      {items.map(([panel, label]) => (
        <button
          key={panel}
          ref={panel === 'status' ? mapButtonRef : undefined}
          type="button"
          aria-pressed={activePanel === panel}
          onClick={() => onSelect(panel)}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

export default MobileNavigation

import { useRef } from 'react'
import PanelResizeHandle from './PanelResizeHandle'

export default function TripsWorkspace({ children, onHeightChange, onHeightCommit }) {
  const panelRef = useRef(null)
  return <section ref={panelRef} className="trips-workspace" aria-label="Trips">
    <div className="trips-workspace-scroll">{children}</div>
    <PanelResizeHandle panelRef={panelRef} floating minHeight={240} onHeightChange={onHeightChange} onHeightCommit={onHeightCommit} />
  </section>
}
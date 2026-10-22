import { useState } from 'react'

// Opt-in development aid. No API calls, storage, identifiers, or telemetry.
function readLayout() {
  const inspect = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      width: Math.round(rect.width), height: Math.round(rect.height),
      display: style.display, visibility: style.visibility,
      position: style.position, flex: style.flex,
      opacity: style.opacity, pointerEvents: style.pointerEvents,
      color: style.color, background: style.backgroundColor, zIndex: style.zIndex,
    }
  }
  const viewport = window.visualViewport
  return {
    window: { width: window.innerWidth, height: window.innerHeight },
    visualViewport: viewport ? {
      height: Math.round(viewport.height), width: Math.round(viewport.width),
      top: Math.round(viewport.offsetTop), scale: viewport.scale,
    } : null,
    document: { height: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight },
    flowPositioning: document.querySelector('.scope-layout')?.dataset.debugFlow || false,
    compact: window.matchMedia('(max-width: 63.999rem)').matches,
    dynamicViewportUnits: CSS.supports('height', '100dvh'),
    sheet: document.querySelector('.scope-layout')?.dataset.sheetSize,
    picking: document.querySelector('.scope-layout')?.dataset.locationPicker || false,
    app: inspect('.app-shell'), layout: inspect('.scope-layout'),
    workspace: inspect('.scope-workspace'), topbar: inspect('.scope-topbar'),
    navigation: inspect('.scope-navigation'), map: inspect('.scope-map-area'),
    navigationButtons: [...document.querySelectorAll('.scope-navigation button')].map((button) => {
      const rect = button.getBoundingClientRect()
      const style = getComputedStyle(button)
      const covering = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return {
        label: button.textContent.trim(), top: Math.round(rect.top), bottom: Math.round(rect.bottom),
        left: Math.round(rect.left), right: Math.round(rect.right),
        display: style.display, visibility: style.visibility, opacity: style.opacity, color: style.color,
        hitIsButton: covering === button || button.contains(covering),
        hitTag: covering?.tagName, hitClass: typeof covering?.className === 'string' ? covering.className : '',
      }
    }),
    openTasks: document.querySelectorAll('dialog[open]').length,
  }
}

function LayoutDiagnostics({ flow, onFlowChange }) {
  const [report, setReport] = useState(null)
  return <aside className="scope-layout-diagnostics">
    <button type="button" onClick={() => setReport(report ? null : readLayout())}>{report ? 'Close layout info' : 'Layout info'}</button>
    {report && <div>
      <p>Development layout measurements. No account or location data.</p>
      <button type="button" onClick={() => setReport(readLayout())}>Refresh measurements</button>
      <button type="button" onClick={() => onFlowChange(!flow)}>{flow ? 'Restore fixed positioning' : 'Try normal page positioning'}</button>
      <textarea aria-label="Layout measurements" readOnly value={JSON.stringify(report, null, 2)} rows={12} />
    </div>}
  </aside>
}

export default LayoutDiagnostics
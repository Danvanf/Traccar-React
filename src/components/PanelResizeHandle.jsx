import { useRef } from 'react'

export default function PanelResizeHandle({ panelRef, floating = false, minHeight, sizeMode = 'height', onHeightChange, onHeightCommit }) {
  const dragRef = useRef(null)

  const startResize = (event) => {
    if (event.button !== 0) return
    const panel = floating ? panelRef.current?.parentElement : panelRef.current
    if (!panel) return
    // Start from the visible edge: when content is shorter than its saved cap,
    // the grip still needs to resize from where the user can actually grab it.
    const startHeight = panel.getBoundingClientRect().height
    dragRef.current = { panel, startY: event.clientY, startHeight }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  const resize = (event) => {
    if (!dragRef.current) return
    const { panel, startY, startHeight } = dragRef.current
    const minimum = minHeight ?? Math.round(window.innerHeight * 0.35)
    const maximum = Math.max(minimum, window.innerHeight - panel.getBoundingClientRect().top - 8)
    const height = Math.max(minimum, Math.min(maximum, Math.round(startHeight + event.clientY - startY)))
    if (sizeMode === 'max-height') panel.style.maxHeight = `${height}px`
    else panel.style.height = `${height}px`
    onHeightChange?.(height)
    event.preventDefault()
    event.stopPropagation()
  }

  const finishResize = (event) => {
    if (!dragRef.current) return
    const height = sizeMode === 'max-height'
      ? Math.round(Number.parseFloat(window.getComputedStyle(dragRef.current.panel).maxHeight) || dragRef.current.panel.getBoundingClientRect().height)
      : Math.round(dragRef.current.panel.getBoundingClientRect().height)
    dragRef.current = null
    onHeightCommit?.(height)
    event.stopPropagation()
  }

  return <div
    className="panel-bottom-resize-handle"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize panel height"
    title="Drag to adjust panel height"
    onPointerDown={startResize}
    onPointerMove={resize}
    onPointerUp={finishResize}
    onPointerCancel={finishResize}
  />
}

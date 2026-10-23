import { useCallback, useEffect, useRef } from 'react'

function clampPosition(left, top, element) {
  const rect = element?.getBoundingClientRect()
  const width = rect?.width || 220
  const height = rect?.height || 60
  const margin = 8
  return {
    left: Math.max(margin, Math.min(left, Math.max(margin, window.innerWidth - width - margin))),
    top: Math.max(margin, Math.min(top, Math.max(margin, window.innerHeight - height - margin))),
  }
}

export default function MovableMapKey({ className, position, onPositionChange, onPositionCommit, onHide, closeLabel = 'Hide map key', children }) {
  const dragRef = useRef(null)
  const panelRef = useRef(null)
  useEffect(() => {
    if (!position) return undefined
    const keepInViewport = () => {
      const next = clampPosition(position.left, position.top, panelRef.current)
      if (next.left !== position.left || next.top !== position.top) onPositionCommit(next)
    }
    keepInViewport()
    window.addEventListener('resize', keepInViewport)
    window.visualViewport?.addEventListener('resize', keepInViewport)
    return () => {
      window.removeEventListener('resize', keepInViewport)
      window.visualViewport?.removeEventListener('resize', keepInViewport)
    }
  }, [onPositionCommit, position])
  const beginDrag = useCallback((event) => {
    if (event.button !== 0) return
    const rect = event.currentTarget.parentElement.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, position: position || { left: rect.left, top: rect.top } }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [position])
  const moveDrag = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = clampPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY, panelRef.current)
    drag.position = next
    onPositionChange(next)
  }, [onPositionChange])
  const endDrag = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    onPositionCommit(drag.position)
  }, [onPositionCommit])
  const style = position ? { position: 'fixed', left: `${position.left}px`, top: `${position.top}px`, bottom: 'auto' } : undefined
  return <div ref={panelRef} className={className} style={style}>{onHide && <button type="button" className="map-panel-close" title={closeLabel} aria-label={closeLabel} onClick={onHide}>×</button>}<div className="map-key-drag-handle" title="Drag to move" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>{children}</div></div>
}

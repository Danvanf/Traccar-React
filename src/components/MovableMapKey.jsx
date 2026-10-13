import { useCallback, useRef } from 'react'

function clampPosition(left, top) {
  const width = window.innerWidth
  const height = window.innerHeight
  return {
    left: Math.max(8, Math.min(left, Math.max(8, width - 220))),
    top: Math.max(8, Math.min(top, Math.max(8, height - 60))),
  }
}

export default function MovableMapKey({ className, position, onPositionChange, onPositionCommit, children }) {
  const dragRef = useRef(null)
  const beginDrag = useCallback((event) => {
    if (event.button !== 0) return
    const rect = event.currentTarget.parentElement.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, position: position || { left: rect.left, top: rect.top } }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [position])
  const moveDrag = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = clampPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY)
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
  return <div className={className} style={style}><div className="map-key-drag-handle" title="Drag to move" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>{children}</div></div>
}

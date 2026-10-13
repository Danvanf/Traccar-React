import { useCallback, useEffect, useRef } from 'react'

function clampPosition(left, top, node) {
  const width = node?.offsetWidth || 360
  const height = node?.offsetHeight || 240
  return {
    left: Math.max(8, Math.min(left, Math.max(8, window.innerWidth - width - 8))),
    top: Math.max(8, Math.min(top, Math.max(8, window.innerHeight - height - 8))),
  }
}

export default function MovablePanel({ className = '', position, onPositionChange, onPositionCommit, children }) {
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const callbacksRef = useRef({ onPositionChange, onPositionCommit, position })
  callbacksRef.current = { onPositionChange, onPositionCommit, position }
  const beginDrag = useCallback((event) => {
    if (event.button !== 0 || !event.target.closest('.floating-panel-handle') || event.target.closest('button, a, input, select, textarea')) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, position: { left: rect.left, top: rect.top } }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, [])
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
  useEffect(() => {
    const node = panelRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    let timer
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      const borderBox = Array.isArray(entry?.borderBoxSize) ? entry.borderBoxSize[0] : entry?.borderBoxSize
      const height = Math.round(borderBox?.blockSize || entry?.contentRect.height || 0)
      const current = callbacksRef.current.position
      if (height < 1 || current?.height === height) return
      const next = { ...current, height }
      callbacksRef.current.onPositionChange(next)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => callbacksRef.current.onPositionCommit(callbacksRef.current.position), 300)
    })
    observer.observe(node)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [])
  return <div
    ref={panelRef}
    className={`floating-panel-shell ${className}`}
    style={{ position: 'fixed', left: `${position.left}px`, top: `${position.top}px`, ...(position.height ? { height: `${position.height}px` } : {}) }}
    onPointerDown={beginDrag}
    onPointerMove={moveDrag}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
  >{children}</div>
}

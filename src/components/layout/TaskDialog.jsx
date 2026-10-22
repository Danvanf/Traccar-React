import { useEffect, useRef } from 'react'

function TaskDialog({ wide = false, open, title, onClose, fallbackFocusRef, children }) {
  const dialogRef = useRef(null)
  const headingRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined

    let focusFrame
    if (open && !dialog.open) {
      dialog.showModal()
      focusFrame = requestAnimationFrame(() => {
        if (dialog.open) headingRef.current?.focus()
      })
    } else if (!open && dialog.open) {
      dialog.close()
      // Allow native focus restoration to settle before applying the fallback.
      focusFrame = requestAnimationFrame(() => {
        if (!dialog.open && (document.activeElement === document.body || dialog.contains(document.activeElement))) {
          fallbackFocusRef?.current?.focus()
        }
      })
    }

    return () => {
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    }
  }, [open, fallbackFocusRef])

  return (
    <dialog ref={dialogRef} className={`scope-task-dialog${wide ? " scope-task-dialog-wide" : ""}`} aria-labelledby="scope-task-title" onClose={() => {
      if (document.activeElement === document.body) fallbackFocusRef?.current?.focus()
    }} onCancel={(event) => {
      event.preventDefault()
      onClose()
    }}>
      <header className="scope-task-header">
        <h2 id="scope-task-title" ref={headingRef} tabIndex={-1}>{title}</h2>
        <button type="button" className="secondary" onClick={onClose} aria-label={`Close ${title}`}>Close</button>
      </header>
      <div className="scope-task-body">{children}</div>
    </dialog>
  )
}

export default TaskDialog

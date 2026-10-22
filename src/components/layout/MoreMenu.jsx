import { useEffect, useRef, useState } from 'react'

function MoreMenu({ items }) {
  const [openItem, setOpenItem] = useState(null)
  const backButtonRef = useRef(null)
  const itemButtonsRef = useRef(new Map())
  const returnItemRef = useRef(null)
  const activeItem = items.find((item) => item.label === openItem)

  useEffect(() => {
    if (openItem !== null) {
      backButtonRef.current?.focus()
    } else if (returnItemRef.current !== null) {
      itemButtonsRef.current.get(returnItemRef.current)?.focus()
      returnItemRef.current = null
    }
  }, [openItem])

  if (activeItem?.content) {
    return <div className="scope-more-subview">
      <button ref={backButtonRef} type="button" className="scope-more-back" onClick={() => {
        returnItemRef.current = openItem
        setOpenItem(null)
      }}>‹ More</button>
      {activeItem.content}
    </div>
  }

  return (
    <nav className="scope-more-menu" aria-label="More tools">
      {items.map((item) => (
        <button key={item.label} ref={(node) => {
          if (node) itemButtonsRef.current.set(item.label, node)
          else itemButtonsRef.current.delete(item.label)
        }} type="button" onClick={() => {
          if (item.content) setOpenItem(item.label)
          else item.onSelect?.()
        }} disabled={item.disabled}>
          <span className="scope-more-item-copy">
            <strong>{item.label}</strong>
            {item.description && <small>{item.description}</small>}
          </span>
          <span aria-hidden="true">›</span>
        </button>
      ))}
    </nav>
  )
}

export default MoreMenu
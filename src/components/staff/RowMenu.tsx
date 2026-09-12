import { useState } from 'react'
import { MenuIcon } from './icons'

/** The row's ⋮, holding whatever did not earn an icon of its own. */
export default function RowMenu({
  items,
}: {
  items: { label: string; disabled?: boolean; onSelect: () => void }[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        className="icon-btn"
        aria-label="More"
        title="More"
        onClick={() => setOpen((v) => !v)}
      >
        <MenuIcon />
      </button>
      {open && (
        <>
          {/* Click anywhere else closes it, including on another row. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="menu text-[0.8rem]">
            {items.map((i) => (
              <button
                key={i.label}
                type="button"
                disabled={i.disabled}
                onClick={() => {
                  setOpen(false)
                  i.onSelect()
                }}
              >
                {i.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

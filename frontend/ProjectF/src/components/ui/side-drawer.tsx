import { useEffect, useRef, type ReactNode } from 'react'

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function SideDrawer({
  children,
  labelledBy,
  onClose,
}: {
  children: ReactNode
  labelledBy: string
  onClose: () => void
}) {
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => {
      const drawer = drawerRef.current
      drawer?.querySelector<HTMLElement>(focusableSelector)?.focus()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const drawer = drawerRef.current
      if (!drawer) return
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(focusableSelector),
      )
      if (!focusable.length) {
        event.preventDefault()
        drawer.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!drawer.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      if (opener?.isConnected) opener.focus()
    }
  }, [onClose])

  return (
    <div
      className="filter-drawer-overlay fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="filter-drawer-panel ml-auto flex h-full w-full max-w-md flex-col border-l border-line bg-surface text-foreground shadow-2xl"
      >
        {children}
      </aside>
    </div>
  )
}

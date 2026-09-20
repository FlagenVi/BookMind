import { useEffect, useRef, type ReactNode } from 'react'

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function ModalDialog({
  children,
  labelledBy,
  describedBy,
  onClose,
  closeDisabled = false,
  role = 'dialog',
  placement = 'center',
  className,
}: {
  children: ReactNode
  labelledBy: string
  describedBy?: string
  onClose: () => void
  closeDisabled?: boolean
  role?: 'dialog' | 'alertdialog'
  placement?: 'center' | 'right'
  className: string
}) {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current
      const preferred = dialog?.querySelector<HTMLElement>('[autofocus]')
      const first = dialog?.querySelector<HTMLElement>(focusableSelector)
      ;(preferred ?? first ?? dialog)?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabled) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      )
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
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
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeDisabled, onClose])

  return (
    <div
      className={`fixed inset-0 z-50 grid bg-black/45 backdrop-blur-sm ${placement === 'right' ? 'justify-items-end p-0' : 'place-items-center p-3 sm:p-5'}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !closeDisabled) onClose()
      }}
    >
      <section
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={className}
      >
        {children}
      </section>
    </div>
  )
}

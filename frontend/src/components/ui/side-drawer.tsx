import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { MODAL_TRANSITION_MS } from '@/lib/utils'
import { X } from 'lucide-react'
import { getFocusedElement, restoreOverlayFocus } from '@/lib/overlayFocus'

const openDrawerStack: symbol[] = []

export interface SideDrawerProps {
  isOpen: boolean
  onClose: () => void
  side?: 'left' | 'right'
  widthClass?: string
  className?: string
  children: React.ReactNode
  ariaLabel?: string
}

export function SideDrawer({
  isOpen,
  onClose,
  side = 'right',
  widthClass = 'w-[min(85vw,320px)]',
  className,
  children,
  ariaLabel,
}: SideDrawerProps) {
  const [shouldRender, setShouldRender] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(isOpen)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      const timer = setTimeout(() => setShouldRender(false), MODAL_TRANSITION_MS)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      returnFocusRef.current = getFocusedElement()
    } else if (wasOpenRef.current) {
      restoreOverlayFocus(returnFocusRef.current, panelRef.current)
    }
    wasOpenRef.current = isOpen
  }, [isOpen])

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return

    const token = Symbol('side-drawer')
    openDrawerStack.push(token)

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || openDrawerStack.at(-1) !== token) return
      e.preventDefault()
      onCloseRef.current()
    }

    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleEscape)
      openDrawerStack.splice(openDrawerStack.indexOf(token), 1)
      if (openDrawerStack.length === 0) {
        document.body.style.overflow = 'unset'
      }
    }
  }, [isOpen])

  if (!isOpen && !shouldRender) return null

  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        transition: `opacity ${MODAL_TRANSITION_MS}ms ease-out`,
      }}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={cn(
          'fixed top-0 bottom-0 bg-background border-l border-border pt-safe flex flex-col z-50',
          side === 'right' ? 'right-0' : 'left-0',
          widthClass,
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        data-state={isOpen ? 'open' : 'closed'}
      >
        {children}
      </div>
    </div>
  )
}

export interface SideDrawerHeaderProps {
  title: string
  onClose: () => void
  meta?: React.ReactNode
  actions?: React.ReactNode
}

export function SideDrawerHeader({ title, onClose, meta, actions }: SideDrawerHeaderProps) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-background px-4 py-2 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold text-foreground leading-none">{title}</h2>
        {meta ? <div className="mt-1 min-w-0">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      <button
        type="button"
        onClick={onClose}
        className="text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-sm p-1 shrink-0"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}

export interface SideDrawerContentProps {
  className?: string
  children: React.ReactNode
}

export function SideDrawerContent({ className, children }: SideDrawerContentProps) {
  return (
    <div className={cn('flex-1 overflow-auto min-h-0 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]', className)}>
      {children}
    </div>
  )
}

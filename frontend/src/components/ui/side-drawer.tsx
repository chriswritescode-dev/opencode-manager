import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { MODAL_TRANSITION_MS } from '@/lib/utils'
import { X } from 'lucide-react'

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

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      const timer = setTimeout(() => setShouldRender(false), MODAL_TRANSITION_MS)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

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
        className={cn(
          'fixed top-0 bottom-0 bg-background border-l border-border pt-safe pb-safe flex flex-col',
          side === 'right' ? 'right-0' : 'left-0',
          widthClass,
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  )
}

export interface SideDrawerHeaderProps {
  title: string
  onClose: () => void
}

export function SideDrawerHeader({ title, onClose }: SideDrawerHeaderProps) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-background px-4 py-3 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        className="text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-sm p-1"
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
    <div className={cn('flex-1 overflow-auto min-h-0 px-4 py-3', className)}>
      {children}
    </div>
  )
}

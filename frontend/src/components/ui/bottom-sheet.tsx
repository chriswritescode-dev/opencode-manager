import { useEffect, useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { MODAL_TRANSITION_MS } from '@/lib/utils'
import { useSwipeToClose } from '@/hooks/useMobile'

export interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  heightClass?: string
  className?: string
  children: React.ReactNode
  ariaLabel?: string
}

export function BottomSheet({
  isOpen,
  onClose,
  heightClass = 'h-[70dvh]',
  className,
  children,
  ariaLabel,
}: BottomSheetProps) {
  const [shouldRender, setShouldRender] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const { bind, swipeStyles } = useSwipeToClose(onClose, {
    enabled: isOpen,
    threshold: 80,
  })

  useEffect(() => {
    return bind(containerRef.current)
  }, [bind])

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
      ref={containerRef}
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
          'fixed inset-x-0 bottom-0 bg-background rounded-t-2xl border-t border-border pb-safe',
          heightClass,
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={swipeStyles}
      >
        <div className="w-full flex justify-center pt-3 pb-2">
          <div className="w-9 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        {children}
      </div>
    </div>
  )
}

export interface BottomSheetHeaderProps {
  title?: string
  children?: React.ReactNode
}

export function BottomSheetHeader({ title, children }: BottomSheetHeaderProps) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-background px-4 py-3">
      {title && (
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      )}
      {children}
    </div>
  )
}

export interface BottomSheetContentProps {
  className?: string
  children: React.ReactNode
}

export function BottomSheetContent({ className, children }: BottomSheetContentProps) {
  return (
    <div className={cn('flex-1 overflow-auto min-h-0 px-4 py-3', className)}>
      {children}
    </div>
  )
}

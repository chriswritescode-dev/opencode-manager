import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Content as DialogContent,
  Overlay as DialogOverlay,
  Portal as DialogPortal,
  Root as DialogRoot,
  Title as DialogTitle,
} from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import { MODAL_TRANSITION_MS } from '@/lib/utils'
import { useSwipeDismiss } from '@/hooks/useMobile'
import { getFocusedElement, restoreOverlayFocus } from '@/lib/overlayFocus'

export interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  heightClass?: string
  className?: string
  children: React.ReactNode
  ariaLabel?: string
  dismissible?: boolean
}

export function BottomSheet({
  isOpen,
  onClose,
  heightClass = 'h-[70dvh]',
  className,
  children,
  ariaLabel,
  dismissible = true,
}: BottomSheetProps) {
  const [shouldRender, setShouldRender] = useState(false)
  const [openState, setOpenState] = useState(() => ({
    open: isOpen,
    returnFocus: isOpen ? getFocusedElement() : null,
  }))
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null)
  const setPanelRef = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node
    setPanelElement(node)
  }, [])

  if (openState.open !== isOpen) {
    setOpenState({
      open: isOpen,
      returnFocus: isOpen ? getFocusedElement() : openState.returnFocus,
    })
  }

  const { bind, swipeStyles } = useSwipeDismiss(onClose, {
    enabled: isOpen && dismissible,
    threshold: 60,
  })

  useEffect(() => {
    return bind(panelElement)
  }, [bind, panelElement])

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      const timer = setTimeout(() => setShouldRender(false), MODAL_TRANSITION_MS)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) onClose()
  }

  const handleOpenAutoFocus = (event: Event) => {
    event.preventDefault()
    panelRef.current?.focus({ preventScroll: true })
  }

  const handleCloseAutoFocus = (event: Event) => {
    if (restoreOverlayFocus(openState.returnFocus, event.currentTarget as Element | null)) {
      event.preventDefault()
    }
  }

  if (!isOpen && !shouldRender) return null

  const sheet = (
    <DialogRoot open={isOpen} onOpenChange={handleOpenChange}>
      <DialogPortal forceMount>
        <div
          className="fixed inset-0 z-[250]"
          style={{
            opacity: isOpen ? 1 : 0,
            pointerEvents: isOpen ? 'auto' : 'none',
            transition: `opacity ${MODAL_TRANSITION_MS}ms ease-out`,
          }}
        >
          <DialogOverlay
            forceMount
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <DialogContent
            ref={setPanelRef}
            forceMount
            aria-modal="true"
            aria-describedby={undefined}
            tabIndex={-1}
            onOpenAutoFocus={handleOpenAutoFocus}
            onCloseAutoFocus={handleCloseAutoFocus}
            className={cn(
              'fixed inset-x-0 bottom-0 flex flex-col bg-background rounded-t-2xl border-t border-border focus:outline-none',
              heightClass,
              className,
            )}
            style={swipeStyles}
          >
            <DialogTitle className="sr-only">{ariaLabel}</DialogTitle>
            <div className="w-full flex justify-center pt-3 pb-2">
              <div className="w-9 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            {children}
          </DialogContent>
        </div>
      </DialogPortal>
    </DialogRoot>
  )

  return sheet
}

export interface BottomSheetHeaderProps {
  title?: string
  children?: React.ReactNode
  className?: string
}

export function BottomSheetHeader({ title, children, className }: BottomSheetHeaderProps) {
  return (
    <div className={cn('flex-shrink-0 border-b border-border bg-background px-4 py-3', className)}>
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
    <div className={cn('flex-1 overflow-auto min-h-0 px-4 pt-3 pb-safe', className)}>
      {children}
    </div>
  )
}

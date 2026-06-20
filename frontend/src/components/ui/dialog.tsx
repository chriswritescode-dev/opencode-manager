import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSwipeBack } from '@/hooks/useMobile'

const DialogOpenContext = React.createContext<boolean>(true)

function Dialog({ open, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return (
    <DialogOpenContext.Provider value={open ?? true}>
      <DialogPrimitive.Root open={open} {...props} />
    </DialogOpenContext.Provider>
  )
}

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[70] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'onOpenChange'> {
  hideCloseButton?: boolean
  fullscreen?: boolean
  mobileFullscreen?: boolean
  mobileSwipeToClose?: boolean
  canSwipeBack?: () => boolean
  onSwipeBack?: () => void
  onOpenChange?: (open: boolean) => void
  overlayClassName?: string
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton, fullscreen, mobileFullscreen, mobileSwipeToClose, canSwipeBack, onSwipeBack, overlayClassName, style, ...props }, ref) => {
  const isMobileFullscreenMode = fullscreen || mobileFullscreen
  const isDialogOpen = React.useContext(DialogOpenContext)
  const [isMobile, setIsMobile] = React.useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  const shouldEnableMobileSwipe = mobileSwipeToClose !== false && isMobile && isDialogOpen
  const shouldAnimateSwipe = shouldEnableMobileSwipe && isMobileFullscreenMode
  const swipeContainerRef = React.useRef<HTMLDivElement>(null)
  const closeTriggerRef = React.useRef<HTMLButtonElement>(null)
  
  const combinedRef = React.useCallback((node: HTMLDivElement | null) => {
    swipeContainerRef.current = node
    if (typeof ref === 'function') {
      ref(node)
    } else if (ref) {
      ref.current = node
    }
  }, [ref])
  
  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  const { bind: swipeBind, swipeStyles } = useSwipeBack(
    () => closeTriggerRef.current?.click(),
    { enabled: shouldEnableMobileSwipe, canBack: canSwipeBack, onBack: onSwipeBack }
  )
  
  React.useEffect(() => {
    if (shouldEnableMobileSwipe) {
      return swipeBind(swipeContainerRef.current)
    }
    return undefined
  }, [shouldEnableMobileSwipe, swipeBind])
  
  const baseStyle = isMobileFullscreenMode
    ? { paddingTop: 'env(safe-area-inset-top, 0px)' }
    : undefined

  const mergedStyle = {
    ...baseStyle,
    ...style,
    ...(shouldAnimateSwipe ? swipeStyles : undefined),
  }

  return (
    <DialogPortal>
      {!fullscreen && <DialogOverlay className={overlayClassName} />}
      <DialogPrimitive.Content
        ref={combinedRef}
        autoFocus={false}
        aria-describedby={undefined}
        className={cn(
          "fixed z-[70] grid gap-4 border-0 sm:border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          fullscreen
            ? "inset-0 w-full h-full max-w-none max-h-none p-0 rounded-none"
            : mobileFullscreen
              ? "inset-0 w-full h-full max-w-none max-h-none p-0 rounded-none sm:inset-auto sm:left-[50%] sm:bottom-auto sm:w-[90%] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-0 sm:rounded-lg sm:top-[8%] sm:p-6"
              : "left-[50%] top-[50%] w-[90%] max-w-lg translate-x-[-50%] translate-y-[-50%] p-6 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className
        )}
        style={Object.keys(mergedStyle).length > 0 ? mergedStyle : undefined}
        {...props}
      >
        {children}
        {shouldEnableMobileSwipe && (
          <DialogPrimitive.Close ref={closeTriggerRef} className="sr-only" data-swipe-close-trigger />
        )}
        {!hideCloseButton && !fullscreen && (
          <DialogPrimitive.Close 
            className="absolute right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
            style={mobileFullscreen ? {
              top: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
            } : { top: '1rem' }}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-row sm:flex-row sm:justify-end sm:space-x-2 gap-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}

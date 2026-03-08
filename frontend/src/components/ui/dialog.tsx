import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/72 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideCloseButton?: boolean
  fullscreen?: boolean
  mobileFullscreen?: boolean
  overlayClassName?: string
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton, fullscreen, mobileFullscreen, overlayClassName, ...props }, ref) => {
  const isMobileFullscreenMode = fullscreen || mobileFullscreen
   
  return (
    <DialogPortal>
      {!fullscreen && <DialogOverlay className={overlayClassName} />}
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        aria-describedby={undefined}
        className={cn(
          "scrollbar-thin fixed z-50 grid gap-4 border-0 sm:border border-border/70 bg-popover text-popover-foreground shadow-[0_24px_90px_-36px_color-mix(in_oklab,var(--foreground)_38%,transparent)] duration-200 supports-[backdrop-filter]:bg-popover/92 supports-[backdrop-filter]:backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          fullscreen
            ? "inset-0 w-full h-full max-w-none max-h-none p-0 rounded-none"
            : mobileFullscreen
              ? "inset-0 w-full h-full max-w-none max-h-none p-0 rounded-none sm:inset-auto sm:left-[50%] sm:bottom-auto sm:w-[90%] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-0 sm:p-6 sm:rounded-xl sm:top-[8%]"
              : "left-[50%] top-[50%] w-[90%] max-w-lg translate-x-[-50%] translate-y-[-50%] p-6 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-xl",
          className
        )}
        style={isMobileFullscreenMode ? {
          paddingTop: 'env(safe-area-inset-top, 0px)',
        } : undefined}
        {...props}
      >
        {children}
        {!hideCloseButton && !fullscreen && (
          <DialogPrimitive.Close 
            className="absolute right-4 inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border/70 bg-background/70 text-muted-foreground opacity-90 ring-offset-background transition-[color,background-color,opacity] hover:bg-accent hover:text-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-foreground"
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
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
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

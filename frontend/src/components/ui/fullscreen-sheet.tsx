import * as React from "react"
import { cn } from "@/lib/utils"

interface FullscreenSheetProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

interface FullscreenSheetHeaderProps {
  children: React.ReactNode
  className?: string
}

interface FullscreenSheetContentProps {
  children: React.ReactNode
  className?: string
}

const FullscreenSheet = React.forwardRef<HTMLDivElement, FullscreenSheetProps>(
  ({ children, className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("fixed inset-0 z-50 bg-background flex flex-col", className)}
      style={style}
      {...props}
    >
      {children}
    </div>
  )
)
FullscreenSheet.displayName = "FullscreenSheet"

const FullscreenSheetHeader = React.forwardRef<HTMLDivElement, FullscreenSheetHeaderProps>(
  ({ children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex-shrink-0 border-b border-border bg-background backdrop-blur-sm pt-safe",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)
FullscreenSheetHeader.displayName = "FullscreenSheetHeader"

const FullscreenSheetContent = React.forwardRef<HTMLDivElement, FullscreenSheetContentProps>(
  ({ children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex-1 overflow-hidden min-h-0", className)}
      {...props}
    >
      {children}
    </div>
  )
)
FullscreenSheetContent.displayName = "FullscreenSheetContent"

export { FullscreenSheet, FullscreenSheetHeader, FullscreenSheetContent }

import { useCallback, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '@/hooks/useSidebarWidth'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface SidebarProps {
  collapsed: boolean
  onToggle?: () => void
  widthClass?: string
  collapsedWidthClass?: string
  className?: string
  children: React.ReactNode
  ariaLabel?: string
  width?: number
  onWidthChange?: (width: number) => void
}

interface SidebarDragState {
  pointerId: number
  startX: number
  startWidth: number
}

export function Sidebar({
  collapsed,
  onToggle,
  widthClass = 'w-60',
  collapsedWidthClass = 'w-14',
  className,
  children,
  ariaLabel = 'Sidebar',
  width,
  onWidthChange,
}: SidebarProps) {
  const dragRef = useRef<SidebarDragState | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || width === undefined || !onWidthChange) {
        return
      }
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: width,
      }
      setIsDragging(true)
    },
    [onWidthChange, width]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId || !onWidthChange) {
        return
      }
      onWidthChange(drag.startWidth + event.clientX - drag.startX)
    },
    [onWidthChange]
  )

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    dragRef.current = null
    setIsDragging(false)
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onWidthChange || width === undefined) {
        return
      }
      const step = event.shiftKey ? 64 : 16
      let nextWidth: number
      switch (event.key) {
        case 'ArrowLeft':
          nextWidth = width - step
          break
        case 'ArrowRight':
          nextWidth = width + step
          break
        case 'Home':
          nextWidth = SIDEBAR_MIN_WIDTH
          break
        case 'End':
          nextWidth = SIDEBAR_MAX_WIDTH
          break
        default:
          return
      }
      event.preventDefault()
      onWidthChange(nextWidth)
    },
    [onWidthChange, width]
  )

  const showResizeHandle = !collapsed && width !== undefined && onWidthChange !== undefined

  return (
    <aside
      className={cn(
        'relative z-20 flex-shrink-0 border-r border-border bg-card/50 backdrop-blur-sm h-full flex flex-col pt-safe pb-safe',
        isDragging ? 'transition-none select-none' : 'transition-[width] duration-200',
        collapsed ? collapsedWidthClass : width === undefined ? widthClass : undefined,
        className
      )}
      style={!collapsed && width !== undefined ? { width } : undefined}
      aria-label={ariaLabel}
    >
      {onToggle && <SidebarCollapseToggle collapsed={collapsed} onToggle={onToggle} />}
      {showResizeHandle && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none bg-transparent hover:bg-highlight/30 focus-visible:bg-highlight/30 focus-visible:outline-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onKeyDown={handleKeyDown}
        />
      )}
      {children}
    </aside>
  )
}

export interface SidebarSectionProps {
  label?: string
  collapsed: boolean
  children: React.ReactNode
}

export function SidebarSection({ label, collapsed, children }: SidebarSectionProps) {
  return (
    <div className={cn('flex flex-col gap-1 p-2', !label && 'pt-0')}>
      {label && !collapsed && (
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

export interface SidebarItemProps {
  icon: LucideIcon
  label: string
  active?: boolean
  danger?: boolean
  collapsed: boolean
  onClick?: () => void
  asPrimary?: boolean
  dense?: boolean
  variant?: 'default' | 'primary' | 'secondary' | 'danger'
}

export function SidebarItem({
  icon: Icon,
  label,
  active = false,
  collapsed,
  onClick,
  asPrimary = false,
  dense = false,
  variant = 'default',
}: SidebarItemProps) {

  const baseClasses = cn(
    'flex items-center gap-3 rounded-md transition-colors duration-150',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    asPrimary ? 'p-3 text-sm font-medium' : dense ? 'px-2.5 py-1.5 text-sm' : 'p-2.5 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
    variant === 'secondary' && 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    variant === 'danger' && 'text-destructive hover:bg-destructive/10',
    variant === 'default' && active && 'bg-accent text-accent-foreground',
    variant === 'default' && !active && 'hover:bg-accent/50 text-foreground',
    collapsed && 'justify-center'
  )

  const content = (
    <button
      type="button"
      className={baseClasses}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <Icon className={cn(dense ? 'h-4 w-4' : 'h-5 w-5', 'flex-shrink-0')} />
      {!collapsed && <span className="truncate">{label}</span>}
      {collapsed && <span className="sr-only">{label}</span>}
    </button>
  )

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" align="center">
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return content
}

export interface SidebarCollapseToggleProps {
  collapsed: boolean
  onToggle: () => void
}

export function SidebarCollapseToggle({ collapsed, onToggle }: SidebarCollapseToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'group absolute -right-3 top-1/2 z-20 h-16 w-6 -translate-y-1/2',
        'flex items-center justify-center bg-transparent',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      )}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-expanded={!collapsed}
    >
      <span aria-hidden="true" className="relative flex items-center justify-center">
        <span
          className={cn(
            'h-8 w-1 rounded-full bg-highlight/60 transition-colors duration-150',
            'group-hover:bg-highlight group-focus-visible:bg-highlight'
          )}
        />
        <ChevronLeft
          className={cn(
            'absolute left-full ml-0.5 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity duration-150',
            'group-hover:opacity-100 group-focus-visible:opacity-100',
            collapsed && 'hidden'
          )}
        />
        <ChevronRight
          className={cn(
            'absolute left-full ml-0.5 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity duration-150',
            'group-hover:opacity-100 group-focus-visible:opacity-100',
            !collapsed && 'hidden'
          )}
        />
      </span>
    </button>
  )
}

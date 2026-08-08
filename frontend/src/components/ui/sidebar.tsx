import type { LucideIcon } from 'lucide-react'
import { PanelLeft, PanelLeftClose } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  widthClass?: string
  collapsedWidthClass?: string
  className?: string
  children: React.ReactNode
  ariaLabel?: string
}

export function Sidebar({
  collapsed,
  widthClass = 'w-60',
  collapsedWidthClass = 'w-14',
  className,
  children,
  ariaLabel = 'Sidebar',
}: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex-shrink-0 border-r border-border bg-card/50 backdrop-blur-sm h-dvh flex flex-col pt-safe pb-safe transition-[width] duration-200',
        collapsed ? collapsedWidthClass : widthClass,
        className
      )}
      aria-label={ariaLabel}
    >
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
  variant?: 'default' | 'primary' | 'secondary' | 'danger'
}

export function SidebarItem({
  icon: Icon,
  label,
  active = false,
  collapsed,
  onClick,
  asPrimary = false,
  variant = 'default',
}: SidebarItemProps) {

  const baseClasses = cn(
    'flex items-center gap-3 rounded-md transition-colors duration-150',
    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
    asPrimary ? 'p-3 text-sm font-medium' : 'p-2.5 text-sm',
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
      <Icon className={cn('h-5 w-5', 'flex-shrink-0')} />
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
        'rounded-md p-2.5',
        'hover:bg-accent hover:text-accent-foreground',
        'transition-colors duration-150'
      )}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
    </button>
  )
}

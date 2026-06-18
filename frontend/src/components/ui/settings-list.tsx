import { Fragment, type ReactNode } from 'react'
import { MoreHorizontal, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface SettingsListRowAction {
  label: string
  onClick: () => void
  icon?: ReactNode
  destructive?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

interface SettingsListProps {
  isLoading?: boolean
  error?: Error | null
  isEmpty: boolean
  emptyTitle?: string
  emptyHint?: string
  loadingLabel?: string
  errorTitle?: string
  maxHeightClassName?: string
  children: ReactNode
}

interface SettingsListRowProps {
  title: ReactNode
  titleClassName?: string
  description?: ReactNode
  badges?: ReactNode
  belowDescription?: ReactNode
  trailing?: ReactNode
  primaryAction?: { label: string; onClick: () => void }
  actions?: SettingsListRowAction[]
  actionsLabel?: string
  onClick?: () => void
  className?: string
}

export function SettingsList({
  isLoading,
  error,
  isEmpty,
  emptyTitle,
  emptyHint,
  loadingLabel,
  errorTitle,
  maxHeightClassName,
  children,
}: SettingsListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
        <span className="ml-2 text-sm text-muted-foreground">{loadingLabel ?? 'Loading...'}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50 text-red-500" />
        <p className="text-sm">{errorTitle ?? 'Failed to load'}</p>
        <p className="text-xs mt-1">{error.message}</p>
      </div>
    )
  }

  if (isEmpty) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-muted-foreground">
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        <p className="text-xs mt-1">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className={cn(maxHeightClassName ?? 'max-h-[420px]', 'overflow-y-auto rounded-lg border border-border')}>
      <div className="divide-y divide-border">{children}</div>
    </div>
  )
}

export function SettingsListRow({
  title,
  titleClassName,
  description,
  badges,
  belowDescription,
  trailing,
  primaryAction,
  actions,
  actionsLabel,
  onClick,
  className,
}: SettingsListRowProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-2 bg-card px-3 py-3 hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-3',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      <div className="min-w-0 flex-1 self-stretch sm:self-auto">
        <div className="flex min-w-0 items-start gap-2">
          <p className={cn('min-w-0 flex-1 truncate text-sm font-medium', titleClassName)}>{title}</p>
          {badges}
        </div>
        {description && <div className="mt-1 truncate text-xs text-muted-foreground">{description}</div>}
        {belowDescription}
      </div>
      <div
        className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto sm:justify-start"
        onClick={(e) => e.stopPropagation()}
      >
        {trailing}
        {primaryAction && (
          <Button type="button" size="sm" onClick={primaryAction.onClick} className="flex-1 sm:flex-none">
            {primaryAction.label}
          </Button>
        )}
        {actions && actions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={actionsLabel}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action, i) => (
                <Fragment key={action.label}>
                  {action.separatorBefore && i > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    disabled={action.disabled}
                    onSelect={() => setTimeout(action.onClick, 0)}
                    className={action.destructive ? 'text-destructive focus:text-destructive' : undefined}
                  >
                    {action.icon}
                    {action.label}
                  </DropdownMenuItem>
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

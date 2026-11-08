import { cn } from '@/lib/utils'

interface NotificationsBadgeProps {
  count: number
  destructive: boolean
  className?: string
}

export function NotificationsBadge({ count, destructive, className }: NotificationsBadgeProps) {
  if (count <= 0) return null

  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute -top-1 -right-1 min-w-4 rounded-full px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground',
        destructive ? 'bg-destructive' : 'bg-highlight',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

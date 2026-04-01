import { type LucideIcon } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

type BadgeColor = 'warning' | 'info'

const colorStyles: Record<BadgeColor, { bg: string; hover: string; text: string }> = {
  warning: {
    bg: 'bg-warning/10',
    hover: 'hover:bg-warning/18',
    text: 'text-warning',
  },
  info: {
    bg: 'bg-info/10',
    hover: 'hover:bg-info/18',
    text: 'text-info',
  },
}

interface PendingActionBadgeProps {
  count: number
  icon: LucideIcon
  color: BadgeColor
  onClick: () => void
  label: string
  className?: string
}

export function PendingActionBadge({
  count,
  icon: Icon,
  color,
  onClick,
  label,
  className,
}: PendingActionBadgeProps) {
  if (count === 0) return null

  const styles = colorStyles[color]

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className={cn(
        'relative h-8 w-8 transition-all duration-200',
        styles.bg,
        styles.hover,
        styles.text,
        className
      )}
      title={`${count} pending ${label}${count > 1 ? 's' : ''}`}
    >
      <Icon className="w-4 h-4" />
        <span
          className={cn(
            'absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse',
            color === 'warning' ? 'bg-warning' : 'bg-info'
          )}
        />
      </Button>
  )
}

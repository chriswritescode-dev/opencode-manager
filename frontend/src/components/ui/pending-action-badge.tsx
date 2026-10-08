import { type LucideIcon } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

type BadgeColor = 'orange' | 'blue'

const colorStyles: Record<BadgeColor, { bg: string; hover: string; text: string }> = {
  orange: {
    bg: 'bg-highlight/10',
    hover: 'hover:bg-highlight/20',
    text: 'text-highlight',
  },
  blue: {
    bg: 'bg-info/10',
    hover: 'hover:bg-info/20',
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
        'relative h-10 w-10 transition-all duration-200 sm:h-8 sm:w-8',
        styles.bg,
        styles.hover,
        styles.text,
        className
      )}
      title={`${count} pending ${label}${count > 1 ? 's' : ''}`}
    >
      <Icon className="w-5 h-5 sm:w-4 sm:h-4" />
      <span
        className={cn(
          'absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse',
          color === 'orange' ? 'bg-highlight' : 'bg-info'
        )}
      />
    </Button>
  )
}

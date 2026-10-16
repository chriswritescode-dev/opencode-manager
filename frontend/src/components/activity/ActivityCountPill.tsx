import { cn } from '@/lib/utils'

interface ActivityCountPillProps {
  needsInput: number
  running: number
  className?: string
}

export function ActivityCountPill({ needsInput, running, className }: ActivityCountPillProps) {
  const total = needsInput + running
  if (total === 0) return null

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none',
        needsInput > 0 ? 'bg-warning text-warning-foreground' : 'bg-primary text-primary-foreground',
        className,
      )}
    >
      {total}
    </span>
  )
}

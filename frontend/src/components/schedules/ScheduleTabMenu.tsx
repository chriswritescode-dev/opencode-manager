import { CalendarClock, History, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

type TabType = 'jobs' | 'detail' | 'runs'

interface ScheduleTabMenuProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  className?: string
}

export function ScheduleTabMenu({ activeTab, onTabChange, className }: ScheduleTabMenuProps) {
  return (
    <div className={cn('flex border-t border-border bg-card/80 backdrop-blur-sm pb-1', className)}>
      <button
        type="button"
        className={cn(
          'flex-1 flex flex-col items-center gap-0.5 pt-2.5 pb-2 pb-safe text-xs font-medium transition-colors',
          activeTab === 'jobs'
            ? 'bg-primary/10 text-primary'
            : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
        onClick={() => onTabChange('jobs')}
      >
        <CalendarClock className="h-4 w-4" />
        <span>Jobs</span>
      </button>
      <button
        type="button"
        className={cn(
          'flex-1 flex flex-col items-center gap-0.5 pt-2.5 pb-2 pb-safe text-xs font-medium transition-colors',
          activeTab === 'detail'
            ? 'bg-primary/10 text-primary'
            : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
        onClick={() => onTabChange('detail')}
      >
        <Info className="h-4 w-4" />
        <span>Detail</span>
      </button>
      <button
        type="button"
        className={cn(
          'flex-1 flex flex-col items-center gap-0.5 pt-1.5 py-2 pb-safe text-xs font-medium transition-colors',
          activeTab === 'runs'
            ? 'bg-primary/10 text-primary'
            : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
        onClick={() => onTabChange('runs')}
      >
        <History className="h-4 w-4" />
        <span>Run History</span>
      </button>
    </div>
  )
}

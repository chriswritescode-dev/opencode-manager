import { useTranslation } from 'react-i18next'
import { CalendarClock, History, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

type TabType = 'jobs' | 'detail' | 'runs'

interface ScheduleTabMenuProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  className?: string
}

export function ScheduleTabMenu({ activeTab, onTabChange, className }: ScheduleTabMenuProps) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex border-t border-border bg-card/80 backdrop-blur-sm pb-1', className)}>
      <button
        type="button"
        className={cn(
          'flex-1 flex flex-col items-center gap-1 px-2 py-2 text-xs font-medium border-b-2 transition-colors',
          activeTab === 'jobs'
            ? 'text-primary border-primary'
            : 'text-muted-foreground border-transparent hover:text-foreground',
        )}
        onClick={() => onTabChange('jobs')}
      >
        <CalendarClock className="h-5 w-5" />
        <span>{t('schedule.jobs')}</span>
      </button>
      <button
        type="button"
        className={cn(
          'flex-1 flex flex-col items-center gap-1 px-2 py-2 text-xs font-medium border-b-2 transition-colors',
          activeTab === 'detail'
            ? 'text-primary border-primary'
            : 'text-muted-foreground border-transparent hover:text-foreground',
        )}
        onClick={() => onTabChange('detail')}
      >
        <Info className="h-5 w-5" />
        <span>{t('schedule.detail')}</span>
      </button>
      <button
        type="button"
        className={cn(
          'flex-1 flex flex-col items-center gap-1 px-2 py-2 text-xs font-medium border-b-2 transition-colors',
          activeTab === 'runs'
            ? 'text-primary border-primary'
            : 'text-muted-foreground border-transparent hover:text-foreground',
        )}
        onClick={() => onTabChange('runs')}
      >
        <History className="h-5 w-5" />
        <span>{t('schedule.runs')}</span>
      </button>
    </div>
  )
}

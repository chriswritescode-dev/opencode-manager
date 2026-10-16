import { useActivityWindowMinutes } from '@/hooks/useActiveWork'
import { ActivityList } from '@/components/activity/ActivityList'

/**
 * A compact, self-titled Activity section that renders nothing when empty.
 * Reads the network through `useActiveWork`, so it must only be mounted while visible.
 */
export function CompactActivityList({ onNavigate }: { onNavigate: (path: string) => void }) {
  const minutes = useActivityWindowMinutes()

  return (
    <ActivityList
      minutes={minutes}
      title="Activity"
      hideWhenEmpty
      variant="compact"
      onNavigate={(item) => onNavigate(item.path)}
    />
  )
}

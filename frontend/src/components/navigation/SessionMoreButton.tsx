import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUIState } from '@/stores/uiStateStore'

export function SessionMoreButton() {
  const setMoreDrawerOpen = useUIState((state) => state.setMoreDrawerOpen)

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setMoreDrawerOpen(true)}
      className="md:hidden h-10 w-10 p-0 text-foreground border-border hover:bg-accent"
      aria-label="More"
    >
      <MoreVertical className="w-5 h-5" />
    </Button>
  )
}

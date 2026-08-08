import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'

export function SessionMoreButton() {
  const { open } = useMobileTabBar()

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => open('more')}
      className="md:hidden h-10 w-10 p-0 text-foreground border-border hover:bg-accent"
      aria-label="More"
    >
      <MoreVertical className="w-5 h-5" />
    </Button>
  )
}

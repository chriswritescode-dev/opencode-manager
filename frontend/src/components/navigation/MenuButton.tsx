import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NotificationsBadge } from '@/components/notifications/NotificationsBadge'
import { useNotificationsAction } from '@/hooks/useNotificationsAction'
import { cn } from '@/lib/utils'

interface MenuButtonProps {
  className?: string
  onPress: () => void
}

export function MenuButton({ className, onPress }: MenuButtonProps) {
  const { count, destructive, label } = useNotificationsAction()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onPress}
      aria-label={count === 0 ? 'Menu' : `Menu, ${label}`}
      className={cn('relative', className)}
    >
      <Menu className="h-5 w-5" />
      <NotificationsBadge count={count} destructive={destructive} />
    </Button>
  )
}

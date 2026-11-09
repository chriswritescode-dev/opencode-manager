import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { NotificationsBadge } from '@/components/notifications/NotificationsBadge'
import { Button } from '@/components/ui/button'
import { useNotificationsAction } from '@/hooks/useNotificationsAction'
import { cn } from '@/lib/utils'

interface SessionBackButtonProps {
  to: string
  className?: string
}

/**
 * Icon-only back control for the session header that also surfaces pending notifications.
 */
export function SessionBackButton({ to, className }: SessionBackButtonProps) {
  const navigate = useNavigate()
  const { count, destructive, label } = useNotificationsAction()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => navigate(to)}
      aria-label={count === 0 ? 'Back' : `Back, ${label}`}
      className={cn('relative', className)}
    >
      <ArrowLeft className="h-5 w-5" />
      <NotificationsBadge count={count} destructive={destructive} />
    </Button>
  )
}

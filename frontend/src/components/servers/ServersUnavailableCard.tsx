import { Server } from 'lucide-react'
import { LinkedServerStateCard } from '@/components/servers/LinkedServerStateCard'

interface ServersUnavailableCardProps {
  onRetry: () => void
}

/**
 * Shown on a linked-server screen while the server list is paused offline with no cached data, so
 * an unreachable server list is not mistaken for a server that was removed.
 */
export function ServersUnavailableCard({ onRetry }: ServersUnavailableCardProps) {
  return (
    <LinkedServerStateCard
      icon={Server}
      title="Servers unavailable"
      description="Reconnect to load your linked servers."
      actionLabel="Retry"
      onAction={onRetry}
    />
  )
}

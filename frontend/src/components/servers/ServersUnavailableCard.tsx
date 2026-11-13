import { Server } from 'lucide-react'
import { LinkedServerStateCard } from '@/components/servers/LinkedServerStateCard'

interface ServersUnavailableCardProps {
  onRetry: () => void
}

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

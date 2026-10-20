import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface LinkedServerStateCardProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}

/**
 * Centered notice for a linked-server page that cannot render its content, such as a missing or
 * disabled server or a route without its project directory.
 */
export function LinkedServerStateCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: LinkedServerStateCardProps) {
  return (
    <Card className="flex flex-col items-center gap-3 p-6 text-center">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    </Card>
  )
}

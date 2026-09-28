import { Ban, Check, Loader2, Square, XCircle } from 'lucide-react'
import { backgroundTaskStatusColor, type BackgroundTaskLifecycle } from '@/lib/backgroundWork'

export function BackgroundTaskStatusIcon({ status, className }: { status: BackgroundTaskLifecycle; className: string }) {
  const iconClassName = `${className} ${backgroundTaskStatusColor(status)}`
  if (status === 'completed') return <Check className={iconClassName} />
  if (status === 'failed') return <XCircle className={iconClassName} />
  if (status === 'interrupted') return <Ban className={iconClassName} />
  if (status === 'killed') return <Square className={iconClassName} />
  if (status === 'unavailable') return <XCircle className={iconClassName} />
  return <Loader2 className={`${iconClassName} animate-spin`} />
}

import { Badge } from '@/components/ui/badge'
import { AlertCircle, Key } from 'lucide-react'
import type { McpStatus } from '@/api/mcp'

interface McpStatusBadgeProps {
  status: McpStatus
}

export function McpStatusBadge({ status }: McpStatusBadgeProps) {
  switch (status.status) {
    case 'connected':
      return <Badge variant="default" className="text-xs bg-green-600">Connected</Badge>
    case 'pending':
      return <Badge variant="outline" className="text-xs">Connecting</Badge>
    case 'disabled':
      return <Badge variant="secondary" className="text-xs">Disabled</Badge>
    case 'failed':
      return (
        <Badge variant="destructive" className="text-xs flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Failed
        </Badge>
      )
    case 'needs_auth':
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1 border-yellow-500 text-yellow-600">
          <Key className="h-3 w-3" />
          Auth Required
        </Badge>
      )
    default:
      return <Badge variant="outline" className="text-xs">Unknown</Badge>
  }
}

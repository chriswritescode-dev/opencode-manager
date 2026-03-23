import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, X, Play } from 'lucide-react'
import type { DevcontainerUpdateRequest } from '@opencode-manager/shared'
import { formatDistanceToNow } from 'date-fns'

interface DevcontainerRequestCardProps {
  request: DevcontainerUpdateRequest & { id?: number }
  sessionId: string
  onApprove: (sessionId: string, requestId: number) => void
  onReject: (sessionId: string, requestId: number) => void
  onApply: (sessionId: string, requestId: number) => void
}

const getStatusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'approved':
      return 'default'
    case 'applied':
      return 'secondary'
    case 'rejected':
      return 'destructive'
    default:
      return 'outline'
  }
}

export function DevcontainerRequestCard({
  request,
  sessionId,
  onApprove,
  onReject,
  onApply,
}: DevcontainerRequestCardProps) {
  const isPending = request.status === 'pending'
  const isApproved = request.status === 'approved'
  const isApplied = request.status === 'applied'
  const isRejected = request.status === 'rejected'
  const requestId = request.id

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium">
                {request.action === 'fork' ? 'Fork Template' : 'Modify Template'}
              </h4>
              <Badge variant={getStatusVariant(request.status)}>
                {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
              </Badge>
            </div>
            {request.templateName && (
              <p className="text-sm text-muted-foreground">
                Template: {request.templateName}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Requested by {request.requestedBy} •{' '}
              {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
            </p>
          </div>
        </div>

        {request.reason && (
          <div className="border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground mb-1">Reason:</p>
            <p className="text-sm">{request.reason}</p>
          </div>
        )}

        <div className="border-t pt-2">
          <p className="text-xs font-medium text-muted-foreground mb-1">Changes:</p>
          <div className="space-y-1">
            {request.changes.addNixPackages && request.changes.addNixPackages.length > 0 && (
              <div className="text-sm">
                <span className="font-medium text-green-600 dark:text-green-400">+ Packages:</span>{' '}
                {request.changes.addNixPackages.join(', ')}
              </div>
            )}
            {request.changes.removeNixPackages && request.changes.removeNixPackages.length > 0 && (
              <div className="text-sm">
                <span className="font-medium text-red-600 dark:text-red-400">- Packages:</span>{' '}
                {request.changes.removeNixPackages.join(', ')}
              </div>
            )}
            {request.changes.addEnv && Object.keys(request.changes.addEnv).length > 0 && (
              <div className="text-sm">
                <span className="font-medium text-blue-600 dark:text-blue-400">+ Env:</span>{' '}
                {Object.entries(request.changes.addEnv)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')}
              </div>
            )}
            {request.changes.removeEnv && request.changes.removeEnv.length > 0 && (
              <div className="text-sm">
                <span className="font-medium text-red-600 dark:text-red-400">- Env:</span>{' '}
                {request.changes.removeEnv.join(', ')}
              </div>
            )}
            {request.changes.customChanges && (
              <div className="text-sm">
                <span className="font-medium">Custom:</span>{' '}
                <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                  {JSON.stringify(request.changes.customChanges, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {requestId !== undefined && (
          <div className="flex gap-2 border-t pt-3">
            {isPending && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => onApprove(sessionId, requestId)}
                >
                  <Check className="w-4 h-4 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onReject(sessionId, requestId)}
                >
                  <X className="w-4 h-4 mr-1" />
                  Reject
                </Button>
              </>
            )}
            {isApproved && (
              <Button
                size="sm"
                variant="default"
                onClick={() => onApply(sessionId, requestId)}
              >
                <Play className="w-4 h-4 mr-1" />
                Apply
              </Button>
            )}
            {isApplied && (
              <Badge variant="secondary" className="text-sm">
                Applied successfully
              </Badge>
            )}
            {isRejected && (
              <Badge variant="destructive" className="text-sm">
                Rejected
              </Badge>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

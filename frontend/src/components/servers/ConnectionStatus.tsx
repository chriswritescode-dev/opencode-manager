import type { OpenCodeServerStatus } from '@opencode-manager/shared/schemas'

interface ConnectionStatusProps {
  status?: OpenCodeServerStatus
  isLoading: boolean
}

/**
 * Connection indicator for a linked server: checking, unknown, unreachable with its error, or
 * connected with the server version.
 */
export function ConnectionStatus({ status, isLoading }: ConnectionStatusProps) {
  if (isLoading) {
    return <span className="text-xs text-muted-foreground">Checking connection...</span>
  }

  if (!status) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
        Unknown
      </span>
    )
  }

  if (!status.connected) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive" title={status.error ?? undefined}>
        <span className="h-2 w-2 rounded-full bg-destructive" />
        Unreachable
        {status.error ? <span className="text-muted-foreground">· {status.error}</span> : null}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-success">
      <span className="h-2 w-2 rounded-full bg-success" />
      Connected
      {status.version ? <span className="text-muted-foreground">· v{status.version}</span> : null}
    </span>
  )
}

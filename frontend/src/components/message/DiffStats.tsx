interface DiffStatsProps {
  additions: number
  deletions: number
  variant?: 'default' | 'compact'
}

export function DiffStats({ additions, deletions, variant = 'default' }: DiffStatsProps) {
  if (additions === 0 && deletions === 0) {
    return null
  }

  const compact = variant === 'compact'

  return (
    <span className="flex items-center gap-1 text-xs font-mono">
      {additions > 0 && (
        <span className="text-success">
          {compact ? `+${additions}` : `+${additions}`}
        </span>
      )}
      {additions > 0 && deletions > 0 && (
        <span className="text-muted-foreground">{compact ? '/' : ' '}</span>
      )}
      {deletions > 0 && (
        <span className="text-destructive">
          {compact ? `-${deletions}` : `-${deletions}`}
        </span>
      )}
    </span>
  )
}

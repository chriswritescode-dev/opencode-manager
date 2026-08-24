export const GIT_STATUS_COLORS = {
  modified: 'text-warning',
  added: 'text-success',
  deleted: 'text-destructive',
  renamed: 'text-info',
  untracked: 'text-muted-foreground',
  copied: 'text-success',
} as const

export const GIT_UI_COLORS = {
  ahead: 'text-success',
  behind: 'text-warning',
  current: 'text-success',
  remote: 'text-info',
  stage: 'text-success',
  unstage: 'text-destructive',
  stagedBadge: 'border border-success/20 bg-success/12 text-success',
  unpushed: 'border border-info/20 bg-info/12 text-info',
  pushed: 'border border-accent-foreground/10 bg-accent text-accent-foreground',
} as const

export const GIT_STATUS_LABELS = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'Untracked',
  copied: 'Copied',
} as const

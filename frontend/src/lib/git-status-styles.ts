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
  current: 'text-highlight',
  remote: 'text-info',
  stage: 'text-success',
  unstage: 'text-destructive',
  stagedBadge: 'bg-success/10 text-success dark:bg-success/20',
  unpushed: 'bg-info/10 text-info dark:bg-info/20',
  pushed: 'bg-primary/10 text-primary dark:bg-primary/20',
} as const

export const GIT_STATUS_LABELS = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'Untracked',
  copied: 'Copied',
} as const

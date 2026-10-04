import { useState } from 'react'
import { useGitStashes } from '@/api/git'
import { useGit } from '@/hooks/useGit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { Archive, ArchiveRestore, PackageOpen, Trash2, Loader2, AlertCircle } from 'lucide-react'
import type { GitStashEntry } from '@opencode-manager/shared'

interface StashTabProps {
  repoId: number
}

function formatStashDate(date: string): string {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) {
    return date
  }
  return parsed.toLocaleString()
}

export function StashTab({ repoId }: StashTabProps) {
  const { data, isLoading, error } = useGitStashes(repoId)
  const git = useGit(repoId)
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [stashToDrop, setStashToDrop] = useState<GitStashEntry | null>(null)

  const stashes = data?.stashes ?? []

  const handleStash = () => {
    git.stashPush.mutate(
      { message: message.trim() || undefined, includeUntracked },
      { onSuccess: () => setMessage('') },
    )
  }

  const handleDrop = () => {
    if (!stashToDrop) return
    git.stashDrop.mutate(
      { index: stashToDrop.index, hash: stashToDrop.hash },
      { onSuccess: () => setStashToDrop(null) },
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Failed to load stashes</p>
        <p className="text-xs mt-1">{error.message}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border space-y-2 flex-shrink-0">
        <Input
          aria-label="Stash message"
          placeholder="Stash message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="h-10 md:h-8 md:text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleStash()
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={includeUntracked}
              onCheckedChange={(checked) => setIncludeUntracked(checked === true)}
            />
            Include untracked
          </label>
          <Button
            size="sm"
            className="h-10 md:h-8"
            onClick={handleStash}
            disabled={git.stashPush.isPending}
          >
            {git.stashPush.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Archive className="w-4 h-4 mr-1" />
            )}
            Stash changes
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {stashes.length > 0 ? (
          <div className="py-1">
            {stashes.map((stash) => (
              <div key={stash.ref} className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50">
                <Archive className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{stash.message || 'No message'}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {stash.branch ?? 'unknown branch'} · {formatStashDate(stash.date)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => git.stashApply.mutate({ index: stash.index, hash: stash.hash, pop: false })}
                  disabled={git.stashApply.isPending}
                  title="Apply stash"
                >
                  <ArchiveRestore className="w-4 h-4 mr-1" />
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => git.stashApply.mutate({ index: stash.index, hash: stash.hash, pop: true })}
                  disabled={git.stashApply.isPending}
                  title="Pop stash"
                >
                  <PackageOpen className="w-4 h-4 mr-1" />
                  Pop
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  onClick={() => setStashToDrop(stash)}
                  disabled={git.stashDrop.isPending}
                  title="Drop stash"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Archive className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No stashes</p>
          </div>
        )}
      </div>

      <ConfirmDestructiveDialog
        open={!!stashToDrop}
        onOpenChange={(open) => {
          if (!open) setStashToDrop(null)
        }}
        onConfirm={handleDrop}
        onCancel={() => setStashToDrop(null)}
        title={`Drop stash "${stashToDrop?.message || stashToDrop?.ref || ''}"?`}
        description="This permanently removes the stashed changes. This action cannot be undone."
        confirmLabel="Drop"
        pendingLabel="Dropping..."
        isPending={git.stashDrop.isPending}
      />
    </div>
  )
}

import { useState, type ReactNode } from 'react'
import { Server } from 'lucide-react'
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DeleteSessionDialog } from '@/components/session/DeleteSessionDialog'
import { useMobile } from '@/hooks/useMobile'
import { cn } from '@/lib/utils'

export interface SessionDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  serverName?: string
  remote: boolean
  project: string
  branch?: string | null
  directory?: string
  onRename: (title: string) => Promise<void>
  /** Deletes the open session, when the caller supports it. */
  onDeleteSession?: () => Promise<void>
}

interface InfoRowProps {
  label: string
  value: string
  mono?: boolean
  leading?: ReactNode
}

function InfoRow({ label, value, mono, leading }: InfoRowProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-start gap-1.5">
        {leading}
        <span className={cn('min-w-0 select-text break-words', mono && 'font-mono text-xs')}>
          {value}
        </span>
      </div>
    </div>
  )
}

export function SessionDetailsSheet({
  open,
  onOpenChange,
  title,
  serverName,
  remote,
  project,
  branch,
  directory,
  onRename,
  onDeleteSession,
}: SessionDetailsSheetProps) {
  const isMobile = useMobile()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [renameFailed, setRenameFailed] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const [lastOpen, setLastOpen] = useState(open)

  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setEditing(false)
      setRenameFailed(false)
      setDeleteFailed(false)
    } else {
      setDeleteOpen(false)
    }
  }

  const displayTitle = title?.trim() ? title : 'Untitled Session'
  const trimmedDraft = draft.trim()
  const canSave = trimmedDraft.length > 0 && !saving

  const startEditing = () => {
    setDraft(title ?? '')
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setRenameFailed(false)
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setRenameFailed(false)
    try {
      await onRename(trimmedDraft)
      setEditing(false)
    } catch {
      setRenameFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (saving) return
    onOpenChange(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose()
      return
    }
    onOpenChange(true)
  }

  const confirmDelete = async () => {
    if (!onDeleteSession) return
    setDeleting(true)
    setDeleteFailed(false)
    try {
      await onDeleteSession()
      setDeleteOpen(false)
      onOpenChange(false)
    } catch {
      setDeleteFailed(true)
    } finally {
      setDeleting(false)
    }
  }

  const body = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-muted-foreground">Title</span>
        {editing ? (
          <>
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key !== 'Enter') return
                event.preventDefault()
                save()
              }}
              disabled={saving}
              aria-label="Session title"
              placeholder="Session title"
              autoFocus
              className="w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
            {renameFailed && (
              <span className="text-xs text-destructive">Rename failed</span>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancelEditing}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={!canSave}
                className="flex-1"
              >
                Save
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="select-text break-words text-sm">{displayTitle}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startEditing}
              className="mt-1 self-start"
            >
              Rename
            </Button>
          </>
        )}
      </div>
      <InfoRow
        label="Server"
        value={remote ? serverName || 'Remote server' : 'Local'}
        leading={remote ? <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-highlight" /> : undefined}
      />
      <InfoRow label="Project" value={project} />
      {branch ? <InfoRow label="Branch" value={branch} mono /> : null}
      {directory ? <InfoRow label="Directory" value={directory} mono /> : null}
      {onDeleteSession ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="self-start"
          >
            Delete chat session
          </Button>
          {deleteFailed && (
            <span className="text-xs text-destructive">Delete failed</span>
          )}
        </div>
      ) : null}
    </div>
  )

  const deleteDialog = onDeleteSession ? (
    <DeleteSessionDialog
      open={deleteOpen}
      onOpenChange={setDeleteOpen}
      onConfirm={() => { void confirmDelete() }}
      onCancel={() => setDeleteOpen(false)}
      isDeleting={deleting}
    />
  ) : null

  if (isMobile) {
    return (
      <>
        <BottomSheet
          isOpen={open}
          onClose={handleClose}
          ariaLabel="Session details"
          dismissible={!saving}
        >
          <BottomSheetHeader title="Session details" />
          <BottomSheetContent>{body}</BottomSheetContent>
        </BottomSheet>
        {deleteDialog}
      </>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Session details</DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
      {deleteDialog}
    </>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2, Plus } from 'lucide-react'
import { useCreateSession } from '@/hooks/useOpenCode'
import { getServerSessionPath } from '@/lib/navigation'
import { parseNetworkError } from '@/lib/opencode-errors'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface OpenDirectoryDialogProps {
  serverId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Dialog that starts a new session in an absolute directory on the linked server.
 */
export function OpenDirectoryDialog({ serverId, open, onOpenChange }: OpenDirectoryDialogProps) {
  const navigate = useNavigate()
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createSession = useCreateSession(directory)

  useEffect(() => {
    if (!open) {
      setDirectory('')
      setError(null)
    }
  }, [open])

  const canSubmit = directory.trim().length > 0 && !createSession.isPending

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setError(null)
    try {
      const session = await createSession.mutateAsync({ agent: undefined })
      onOpenChange(false)
      navigate(getServerSessionPath(serverId, session.id))
    } catch (cause) {
      setError(parseNetworkError(cause).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open directory</DialogTitle>
          <DialogDescription>
            Start a session in an absolute path on the linked server.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="open-directory-path" className="text-sm font-medium">
              Directory
            </label>
            <Input
              id="open-directory-path"
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              placeholder="/absolute/path/on/the/server"
              autoComplete="off"
              name="remote-directory"
              className="font-mono text-sm"
              autoFocus
              disabled={createSession.isPending}
            />
          </div>
          {error ? (
            <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createSession.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createSession.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              Start session
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

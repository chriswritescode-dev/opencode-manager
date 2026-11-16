import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SandboxResourceInputs } from '@/components/sandbox/SandboxResourceInputs'
import { FetchError } from '@/api/fetchWrapper'
import { getRepoSandboxResources, restartRepoSandbox, updateRepoSandboxResources } from '@/api/repos'
import { formatSandboxMemory, formatSandboxResources } from '@/lib/sandboxResources'
import {
  SessionSandboxResourcesSchema,
  type RepoSandboxResources,
  type SessionSandboxResources,
} from '@opencode-manager/shared/schemas'

interface SessionSandboxResourcesDialogProps {
  repoId: number
  directory: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SessionSandboxResourcesDialog({
  repoId,
  directory,
  open,
  onOpenChange,
}: SessionSandboxResourcesDialogProps) {
  const queryClient = useQueryClient()
  const queryKey = ['repoSandboxResources', repoId, directory] as const
  const { data } = useQuery({
    queryKey,
    queryFn: () => getRepoSandboxResources(repoId, directory),
    enabled: open,
  })
  const [cpus, setCpus] = useState('')
  const [memoryGib, setMemoryGib] = useState('')
  const [error, setError] = useState<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (!open) {
      initialized.current = false
      return
    }
    if (initialized.current || !data) return
    const source = data.override ?? data.effective
    setCpus(String(source.cpus))
    setMemoryGib(formatSandboxMemory(source.memoryMib))
    setError(null)
    initialized.current = true
  }, [open, data])

  const updateMutation = useMutation({
    mutationFn: (resources: SessionSandboxResources | null) => updateRepoSandboxResources(repoId, resources),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated)
      setError(null)
      onOpenChange(false)
    },
    onError: (err) => {
      setError(err instanceof FetchError ? err.message : 'Failed to update sandbox resources')
    },
  })

  const restartMutation = useMutation({
    mutationFn: () => restartRepoSandbox(repoId, directory),
    onSuccess: () => {
      queryClient.setQueryData<RepoSandboxResources>(queryKey, (current) =>
        current ? { ...current, running: null } : current
      )
      setError(null)
    },
    onError: (err) => {
      setError(err instanceof FetchError ? err.message : 'Failed to restart sandbox')
    },
  })

  const submit = (resources: SessionSandboxResources | null) => {
    setError(null)
    updateMutation.mutate(resources)
  }

  const handleSave = () => {
    const memoryMib = Math.round(Number(memoryGib.trim()) * 1024)
    const parsed = SessionSandboxResourcesSchema.safeParse({ cpus: Number(cpus.trim()), memoryMib })
    if (!parsed.success) {
      setError('CPUs must be a whole number from 1 to 64 and memory must be at least 1 GiB')
      return
    }
    submit(parsed.data)
  }

  const runningStatus =
    data?.running != null &&
    (data.running.cpus !== data.effective.cpus || data.running.memoryMib !== data.effective.memoryMib)
      ? `Running with ${formatSandboxResources(data.running).replace(' · ', ', ')} until the VM restarts`
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90%] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sandbox resources</DialogTitle>
          <DialogDescription>
            Applies to every sandboxed session in this repository the next time its sandbox VM starts. Running commands
            are not interrupted.
          </DialogDescription>
        </DialogHeader>
        <SandboxResourceInputs
          idPrefix="sessionSandbox"
          cpus={cpus}
          onCpusChange={setCpus}
          memoryGib={memoryGib}
          onMemoryGibChange={setMemoryGib}
          disabled={updateMutation.isPending}
          error={error}
        />
        {runningStatus ? <p className="text-sm text-muted-foreground">{runningStatus}</p> : null}
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm text-muted-foreground">
            Running commands in this repository's sandbox are interrupted. Installed packages and Docker data are kept.
          </p>
          <Button
            variant="outline"
            onClick={() => restartMutation.mutate()}
            disabled={restartMutation.isPending || data === undefined}
          >
            Restart sandbox now
          </Button>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => submit(null)} disabled={updateMutation.isPending}>
            Use defaults
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

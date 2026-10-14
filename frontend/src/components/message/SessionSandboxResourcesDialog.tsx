import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSetSessionSandbox } from '@/hooks/useSessionSandbox'
import { FetchError } from '@/api/fetchWrapper'
import { formatSandboxMemory } from '@/lib/sandboxResources'
import { SessionSandboxResourcesSchema, type SessionSandboxResources } from '@opencode-manager/shared/schemas'

interface SessionSandboxResourcesDialogProps {
  sessionID: string
  open: boolean
  onOpenChange: (open: boolean) => void
  override: SessionSandboxResources | null
  effective: SessionSandboxResources
}

export function SessionSandboxResourcesDialog({
  sessionID,
  open,
  onOpenChange,
  override,
  effective,
}: SessionSandboxResourcesDialogProps) {
  const setSandbox = useSetSessionSandbox(sessionID)
  const [cpus, setCpus] = useState('')
  const [memoryGib, setMemoryGib] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const source = override ?? effective
    setCpus(String(source.cpus))
    setMemoryGib(formatSandboxMemory(source.memoryMib))
    setError(null)
  }, [open, override, effective])

  const submit = async (resources: SessionSandboxResources | null) => {
    setError(null)
    try {
      await setSandbox.mutateAsync({ resources })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof FetchError ? err.message : 'Failed to update sandbox resources')
    }
  }

  const handleSave = () => {
    const memoryMib = Math.round(Number(memoryGib.trim()) * 1024)
    const parsed = SessionSandboxResourcesSchema.safeParse({ cpus: Number(cpus.trim()), memoryMib })
    if (!parsed.success) {
      setError('CPUs must be a whole number from 1 to 64 and memory must be at least 1 GiB')
      return
    }
    void submit(parsed.data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90%] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sandbox resources</DialogTitle>
          <DialogDescription>
            CPU and memory changes apply on this session's next sandboxed command and recreate its VM. The Docker
            data volume is kept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sessionSandboxCpus">CPUs</Label>
            <Input
              id="sessionSandboxCpus"
              type="number"
              min={1}
              max={64}
              step={1}
              value={cpus}
              onChange={(event) => setCpus(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sessionSandboxMemory">Memory (GiB)</Label>
            <Input
              id="sessionSandboxMemory"
              type="number"
              min={1}
              step={0.5}
              value={memoryGib}
              onChange={(event) => setMemoryGib(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => void submit(null)} disabled={setSandbox.isPending}>
            Use defaults
          </Button>
          <Button onClick={handleSave} disabled={setSandbox.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Trash2, ArrowUpRight } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { useProvidersWithModels } from '@/hooks/useProvidersWithModels'
import { useDiscardMultiRunEntry, useLaunchMultiRun, useMultiRuns } from '@/hooks/useMultiRuns'
import { formatModelName, formatProviderName, providerModelRef, type ProviderWithModels } from '@/api/providers'
import { buildSessionPath } from '@opencode-manager/shared/utils'
import {
  MULTI_RUN_MAX_MODELS,
  type LaunchMultiRunRequest,
  type MultiRunEntry,
  type MultiRunEntryStatus,
} from '@opencode-manager/shared/schemas'

interface MultiRunDialogProps {
  repoId: number
  directory?: string
  defaultBaseRef?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface PendingDiscard {
  runId: number
  entryId: number
  model: string
  isolated: boolean
}

const STATUS_LABELS: Record<MultiRunEntryStatus, string> = {
  starting: 'Starting',
  started: 'Started',
  failed: 'Failed',
  discarded: 'Discarded',
}

export function MultiRunDialog({
  repoId,
  directory,
  defaultBaseRef,
  open,
  onOpenChange,
}: MultiRunDialogProps) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('launch')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [isolate, setIsolate] = useState(true)
  const [baseRef, setBaseRef] = useState('')
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null)

  const { data: providers } = useProvidersWithModels({ enabled: open, directory })
  const runsQuery = useMultiRuns(repoId, open)
  const launch = useLaunchMultiRun(repoId)
  const discard = useDiscardMultiRunEntry(repoId)

  useEffect(() => {
    if (!open) return
    setActiveTab('launch')
    setName('')
    setPrompt('')
    setSelectedModels([])
    setIsolate(true)
    setBaseRef(defaultBaseRef ?? '')
  }, [open, defaultBaseRef])

  const modelGroups = useMemo(
    () => providers.filter((provider) => provider.models.length > 0),
    [providers],
  )

  const toggleModel = useCallback((value: string, checked: boolean) => {
    setSelectedModels((current) => {
      if (checked) {
        if (current.includes(value) || current.length >= MULTI_RUN_MAX_MODELS) return current
        return [...current, value]
      }
      return current.filter((model) => model !== value)
    })
  }, [])

  const canSubmit =
    name.trim().length > 0 && prompt.trim().length > 0 && selectedModels.length > 0 && !launch.isPending

  const handleLaunch = async () => {
    const request: LaunchMultiRunRequest = {
      repoId,
      name: name.trim(),
      prompt: prompt.trim(),
      models: selectedModels,
      isolate,
      ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}),
    }
    await launch.mutateAsync(request)
    setActiveTab('runs')
  }

  const openEntry = (entry: MultiRunEntry) => {
    if (!entry.sessionId) return
    onOpenChange(false)
    navigate(buildSessionPath(repoId, entry.sessionId, entry.isolated ? { repoTab: 'workspaces' } : undefined))
  }

  const confirmDiscard = () => {
    if (!pendingDiscard) return
    discard.mutate(
      { runId: pendingDiscard.runId, entryId: pendingDiscard.entryId },
      { onSuccess: () => setPendingDiscard(null) },
    )
  }

  const runs = runsQuery.data ?? []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen keyboardAware className="sm:max-w-3xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
          <DialogHeader className="p-4 sm:p-6 border-b shrink-0">
            <DialogTitle>Multi-run</DialogTitle>
            <DialogDescription>
              Run one prompt on up to {MULTI_RUN_MAX_MODELS} models at once, each in its own session.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <div className="px-4 sm:px-6 pt-3 shrink-0">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="launch">Launch</TabsTrigger>
                <TabsTrigger value="runs">Runs</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="launch" className="flex-1 overflow-y-auto p-4 sm:p-6 mt-0 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="multi-run-name">Group name</Label>
                <Input
                  id="multi-run-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Sweep"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="multi-run-prompt">Prompt</Label>
                <Textarea
                  id="multi-run-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="The prompt to send to every model"
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Models</Label>
                  <span className="text-xs text-muted-foreground">
                    {selectedModels.length}/{MULTI_RUN_MAX_MODELS} selected
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  <ModelCheckboxList
                    providers={modelGroups}
                    selectedModels={selectedModels}
                    onToggle={toggleModel}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="multi-run-isolate">Isolate runs</Label>
                  <p className="text-xs text-muted-foreground">Give each model its own workspace.</p>
                </div>
                <Switch id="multi-run-isolate" checked={isolate} onCheckedChange={setIsolate} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="multi-run-base-ref">Start from</Label>
                <Input
                  id="multi-run-base-ref"
                  value={baseRef}
                  onChange={(event) => setBaseRef(event.target.value)}
                  placeholder="Current HEAD"
                />
                <p className="text-xs text-muted-foreground">Branch or ref. Empty starts from the current HEAD.</p>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => { void handleLaunch() }} disabled={!canSubmit}>
                  {launch.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Launching...
                    </>
                  ) : (
                    'Launch'
                  )}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="runs" className="flex-1 overflow-y-auto p-4 sm:p-6 mt-0 space-y-4">
              {runsQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : runsQuery.error ? (
                <p className="text-sm text-destructive">
                  {runsQuery.error instanceof Error ? runsQuery.error.message : 'Failed to load runs'}
                </p>
              ) : runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs yet.</p>
              ) : (
                runs.map((run) => (
                  <div key={run.id} className="rounded-md border border-border">
                    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                      <span className="truncate text-sm font-medium">{run.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {run.entries.length} model{run.entries.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="divide-y divide-border">
                      {run.entries.map((entry) => (
                        <div key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-sm">{entry.model}</span>
                          <EntryStatus entry={entry} />
                          {entry.status === 'failed' && entry.error ? (
                            <span className="w-full text-xs text-destructive">{entry.error}</span>
                          ) : null}
                          <div className="flex items-center gap-1">
                            {entry.sessionId ? (
                              <Button variant="ghost" size="sm" onClick={() => openEntry(entry)}>
                                <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
                                Open
                              </Button>
                            ) : null}
                            {entry.status === 'started' || entry.status === 'failed' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() =>
                                  setPendingDiscard({
                                    runId: run.id,
                                    entryId: entry.id,
                                    model: entry.model,
                                    isolated: entry.isolated,
                                  })
                                }
                              >
                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                Discard
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={pendingDiscard !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDiscard(null)
        }}
        onConfirm={confirmDiscard}
        onCancel={() => setPendingDiscard(null)}
        title="Discard run"
        description={
          pendingDiscard?.isolated
            ? 'Discard this run and remove its workspace directory? This action cannot be undone.'
            : 'Discard this run? This action cannot be undone.'
        }
        warning={pendingDiscard?.model}
        confirmLabel="Discard"
        pendingLabel="Discarding..."
        isPending={discard.isPending}
      />
    </>
  )
}

interface ModelCheckboxListProps {
  providers: ProviderWithModels[]
  selectedModels: string[]
  onToggle: (value: string, checked: boolean) => void
}

const ModelCheckboxList = memo(function ModelCheckboxList({
  providers,
  selectedModels,
  onToggle,
}: ModelCheckboxListProps) {
  if (providers.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">No models available.</p>
  }

  return (
    <>
      {providers.map((provider) => (
        <div key={provider.id} className="p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{formatProviderName(provider)}</p>
          {provider.models.map((model) => {
            const value = providerModelRef(provider, model)
            const checked = selectedModels.includes(value)
            const atCapacity = selectedModels.length >= MULTI_RUN_MAX_MODELS && !checked
            return (
              <label key={value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label={formatModelName(model)}
                  checked={checked}
                  disabled={atCapacity}
                  onCheckedChange={(next) => onToggle(value, next === true)}
                />
                <span className="truncate">{formatModelName(model)}</span>
              </label>
            )
          })}
        </div>
      ))}
    </>
  )
})

function EntryStatus({ entry }: { entry: MultiRunEntry }) {
  if (entry.status === 'started' && entry.sessionId) {
    return (
      <div className="flex items-center gap-2">
        <SessionStatusIndicator sessionID={entry.sessionId} size="sm" />
        <Badge variant="secondary">{STATUS_LABELS[entry.status]}</Badge>
      </div>
    )
  }

  const variant = entry.status === 'failed' ? 'destructive' : entry.status === 'discarded' ? 'outline' : 'secondary'
  return <Badge variant={variant}>{STATUS_LABELS[entry.status]}</Badge>
}

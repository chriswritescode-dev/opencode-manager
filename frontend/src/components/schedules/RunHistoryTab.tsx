import type { ScheduleJob, ScheduleRun } from '@opencode-manager/shared/types'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScheduleRunMarkdown } from '@/components/schedules/ScheduleRunMarkdown'
import { getRunTone } from '@/components/schedules/schedule-utils'
import { Ban, CheckCircle2, ChevronDown, History, Loader2, XCircle } from 'lucide-react'

interface RunHistoryTabProps {
  repoId: number
  selectedJob: ScheduleJob | undefined
  runs: ScheduleRun[] | undefined
  runsLoading: boolean
  selectedRunId: number | null
  onSelectRun: (id: number) => void
  activeRun: ScheduleRun | null
  selectedRunLoading: boolean
  onCancelRun: () => void
  cancelRunPending: boolean
}

interface RunDetailPanelProps {
  repoId: number
  activeRun: ScheduleRun | null
  selectedRunLoading: boolean
  onCancelRun: () => void
  cancelRunPending: boolean
}

function RunDetailPanel({ repoId, activeRun, selectedRunLoading, onCancelRun, cancelRunPending }: RunDetailPanelProps) {
  const navigate = useNavigate()

  if (selectedRunLoading && !activeRun) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!activeRun) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a run to inspect logs and output.</div>
  }

  return (
    <Tabs key={`${activeRun.id}-${String(activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log')}`} defaultValue={activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log'} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-center gap-2 px-2 py-1.5">
        <TabsList className="h-auto gap-0 rounded-none border-0 bg-transparent p-0">
          <TabsTrigger value="log" className="rounded-none border-b-2 border-transparent px-3 py-1.5 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">Log</TabsTrigger>
          <TabsTrigger value="response" disabled={!activeRun.responseText} className="rounded-none border-b-2 border-transparent px-3 py-1.5 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">Assistant Output</TabsTrigger>
          <TabsTrigger value="error" disabled={!activeRun.errorText} className="rounded-none border-b-2 border-transparent px-3 py-1.5 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">{activeRun.status === 'cancelled' ? 'Details' : 'Error'}</TabsTrigger>
        </TabsList>
      </div>
      {(activeRun.status === 'running' || activeRun.sessionId || activeRun.responseText) && (
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-2">
            {activeRun.sessionId && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/repos/${repoId}/sessions/${activeRun.sessionId}`)}>
                Open session
              </Button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onCancelRun} disabled={cancelRunPending || activeRun.status !== 'running'}>
            {cancelRunPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Cancel run
          </Button>
        </div>
      )}
      <TabsContent value="log" className="mt-0 min-h-0 flex-1 overflow-y-auto px-0 py-3 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
        {selectedRunLoading && !activeRun ? (
          <div className="flex items-center justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">{activeRun.logText ?? 'No log text captured.'}</pre>
        )}
      </TabsContent>
      <TabsContent value="response" className="mt-0 min-h-0 flex-1 flex flex-col overflow-hidden">
        {selectedRunLoading && !activeRun ? (
          <div className="flex items-center justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : activeRun.responseText ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-0 py-2 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
            <ScheduleRunMarkdown content={activeRun.responseText} />
          </div>
        ) : (
          <div className="p-3"><pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">No assistant output captured.</pre></div>
        )}
      </TabsContent>
      <TabsContent value="error" className="mt-0 min-h-0 flex-1 overflow-y-auto px-0 py-3 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
        {selectedRunLoading && !activeRun ? (
          <div className="flex items-center justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <pre className={`whitespace-pre-wrap break-words text-sm font-mono leading-6 ${activeRun.status === 'cancelled' ? 'text-muted-foreground' : 'text-red-300'}`}>{activeRun.errorText ?? 'No error recorded.'}</pre>
        )}
      </TabsContent>
    </Tabs>
  )
}

export function RunHistoryTab({
  repoId,
  selectedJob,
  runs,
  runsLoading,
  selectedRunId,
  onSelectRun,
  activeRun,
  selectedRunLoading,
  onCancelRun,
  cancelRunPending,
}: RunHistoryTabProps) {
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null)


  function getRunStatusIcon(status: ScheduleRun['status']) {
    if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
    if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-400" />
    if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
    return <Ban className="h-3.5 w-3.5 text-muted-foreground" />
  }

  function handleCardClick(runId: number) {
    if (expandedRunId === runId) {
      setExpandedRunId(null)
    } else {
      setExpandedRunId(runId)
      onSelectRun(runId)
    }
  }

  if (!selectedJob) {
    if (selectedRunLoading) {
      return (
        <div className="flex min-h-0 flex-1 h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )
    }
    return (
      <div className="flex min-h-0 flex-1 h-full items-start">
        <Card className="max-w-3xl border-dashed border-border/70 w-full">
          <CardContent className="flex flex-col items-center p-8 sm:p-10 text-center">
            <History className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No job selected</p>
            <p className="mt-2 text-sm text-muted-foreground">Select a job from the Jobs tab to view its run history</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden pt-2 xl:gap-4 xl:grid xl:grid-cols-[320px_minmax(0,1fr)] xl:grid-rows-1">

        {/* Mobile: collapsible list (hidden on xl+) */}
        <div className="xl:hidden flex flex-col min-h-0 flex-1 h-full">
          <div className="min-h-0 flex-1 overflow-y-auto pt-4 pb-6 px-2 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
            {runsLoading ? (
              <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : runs?.length ? runs.map((run, index) => (
              <div
                key={run.id}
                className={`rounded-xl border overflow-hidden transition-all bg-card ${
                  expandedRunId === run.id
                    ? 'border-border/70'
                    : 'border-border/70'
                } ${index === 0 ? 'mt-0' : 'mt-2'}`}
              >
                <button
                  type="button"
                  onClick={() => handleCardClick(run.id)}
                  className="w-full px-3 py-2 text-left flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {getRunStatusIcon(run.status)}
                        <Badge className={getRunTone(run)}>{run.status}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{run.triggerSource}</span>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium leading-tight">
                      {run.sessionTitle ?? 'No session recorded'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</p>
                    {run.errorText && (
                      <p className="mt-0.5 truncate text-xs text-red-400/80">{run.errorText}</p>
                    )}
                  </div>
                  <ChevronDown className={`h-6 w-6 flex-shrink-0 text-muted-foreground transition-transform duration-200 self-start ${expandedRunId === run.id ? 'rotate-180' : ''}`} />
                </button>
                {expandedRunId === run.id && (
                  <div className="border-t border-border/60 flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
                      <RunDetailPanel
                        repoId={repoId}
                        activeRun={activeRun}
                        selectedRunLoading={selectedRunLoading}
                        onCancelRun={onCancelRun}
                        cancelRunPending={cancelRunPending}
                      />
                    </div>
                  </div>
                )}
              </div>
            )) : (
              <Alert>
                <History className="h-4 w-4" />
                <AlertTitle>No runs yet</AlertTitle>
                <AlertDescription>Use Run now to generate the first execution record and log bundle.</AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        {/* Desktop: original two-column layout (hidden below xl) */}
        <div className="hidden xl:block min-h-0 space-y-2 overflow-y-auto pr-1">
          {runsLoading ? (
            <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : runs?.length ? runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelectRun(run.id)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                selectedRunId === run.id
                  ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                  : 'border-border/70 bg-background/60 hover:bg-accent/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {getRunStatusIcon(run.status)}
                  <Badge className={getRunTone(run)}>{run.status}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">{run.triggerSource}</span>
              </div>
              <p className="mt-2 truncate text-sm font-medium leading-tight">
                {run.sessionTitle ?? 'No session recorded'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</p>
              {run.errorText && (
                <p className="mt-0.5 truncate text-xs text-red-400/80">{run.errorText}</p>
              )}
            </button>
          )) : (
            <Alert>
              <History className="h-4 w-4" />
              <AlertTitle>No runs yet</AlertTitle>
              <AlertDescription>Use Run now to generate the first execution record and log bundle.</AlertDescription>
            </Alert>
          )}
        </div>

        {/* Desktop: detail panel (hidden below xl) */}
        <div className="hidden xl:flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background/60 p-4">
          <RunDetailPanel
            repoId={repoId}
            activeRun={activeRun}
            selectedRunLoading={selectedRunLoading}
            onCancelRun={onCancelRun}
            cancelRunPending={cancelRunPending}
          />
        </div>

      </div>
    </div>
  )
}

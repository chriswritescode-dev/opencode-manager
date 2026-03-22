import type { ScheduleJob, ScheduleRun } from '@opencode-manager/shared/types'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScheduleRunMarkdown } from '@/components/schedules/ScheduleRunMarkdown'
import { getRunTone } from '@/components/schedules/schedule-utils'
import { History, Loader2, Square, TerminalSquare } from 'lucide-react'

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
  const navigate = useNavigate()

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
    <Card className="flex min-h-0 flex-1 flex-col border-border/70">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><TerminalSquare className="h-4 w-4" /> Run History</CardTitle>
        <CardDescription>Inspect manual and scheduled executions, including assistant output and session handoff.</CardDescription>
      </CardHeader>
      <CardContent className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)] xl:grid-rows-1 grid-rows-[minmax(0,180px)_minmax(0,1fr)]">
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {runsLoading ? (
            <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : runs?.length ? runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelectRun(run.id)}
              className={`w-full rounded-xl border-2 px-4 py-3 text-left transition-all ${
                selectedRunId === run.id
                  ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                  : 'border-border/70 bg-background/60 hover:bg-accent/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge className={getRunTone(run)}>{run.status}</Badge>
                <span className="text-xs text-muted-foreground">{run.triggerSource}</span>
              </div>
              <p className="mt-3 text-sm font-medium">{new Date(run.startedAt).toLocaleString()}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{run.sessionTitle ?? run.errorText ?? 'No session metadata recorded'}</p>
            </button>
          )) : (
            <Alert>
              <History className="h-4 w-4" />
              <AlertTitle>No runs yet</AlertTitle>
              <AlertDescription>Use Run now to generate the first execution record and log bundle.</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background/60 p-4">
          {activeRun ? (
            <Tabs key={`${activeRun.id}-${String(activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log')}`} defaultValue={activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log'} className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {activeRun.status === 'running' && (
                  <Button variant="outline" size="sm" onClick={onCancelRun} disabled={cancelRunPending}>
                    {cancelRunPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                    Cancel run
                  </Button>
                )}
                {activeRun.sessionId && (
                  <Button variant="outline" size="sm" onClick={() => navigate(`/repos/${repoId}/sessions/${activeRun.sessionId}`)}>
                    Open session
                  </Button>
                )}
              </div>

              <TabsList>
                <TabsTrigger value="log">Log</TabsTrigger>
                <TabsTrigger value="response" disabled={!activeRun.responseText}>Assistant Output</TabsTrigger>
                <TabsTrigger value="error" disabled={!activeRun.errorText}>{activeRun.status === 'cancelled' ? 'Details' : 'Error'}</TabsTrigger>
              </TabsList>

              <TabsContent value="log" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                {selectedRunLoading && !activeRun ? (
                  <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">{activeRun.logText ?? 'No log text captured.'}</pre>
                )}
              </TabsContent>
              <TabsContent value="response" className="mt-4 min-h-0 flex-1 overflow-hidden">
                {selectedRunLoading && !activeRun ? (
                  <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : activeRun.responseText ? (
                  <Tabs defaultValue="preview" className="flex min-h-0 h-full flex-1 flex-col overflow-hidden">
                    <TabsList>
                      <TabsTrigger value="preview">Preview</TabsTrigger>
                      <TabsTrigger value="markdown">Markdown</TabsTrigger>
                    </TabsList>
                    <TabsContent value="preview" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                      <ScheduleRunMarkdown content={activeRun.responseText} />
                    </TabsContent>
                    <TabsContent value="markdown" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                      <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">{activeRun.responseText}</pre>
                    </TabsContent>
                  </Tabs>
                ) : (
                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">No assistant output captured.</pre>
                )}
              </TabsContent>
              <TabsContent value="error" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                {selectedRunLoading && !activeRun ? (
                  <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (
                  <pre className={`whitespace-pre-wrap break-words text-sm font-mono leading-6 ${activeRun.status === 'cancelled' ? 'text-muted-foreground' : 'text-red-300'}`}>{activeRun.errorText ?? 'No error recorded.'}</pre>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a run to inspect logs and output.</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

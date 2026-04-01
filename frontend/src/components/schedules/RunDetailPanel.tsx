import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleRunMarkdown } from '@/components/schedules/ScheduleRunMarkdown'
import { Loader2 } from 'lucide-react'
import type { ScheduleRun } from '@opencode-manager/shared/types'

interface RunDetailPanelProps {
  repoId: number
  activeRun: ScheduleRun | null
  selectedRunLoading: boolean
  onCancelRun: () => void
  cancelRunPending: boolean
}

export function RunDetailPanel({ repoId, activeRun, selectedRunLoading, onCancelRun, cancelRunPending }: RunDetailPanelProps) {
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

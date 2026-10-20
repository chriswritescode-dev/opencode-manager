import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { TTSButton } from '@/components/ui/tts-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleRunMarkdown } from '@/components/schedules/ScheduleRunMarkdown'
import { FileBrowserSheet } from '@/components/file-browser/FileBrowserSheet'
import { getRepo } from '@/api/repos'
import { createSessionWithContext } from '@/api/opencode'
import { getWorkspaceFilePath } from '@/lib/markdownLinks'
import { getServerSessionPath, getSessionPath } from '@/lib/navigation'
import { getRepoDisplayName } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import { useMarkScheduleRunViewed } from '@/hooks/useSchedules'
import { Loader2 } from 'lucide-react'
import type { ScheduleRun } from '@opencode-manager/shared/types'

interface RunDetailPanelProps {
  repoId: number | null
  serverId?: string
  activeRun: ScheduleRun | null
  selectedRunLoading: boolean
  onCancelRun: () => void
  cancelRunPending: boolean
}

export function RunDetailPanel({ repoId, serverId, activeRun, selectedRunLoading, onCancelRun, cancelRunPending }: RunDetailPanelProps) {
  const navigate = useNavigate()
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [openingSession, setOpeningSession] = useState(false)
  const { data: repo, isPending: repoPending, isError: repoError, refetch: refetchRepo } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
    enabled: repoId !== null,
  })
  const markRunViewed = useMarkScheduleRunViewed()
  const viewedRunIdRef = useRef<number | null>(null)

  const activeRunId = activeRun?.id ?? null
  const activeRunStatus = activeRun?.status ?? null
  const activeRunViewedAt = activeRun?.viewedAt ?? null

  useEffect(() => {
    if (activeRunId === null) return
    if (activeRunStatus !== 'completed' && activeRunStatus !== 'failed') return
    if (activeRunViewedAt !== null) return
    if (viewedRunIdRef.current === activeRunId) return
    viewedRunIdRef.current = activeRunId
    markRunViewed.mutate(activeRunId)
  }, [activeRunId, activeRunStatus, activeRunViewedAt, markRunViewed])

  const handleOpenLocalPath = (linkPath: string) => {
    if (!repo) return
    setSelectedFilePath(getWorkspaceFilePath(linkPath, {
      directory: activeRun?.worktreePath ?? repo.fullPath,
      repoFullPath: repo.fullPath,
      repoLocalPath: repo.localPath,
    }))
  }

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

  const { sessionId } = activeRun

  const opensNewRepoSession = Boolean(activeRun.runBranch) && !activeRun.worktreePath && activeRun.status !== 'running'

  const handleOpenSession = async () => {
    if (repoId === null) {
      if (sessionId && serverId) navigate(getServerSessionPath(serverId, sessionId))
      return
    }
    if (!opensNewRepoSession) {
      if (sessionId) navigate(getSessionPath(repoId, sessionId))
      return
    }
    if (!repo) return
    setOpeningSession(true)
    try {
      const session = await createSessionWithContext(
        { directory: repo.fullPath, title: `${activeRun.sessionTitle ?? 'Scheduled run'} (continued)` },
        buildRunContext(activeRun),
      )
      navigate(getSessionPath(repoId, session.id))
    } catch (error) {
      showToast.error(`Could not open a repository session for this run: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setOpeningSession(false)
    }
  }

  return (
    <>
      <Tabs key={`${activeRun.id}-${String(activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log')}`} defaultValue={activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log'} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
          <TabsList className="h-auto gap-0 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="log" className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">Log</TabsTrigger>
            <TabsTrigger value="response" disabled={!activeRun.responseText} className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">Assistant Output</TabsTrigger>
            <TabsTrigger value="error" disabled={!activeRun.errorText} className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">{activeRun.status === 'cancelled' ? 'Details' : 'Error'}</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 py-1">
            {activeRun.responseText && <TTSButton messageId={`schedule-run-${activeRun.id}`} content={activeRun.responseText} />}
            {(sessionId || opensNewRepoSession) && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { void handleOpenSession() }} disabled={openingSession || (opensNewRepoSession && !repo)}>
                {openingSession ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Open session
              </Button>
            )}
            {activeRun.status === 'running' && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancelRun} disabled={cancelRunPending}>
                {cancelRunPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Cancel run
              </Button>
            )}
          </div>
        </div>
        <TabsContent value="log" className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] xl:[mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
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
            <>
              {repoId !== null && repoPending && (
                <div role="status" className="px-3 pt-2 text-xs text-muted-foreground">Loading repository details for local links.</div>
              )}
              {repoId !== null && repoError && (
                <div role="alert" className="flex items-center gap-2 px-3 pt-2 text-xs text-destructive">
                  <span>Could not load repository details for local links.</span>
                  <Button variant="outline" size="sm" onClick={() => { void refetchRepo() }}>Retry</Button>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] xl:[mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
                <ScheduleRunMarkdown content={activeRun.responseText} onOpenLocalPath={handleOpenLocalPath} />
              </div>
            </>
          ) : (
            <div className="p-3"><pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">No assistant output captured.</pre></div>
          )}
        </TabsContent>
        <TabsContent value="error" className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] xl:[mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
          {selectedRunLoading && !activeRun ? (
            <div className="flex items-center justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <pre className={`whitespace-pre-wrap break-words text-sm font-mono leading-6 ${activeRun.status === 'cancelled' ? 'text-muted-foreground' : 'text-destructive'}`}>{activeRun.errorText ?? 'No error recorded.'}</pre>
          )}
        </TabsContent>
      </Tabs>
      <FileBrowserSheet
        isOpen={selectedFilePath !== null}
        onClose={() => setSelectedFilePath(null)}
        basePath={repo?.localPath}
        repoName={repo ? getRepoDisplayName(repo) : undefined}
        repoId={repoId ?? undefined}
        initialSelectedFile={selectedFilePath ?? undefined}
      />
    </>
  )
}

function buildRunContext(run: ScheduleRun): string {
  const finished = run.finishedAt ? ` and finished at ${new Date(run.finishedAt).toISOString()}` : ''
  const sections = [
    `Context from scheduled run #${run.id} "${run.sessionTitle ?? 'Scheduled run'}", which ${run.status === 'completed' ? 'completed' : `ended as ${run.status}`}${finished}.`,
    describeRunChanges(run),
    run.responseText ? `Run output:\n\n${run.responseText}` : 'The run produced no output.',
    run.errorText ? `Run error:\n\n${run.errorText}` : null,
  ]
  return sections.filter((section): section is string => section !== null).join('\n\n')
}

function describeRunChanges(run: ScheduleRun): string {
  if (run.runBranch && run.commitHash) {
    return `The run worked in a temporary worktree that has since been removed. Its changes were committed to branch \`${run.runBranch}\` at commit \`${run.commitHash}\`; they are not in this checkout unless that branch is checked out or merged.`
  }
  return 'The run worked in a temporary worktree that has since been removed and committed no changes.'
}

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, GitBranch, Loader2, RefreshCw } from 'lucide-react'
import {
  getVcsDiff,
  listVcsStatus,
  type VcsFileDiff,
  type VcsFileStatus,
} from '@/api/opencode'
import { FileDiffContent } from '@/components/file-browser/FileDiffView'
import { GitFlatFileList } from './GitFlatFileList'
import { SourceControlDialog } from './SourceControlPanel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { serverScopedKey } from '@/lib/serverScope'
import { useRefreshOnOpen } from '@/hooks/useRefreshOnOpen'
import { useMobile } from '@/hooks/useMobile'
import { useVcsInfo } from '@/hooks/useVcsInfo'
import { GIT_UI_COLORS } from '@/lib/git-status-styles'
import type { GitFileStatus } from '@/types/git'

type VcsMode = 'working' | 'branch'

const MODES: ReadonlyArray<{ id: VcsMode; label: string }> = [
  { id: 'working', label: 'Working changes' },
  { id: 'branch', label: 'Branch changes' },
]

interface RemoteSourceControlContentProps {
  serverId: string
  directory: string
  compact?: boolean
}

function toGitFileStatus(entry: VcsFileStatus | VcsFileDiff): GitFileStatus {
  return {
    path: entry.file,
    status: entry.status,
    staged: false,
    additions: entry.additions,
    deletions: entry.deletions,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load source control'
}

export function RemoteSourceControlContent({
  serverId,
  directory,
  compact = false,
}: RemoteSourceControlContentProps) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<VcsMode>('working')
  const [selectedFile, setSelectedFile] = useState<string | undefined>()

  const vcsKey = useMemo(
    () => serverScopedKey(['opencode', 'vcs', directory], serverId),
    [directory, serverId],
  )

  const infoQuery = useVcsInfo(directory, serverId)

  const statusQuery = useQuery({
    queryKey: [...vcsKey, 'status'],
    queryFn: () => listVcsStatus(directory, serverId),
    enabled: mode === 'working',
    retry: false,
  })

  const diffQuery = useQuery({
    queryKey: [...vcsKey, 'diff', mode],
    queryFn: () => getVcsDiff(directory, mode, serverId),
    enabled: mode === 'branch' || selectedFile !== undefined,
    retry: false,
  })

  const listQuery = mode === 'working' ? statusQuery : diffQuery
  const files = useMemo(
    () =>
      mode === 'working'
        ? (statusQuery.data ?? []).map(toGitFileStatus)
        : (diffQuery.data ?? []).map(toGitFileStatus),
    [mode, statusQuery.data, diffQuery.data],
  )

  const selectedDiff =
    selectedFile === undefined
      ? undefined
      : diffQuery.data?.find((entry) => entry.file === selectedFile)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: vcsKey, refetchType: 'none' })
    void infoQuery.refetch({ cancelRefetch: false })
    void (mode === 'working' ? statusQuery : diffQuery).refetch({ cancelRefetch: false })
    if (mode === 'working' && selectedFile !== undefined) {
      void diffQuery.refetch({ cancelRefetch: false })
    }
  }

  useRefreshOnOpen(true, refresh)

  const branch = infoQuery.data?.branch.current ?? infoQuery.data?.branch.default ?? 'unknown'
  const isRefreshing = infoQuery.isFetching || listQuery.isFetching || diffQuery.isFetching

  const selectMode = (next: VcsMode) => {
    if (next === mode) return
    setSelectedFile(undefined)
    setMode(next)
  }

  if (selectedFile !== undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedFile(undefined)}
            className="h-7 w-7 p-0"
            aria-label="Back to changed files"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {selectedFile}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          {diffQuery.isLoading ? (
            <div className="flex h-full items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : diffQuery.error ? (
            <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground">
              <FileText className="mb-2 h-8 w-8 opacity-50" />
              <p className="text-sm">Failed to load diff</p>
              <p className="text-xs mt-1">{errorMessage(diffQuery.error)}</p>
            </div>
          ) : (
            <FileDiffContent
              filePath={selectedFile}
              diff={selectedDiff?.patch ?? null}
              status={selectedDiff?.status ?? 'modified'}
              additions={selectedDiff?.additions ?? 0}
              deletions={selectedDiff?.deletions ?? 0}
              onBack={() => setSelectedFile(undefined)}
              isMobile={compact}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className={cn('h-4 w-4 shrink-0', GIT_UI_COLORS.current)} />
          <span className={cn('truncate text-sm font-medium', GIT_UI_COLORS.current)}>{branch}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={isRefreshing}
            className="h-7 w-7 p-0"
            aria-label="Refresh source control"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 border-b border-border">
        {MODES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => selectMode(entry.id)}
            aria-pressed={mode === entry.id}
            className={cn(
              'flex-1 whitespace-nowrap px-3 py-2 text-sm transition-colors border-b-2 -mb-px',
              mode === entry.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : listQuery.error ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center text-muted-foreground">
            <FileText className="h-8 w-8 opacity-50" />
            <div>
              <p className="text-sm">Failed to load changes</p>
              <p className="text-xs mt-1">{errorMessage(listQuery.error)}</p>
            </div>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-muted-foreground">
            <p className="text-sm">
              {mode === 'working' ? 'No working changes' : 'No branch changes'}
            </p>
          </div>
        ) : (
          <GitFlatFileList
            files={files}
            staged={false}
            onSelect={(path) => setSelectedFile(path)}
            readOnly
          />
        )}
      </div>
    </div>
  )
}

interface RemoteSourceControlPanelProps {
  serverId: string
  directory: string
  isOpen: boolean
  onClose: () => void
}

export function RemoteSourceControlPanel({
  serverId,
  directory,
  isOpen,
  onClose,
}: RemoteSourceControlPanelProps) {
  const isMobile = useMobile()

  return (
    <SourceControlDialog isOpen={isOpen} onClose={onClose} title="Source Control">
      <RemoteSourceControlContent serverId={serverId} directory={directory} compact={isMobile} />
    </SourceControlDialog>
  )
}

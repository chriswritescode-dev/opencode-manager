import { useState } from 'react'
import { FetchError } from '@opencode-manager/shared'
import { useGitStatus, getApiErrorMessage } from '@/api/git'

import { useGit } from '@/hooks/useGit'
import { ChangesTab } from './ChangesTab'
import { CommitsTab } from './CommitsTab'
import { BranchesTab } from './BranchesTab'
import { GitErrorBanner } from './GitErrorBanner'
import { FileDiffView } from '@/components/file-browser/FileDiffView'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GIT_UI_COLORS } from '@/lib/git-status-styles'
import {
  Loader2,
  GitBranch,
  FileCode,
  History,
  Upload,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  ArrowDownFromLine,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobile } from '@/hooks/useMobile'

interface SourceControlPanelProps {
  repoId: number
  isOpen: boolean
  onClose: () => void
  currentBranch: string
  repoUrl?: string | null
  isRepoWorktree?: boolean
  repoName?: string
}

type Tab = 'changes' | 'commits' | 'branches'

export function SourceControlPanel({
  repoId,
  isOpen,
  onClose,
  currentBranch,
  repoUrl,
  isRepoWorktree,
  repoName,
}: SourceControlPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('changes')
  const [selectedFile, setSelectedFile] = useState<{path: string, staged: boolean} | undefined>()
  const [gitError, setGitError] = useState<{ summary: string; detail?: string } | null>(null)
  const { data: status } = useGitStatus(repoId)
  const isMobile = useMobile()

  const handleGitError = (error: unknown) => {
    if (error instanceof FetchError) {
      setGitError({ summary: getApiErrorMessage(error), detail: error.detail })
    } else {
      setGitError({ summary: getApiErrorMessage(error) })
    }
  }

  const git = useGit(repoId, handleGitError)

  const handleGitAction = async (action: () => Promise<unknown>) => {
    try {
      setGitError(null)
      await action()
    } catch {
      // error already handled by useGit's onError -> handleGitError
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'changes', label: 'Changes', icon: FileCode },
    { id: 'commits', label: 'Commits', icon: History },
    { id: 'branches', label: 'Branches', icon: GitBranch },
  ]

  const changesCount = status?.files.length || 0
  const stagedCount = status?.files.filter(f => f.staged).length || 0

  const content = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">{currentBranch}</span>
          </div>
          {status && (status.ahead > 0 || status.behind > 0) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {status.ahead > 0 && (
                <span className={`flex items-center gap-0.5 ${GIT_UI_COLORS.ahead}`}>
                  <ArrowUp className="w-3 h-3" />{status.ahead}
                </span>
              )}
              {status.behind > 0 && (
                <span className={`flex items-center gap-0.5 ${GIT_UI_COLORS.behind}`}>
                  <ArrowDown className="w-3 h-3" />{status.behind}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleGitAction(() => git.fetch.mutateAsync())}
            disabled={git.fetch.isPending}
            className="h-7 w-7 p-0"
            title="Fetch from remote"
          >
            {git.fetch.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleGitAction(() => git.pull.mutateAsync())}
            disabled={git.pull.isPending}
            className="h-7 w-7 p-0"
            title="Pull"
          >
            {git.pull.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowDownFromLine className="w-4 h-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleGitAction(() => git.push.mutateAsync(undefined))}
            disabled={git.push.isPending}
            className="h-7 w-7 p-0"
            title="Push"
          >
            {git.push.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {gitError && (
        <GitErrorBanner error={gitError} onDismiss={() => setGitError(null)} />
      )}

      <div className="flex border-b border-border flex-shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.id === 'changes' && changesCount > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent">
                  {stagedCount > 0 ? `${stagedCount}/${changesCount}` : changesCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className={cn('flex-1 min-h-0', isMobile ? 'flex flex-col' : 'flex')}>
        <div className={cn(
          'overflow-hidden',
          isMobile ? 'flex-1' : selectedFile ? 'w-[35%] border-r border-border' : 'flex-1'
        )}>
          {activeTab === 'changes' && (
            <ChangesTab
              repoId={repoId}
              onFileSelect={(path, staged) => setSelectedFile({ path, staged })}
              selectedFile={selectedFile}
              isMobile={isMobile}
              onError={handleGitError}
            />
          )}
          {activeTab === 'commits' && (
            <CommitsTab repoId={repoId} />
          )}
          {activeTab === 'branches' && (
            <BranchesTab repoId={repoId} currentBranch={currentBranch} repoUrl={repoUrl} isRepoWorktree={isRepoWorktree} />
          )}
        </div>

        {selectedFile && !isMobile && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-sm font-medium truncate">{selectedFile.path}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setSelectedFile(undefined)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto">
              <FileDiffView repoId={repoId} filePath={selectedFile.path} includeStaged={selectedFile.staged} />
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        mobileFullscreen
        hideCloseButton={isMobile}
        className={cn(
          'p-0 flex flex-col bg-card border-border',
          isMobile ? 'h-full' : 'w-[90vw] sm:max-w-6xl h-[90vh]'
        )}
      >
        <DialogHeader className={cn(
          'px-4 py-3 border-b border-border flex-shrink-0',
          isMobile && 'relative'
        )}>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            {isMobile && repoName ? repoName : 'Source Control'}
          </DialogTitle>
          {isMobile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 p-0"
            >
              <X className="h-6 w-6" />
            </Button>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {content}
        </div>
      </DialogContent>
    </Dialog>
  )
}

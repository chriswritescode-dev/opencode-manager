import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useGitStatus, getApiErrorMessage } from '@/api/git'
import { listBranches, switchBranch } from '@/api/repos'
import { useGit } from '@/hooks/useGit'
import { ChangesTab } from './ChangesTab'
import { CommitsTab } from './CommitsTab'
import { BranchesTab } from './BranchesTab'
import { FileDiffView } from '@/components/file-browser/FileDiffView'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  Loader2,
  GitBranch,
  FileCode,
  History,
  Download,
  Upload,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  ChevronDown,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobile } from '@/hooks/useMobile'
import { showToast } from '@/lib/toast'

interface SourceControlPanelProps {
  repoId: number
  isOpen: boolean
  onClose: () => void
  currentBranch: string
}

type Tab = 'changes' | 'commits' | 'branches'

export function SourceControlPanel({
  repoId,
  isOpen,
  onClose,
  currentBranch,
}: SourceControlPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('changes')
  const [selectedFile, setSelectedFile] = useState<string | undefined>()
  const { data: status } = useGitStatus(repoId)
  const { data: branches } = useQuery({
    queryKey: ['branches', repoId],
    queryFn: () => listBranches(repoId),
    staleTime: 30000,
  })
  const git = useGit(repoId)
  const queryClient = useQueryClient()
  const isMobile = useMobile()

  const switchBranchMutation = useMutation({
    mutationFn: (branch: string) => switchBranch(repoId, branch),
    onSuccess: (updatedRepo) => {
      queryClient.setQueryData(['repo', repoId], updatedRepo)
      queryClient.invalidateQueries({ queryKey: ['repos'] })
      queryClient.invalidateQueries({ queryKey: ['gitStatus', repoId] })
      queryClient.invalidateQueries({ queryKey: ['branches', repoId] })
    },
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
  })

  const handleGitAction = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (error: unknown) {
      const message = getApiErrorMessage(error)
      showToast.error(message)
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 hover:bg-accent/50 rounded px-1 py-0.5 transition-colors">
                <GitBranch className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{currentBranch}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {branches?.all?.map((branch) => (
                <DropdownMenuItem
                  key={branch}
                  onClick={() => branch !== currentBranch && switchBranchMutation.mutate(branch)}
                  disabled={branch === currentBranch || switchBranchMutation.isPending}
                  className="flex items-center gap-2"
                >
                  <GitBranch className="w-4 h-4" />
                  <span className="flex-1 truncate">{branch}</span>
                  {branch === currentBranch && <Check className="w-4 h-4 text-green-500" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {status && (status.ahead > 0 || status.behind > 0) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {status.ahead > 0 && (
                <span className="flex items-center gap-0.5 text-green-500">
                  <ArrowUp className="w-3 h-3" />{status.ahead}
                </span>
              )}
              {status.behind > 0 && (
                <span className="flex items-center gap-0.5 text-yellow-500">
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
            title="Fetch"
          >
            {git.fetch.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
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
              <ArrowUpDown className="w-4 h-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleGitAction(() => git.push.mutateAsync())}
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
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30'
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
          isMobile ? 'flex-1' : selectedFile ? 'w-[40%] border-r border-border' : 'flex-1'
        )}>
          {activeTab === 'changes' && (
            <ChangesTab
              repoId={repoId}
              onFileSelect={setSelectedFile}
              selectedFile={selectedFile}
            />
          )}
          {activeTab === 'commits' && (
            <CommitsTab repoId={repoId} />
          )}
          {activeTab === 'branches' && (
            <BranchesTab repoId={repoId} currentBranch={currentBranch} />
          )}
        </div>

        {selectedFile && !isMobile && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-sm font-medium truncate">{selectedFile}</span>
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
              <FileDiffView repoId={repoId} filePath={selectedFile} />
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
        className={cn(
          'p-0 flex flex-col',
          isMobile ? 'h-[85vh]' : 'w-[600px] sm:max-w-[600px]'
        )}
      >
        <DialogHeader className="px-4 py-3 border-b border-border flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Source Control
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {content}
        </div>
      </DialogContent>
    </Dialog>
  )
}

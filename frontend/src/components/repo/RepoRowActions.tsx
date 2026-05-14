import { useState } from 'react'
import { Loader2, GitBranch, GitBranchPlus, Download, Trash2, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SourceControlPanel } from '@/components/source-control/SourceControlPanel'
import { DownloadDialog } from '@/components/ui/download-dialog'
import { CreateWorktreeDialog } from '@/components/repo/CreateWorktreeDialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { downloadRepo } from '@/api/repos'
import { showToast } from '@/lib/toast'
import { getRepoDisplayName } from '@/lib/utils'

interface RepoRowActionsProps {
  repo: {
    id: number
    repoUrl?: string | null
    localPath?: string
    sourcePath?: string
    branch?: string
    currentBranch?: string
    cloneStatus: string
    isWorktree?: boolean
    isLocal?: boolean
    fullPath?: string
  }
  gitStatus?: {
    branch: string
    ahead: number
    behind: number
  }
  onDelete: (id: number) => void
  isDeleting: boolean
  isMobile: boolean
  onActionsOpenChange?: (isOpen: boolean) => void
}

export function RepoRowActions({
  repo,
  gitStatus,
  onDelete,
  isDeleting,
  isMobile,
  onActionsOpenChange,
}: RepoRowActionsProps) {
  const [showDownloadDialog, setShowDownloadDialog] = useState(false)
  const [showSourceControl, setShowSourceControl] = useState(false)
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false)

  const repoName = getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath)
  const branchToDisplay = gitStatus?.branch || repo.currentBranch || repo.branch
  const isReady = repo.cloneStatus === 'ready'

  const handleSourceControlOpen = (open: boolean) => {
    setShowSourceControl(open)
    onActionsOpenChange?.(open)
  }

  const handleDownloadDialogOpen = (open: boolean) => {
    setShowDownloadDialog(open)
    onActionsOpenChange?.(open)
  }

  const handleWorktreeDialogOpen = (open: boolean) => {
    setShowWorktreeDialog(open)
    onActionsOpenChange?.(open)
  }

  const canCreateWorktree = isReady && !repo.isWorktree && Boolean(repo.repoUrl)
  const deleteLabel = repo.isLocal ? 'Unlink Repository' : 'Delete Repository'

  const handleDownload = async (options: { includeGit?: boolean; includePaths?: string[] }) => {
    try {
      await downloadRepo(repo.id, repoName, options)
      showToast.success('Download complete')
    } catch (error: unknown) {
      showToast.error(error instanceof Error ? error.message : 'Download failed')
    }
  }

  if (isMobile) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Repository actions"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              title="Repository actions"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="z-[200]"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              onClick={() => handleSourceControlOpen(true)}
              disabled={!isReady}
            >
              <GitBranch className="w-4 h-4 mr-2" />
              Source Control
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleDownloadDialogOpen(true)}
              disabled={!isReady}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(repo.id)}
              disabled={isDeleting}
              className="text-destructive"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              {repo.isLocal ? 'Unlink' : 'Delete'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <SourceControlPanel
          repoId={repo.id}
          isOpen={showSourceControl}
          onClose={() => {
            setShowSourceControl(false)
            onActionsOpenChange?.(false)
          }}
          currentBranch={branchToDisplay || ''}
          repoName={repoName}
        />
        <DownloadDialog
          open={showDownloadDialog}
          onOpenChange={(open) => {
            setShowDownloadDialog(open)
            onActionsOpenChange?.(open)
          }}
          onDownload={handleDownload}
          title="Download Repository"
          description="This will create a ZIP archive of the entire repository."
          itemName={repoName}
          targetPath={repo.fullPath}
        />
      </>
    )
  }

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Source Control"
                size="sm"
                variant="ghost"
                onClick={() => handleSourceControlOpen(true)}
                disabled={!isReady}
                className="h-8 w-8 p-0"
                title="Source Control"
              >
                <GitBranch className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Source Control</TooltipContent>
          </Tooltip>

          {canCreateWorktree && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Create Worktree"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleWorktreeDialogOpen(true)}
                  className="h-8 w-8 p-0"
                  title="Create Worktree"
                >
                  <GitBranchPlus className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Create Worktree</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Download Repository"
                size="sm"
                variant="ghost"
                onClick={() => handleDownloadDialogOpen(true)}
                disabled={!isReady}
                className="h-8 w-8 p-0"
                title="Download Repository"
              >
                <Download className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download Repository</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={deleteLabel}
                size="sm"
                variant="ghost"
                onClick={() => onDelete(repo.id)}
                disabled={isDeleting}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                title={deleteLabel}
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{deleteLabel}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      <SourceControlPanel
        repoId={repo.id}
        isOpen={showSourceControl}
        onClose={() => { setShowSourceControl(false); onActionsOpenChange?.(false); }}
        currentBranch={branchToDisplay || ''}
        repoName={repoName}
      />
      <DownloadDialog
        open={showDownloadDialog}
        onOpenChange={(open) => { setShowDownloadDialog(open); onActionsOpenChange?.(open); }}
        onDownload={handleDownload}
        title="Download Repository"
        description="This will create a ZIP archive of the entire repository."
        itemName={repoName}
        targetPath={repo.fullPath}
      />
      <CreateWorktreeDialog
        open={showWorktreeDialog}
        onOpenChange={handleWorktreeDialogOpen}
        repoId={repo.id}
        repoUrl={repo.repoUrl}
        defaultBaseBranch={branchToDisplay}
      />
    </>
  )
}

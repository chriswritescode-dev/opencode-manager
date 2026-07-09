import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Loader2, GitBranch, GitBranchPlus, Download, Trash2, MoreVertical, Pencil } from 'lucide-react'
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
import { RenameRepoDialog } from '@/components/repo/RenameRepoDialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { downloadRepo, renameRepo } from '@/api/repos'
import { showToast } from '@/lib/toast'
import { getRepoDisplayName } from '@/lib/utils'
import { invalidateRepoListCaches } from '@/lib/queryInvalidation'

interface RepoRowActionsProps {
  repo: {
    id: number
    name?: string | null
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
  const { t } = useTranslation()
  const [showDownloadDialog, setShowDownloadDialog] = useState(false)
  const [showSourceControl, setShowSourceControl] = useState(false)
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)

  const repoName = getRepoDisplayName(repo)
  const branchToDisplay = gitStatus?.branch || repo.currentBranch || repo.branch
  const isReady = repo.cloneStatus === 'ready'

  const queryClient = useQueryClient()
  const renameMutation = useMutation({
    mutationFn: (name: string | null) => renameRepo(repo.id, name),
    onSuccess: (updated) => {
      invalidateRepoListCaches(queryClient)
      queryClient.setQueryData(['repo', repo.id], updated)
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      queryClient.invalidateQueries({ queryKey: ['all-schedule-runs'] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', repo.id] })
      showToast.success(t('repo.repositoryRenamed'))
    },
    onError: (error: unknown) => {
      showToast.error(error instanceof Error ? error.message : t('repo.renameFailed'))
    },
  })

  const handleSourceControlOpen = (open: boolean) => {
    setShowSourceControl(open)
    onActionsOpenChange?.(open)
  }

  const handleRenameOpen = (open: boolean) => {
    setShowRenameDialog(open)
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
  const deleteLabel = repo.isLocal ? t('repo.unlinkRepo') : t('repo.deleteRepo')

  const handleDownload = async (options: { includeGit?: boolean; includePaths?: string[] }) => {
    try {
      await downloadRepo(repo.id, repoName, options)
      showToast.success(t('repo.downloadComplete'))
    } catch (error: unknown) {
      showToast.error(error instanceof Error ? error.message : t('repo.downloadFailed'))
    }
  }

  if (isMobile) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t('repo.actions')}
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              title={t('repo.actions')}
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
              {t('repo.sourceControl')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleRenameOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              {t('repo.renameAction')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleDownloadDialogOpen(true)}
              disabled={!isReady}
            >
              <Download className="w-4 h-4 mr-2" />
              {t('repo.downloadAction')}
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
              {repo.isLocal ? t('repo.unlink') : t('repo.delete')}
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
          title={t('repo.download')}
          description={t('repo.download')}
          itemName={repoName}
          targetPath={repo.fullPath}
        />
        <RenameRepoDialog
          isOpen={showRenameDialog}
          currentName={repo.name ?? ''}
          derivedName={repoName}
          onClose={() => handleRenameOpen(false)}
          onSave={(name) => renameMutation.mutate(name)}
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
                aria-label={t('tooltip.rename')}
                size="sm"
                variant="ghost"
                onClick={() => handleRenameOpen(true)}
                className="h-8 w-8 p-0"
                title={t('tooltip.rename')}
              >
                <Pencil className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('tooltip.rename')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('tooltip.sourceControl')}
                size="sm"
                variant="ghost"
                onClick={() => handleSourceControlOpen(true)}
                disabled={!isReady}
                className="h-8 w-8 p-0"
                title={t('tooltip.sourceControl')}
              >
                <GitBranch className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('tooltip.sourceControl')}</TooltipContent>
          </Tooltip>

          {canCreateWorktree && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('tooltip.createWorktree')}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleWorktreeDialogOpen(true)}
                  className="h-8 w-8 p-0"
                  title={t('tooltip.createWorktree')}
                >
                  <GitBranchPlus className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('tooltip.createWorktree')}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('tooltip.downloadRepo')}
                size="sm"
                variant="ghost"
                onClick={() => handleDownloadDialogOpen(true)}
                disabled={!isReady}
                className="h-8 w-8 p-0"
                title={t('tooltip.downloadRepo')}
              >
                <Download className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('tooltip.downloadRepo')}</TooltipContent>
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
        title={t('repo.download')}
        description={t('repo.download')}
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
      <RenameRepoDialog
        isOpen={showRenameDialog}
        currentName={repo.name ?? ''}
        derivedName={repoName}
        onClose={() => handleRenameOpen(false)}
        onSave={(name) => renameMutation.mutate(name)}
      />
    </>
  )
}

import { useState } from 'react'
import { useGitStatus, getApiErrorMessage } from '@/api/git'
import { useGit } from '@/hooks/useGit'
import { GitFlatFileList } from './GitFlatFileList'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, GitCommit, FileText, AlertCircle, X } from 'lucide-react'

interface ChangesTabProps {
  repoId: number
  onFileSelect: (path: string) => void
  selectedFile?: string
}

export function ChangesTab({ repoId, onFileSelect, selectedFile }: ChangesTabProps) {
  const { data: status, isLoading, error } = useGitStatus(repoId)
  const git = useGit(repoId)
  const [commitMessage, setCommitMessage] = useState('')
  const [apiError, setApiError] = useState<string | null>(null)

  const stagedFiles = status?.files.filter(f => f.staged) || []
  const unstagedFiles = status?.files.filter(f => !f.staged) || []
  const canCommit = commitMessage.trim() && stagedFiles.length > 0 && !git.commit.isPending

  const handleGitAction = async (action: () => Promise<unknown>) => {
    try {
      setApiError(null)
      await action()
    } catch (error: unknown) {
      const message = getApiErrorMessage(error)
      setApiError(message)
    }
  }

  const handleStage = (paths: string[]) => {
    handleGitAction(() => git.stageFiles.mutateAsync(paths))
  }

  const handleUnstage = (paths: string[]) => {
    handleGitAction(() => git.unstageFiles.mutateAsync(paths))
  }

  const handleCommit = () => {
    handleGitAction(async () => {
      await git.commit.mutateAsync({ message: commitMessage.trim() })
      setCommitMessage('')
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Failed to load git status</p>
        <p className="text-xs mt-1">{error.message}</p>
      </div>
    )
  }

  if (!status) return null

  return (
    <div className="flex flex-col h-full">
      {apiError && (
        <div className="mx-3 mt-3 p-2 rounded border bg-destructive/10 border-destructive/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
          <span className="text-sm text-destructive flex-1">{apiError}</span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setApiError(null)}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {status.hasChanges ? (
          <>
            {stagedFiles.length > 0 && (
              <GitFlatFileList
                files={status.files}
                staged={true}
                onFileSelect={onFileSelect}
                onUnstage={handleUnstage}
                selectedFile={selectedFile}
              />
            )}

            {unstagedFiles.length > 0 && (
              <GitFlatFileList
                files={status.files}
                staged={false}
                onFileSelect={onFileSelect}
                onStage={handleStage}
                selectedFile={selectedFile}
              />
            )}
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No uncommitted changes</p>
          </div>
        )}
      </div>

      {status.hasChanges && (
        <div className="p-3 border-t border-border space-y-2 flex-shrink-0">
          <Textarea
            placeholder="Commit message..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            className="min-h-[80px] text-sm resize-none"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) {
                handleCommit()
              }
            }}
          />
          <Button
            onClick={handleCommit}
            disabled={!canCommit}
            className="w-full h-9"
          >
            {git.commit.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <GitCommit className="w-4 h-4 mr-2" />
            )}
            Commit {stagedFiles.length > 0 && `(${stagedFiles.length} staged)`}
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to commit
          </p>
        </div>
      )}
    </div>
  )
}

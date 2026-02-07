import { useState } from 'react'
import { useGitStatus, getApiErrorMessage } from '@/api/git'
import { useGit } from '@/hooks/useGit'
import { GitFlatFileList } from './GitFlatFileList'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { FileDiffView } from '@/components/file-browser/FileDiffView'
import { Loader2, GitCommit, FileText, AlertCircle, X } from 'lucide-react'

interface ChangesTabProps {
  repoId: number
  onFileSelect: (path: string, staged: boolean) => void
  selectedFile?: {path: string, staged: boolean}
  isMobile: boolean
}

export function ChangesTab({ repoId, onFileSelect, selectedFile, isMobile }: ChangesTabProps) {
  const { data: status, isLoading, error } = useGitStatus(repoId)
  const git = useGit(repoId)
  const [commitMessage, setCommitMessage] = useState('')
  const [apiError, setApiError] = useState<string | null>(null)
  const [discardConfirm, setDiscardConfirm] = useState<{
    open: boolean
    paths: string[]
    staged: boolean
  }>({ open: false, paths: [], staged: false })

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

  const handleDiscard = (paths: string[], staged: boolean) => {
    if (paths.length === 1) {
      setDiscardConfirm({ open: true, paths, staged })
    } else {
      setDiscardConfirm({ open: true, paths, staged })
    }
  }

  const handleConfirmDiscard = () => {
    handleGitAction(async () => {
      await git.discardFiles.mutateAsync({ paths: discardConfirm.paths, staged: discardConfirm.staged })
      setDiscardConfirm({ open: false, paths: [], staged: false })
    })
  }

  const handleCancelDiscard = () => {
    setDiscardConfirm({ open: false, paths: [], staged: false })
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

  if (isMobile && selectedFile) {
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

        <Tabs defaultValue="files" className="flex flex-col h-full">
          <TabsList className="flex-shrink-0">
            <TabsTrigger value="files">Files ({stagedFiles.length + unstagedFiles.length})</TabsTrigger>
            <TabsTrigger value="diff">{selectedFile.path.split('/').pop() || selectedFile.path}</TabsTrigger>
          </TabsList>

          <TabsContent value="files" className="flex-1 overflow-hidden mt-0">
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {status.hasChanges ? (
                  <>
                    {stagedFiles.length > 0 && (
                      <GitFlatFileList
                        files={stagedFiles}
                        staged={true}
                        onSelect={onFileSelect}
                        onUnstage={handleUnstage}
                        onDiscard={handleDiscard}
                        selectedFile={selectedFile?.path}
                      />
                    )}

                    {unstagedFiles.length > 0 && (
                      <GitFlatFileList
                        files={unstagedFiles}
                        staged={false}
                        onSelect={onFileSelect}
                        onStage={handleStage}
                        onDiscard={handleDiscard}
                        selectedFile={selectedFile?.path}
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
                    className="min-h-[80px] md:text-sm resize-none"
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
          </TabsContent>

          <TabsContent value="diff" className="flex-1 overflow-hidden mt-0">
            <FileDiffView repoId={repoId} filePath={selectedFile.path} includeStaged={selectedFile.staged} />
          </TabsContent>
        </Tabs>
      </div>
    )
  } else {
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
                  files={stagedFiles}
                  staged={true}
                  onSelect={onFileSelect}
                  onUnstage={handleUnstage}
                  onDiscard={handleDiscard}
                  selectedFile={selectedFile?.path}
                />
              )}

              {unstagedFiles.length > 0 && (
                <GitFlatFileList
                  files={unstagedFiles}
                  staged={false}
                  onSelect={onFileSelect}
                  onStage={handleStage}
                  onDiscard={handleDiscard}
                  selectedFile={selectedFile?.path}
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
              className="min-h-[80px] md:text-sm resize-none"
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
  
  return (
    <>
      {isMobile && selectedFile ? (
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

          <Tabs defaultValue="files" className="flex flex-col h-full">
            <TabsList className="flex-shrink-0">
              <TabsTrigger value="files">Files ({stagedFiles.length + unstagedFiles.length})</TabsTrigger>
              <TabsTrigger value="diff">{selectedFile.path.split('/').pop() || selectedFile.path}</TabsTrigger>
            </TabsList>

            <TabsContent value="files" className="flex-1 overflow-hidden mt-0">
              <div className="flex flex-col h-full">
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                  {status.hasChanges ? (
                    <>
                      {stagedFiles.length > 0 && (
                        <GitFlatFileList
                          files={stagedFiles}
                          staged={true}
                          onSelect={onFileSelect}
                          onUnstage={handleUnstage}
                          onDiscard={handleDiscard}
                          selectedFile={selectedFile?.path}
                        />
                      )}

                      {unstagedFiles.length > 0 && (
                        <GitFlatFileList
                          files={unstagedFiles}
                          staged={false}
                          onSelect={onFileSelect}
                          onStage={handleStage}
                          onDiscard={handleDiscard}
                          selectedFile={selectedFile?.path}
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
                      className="min-h-[80px] md:text-sm resize-none"
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
            </TabsContent>

            <TabsContent value="diff" className="flex-1 overflow-hidden mt-0">
              <FileDiffView repoId={repoId} filePath={selectedFile.path} includeStaged={selectedFile.staged} />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
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
                    files={stagedFiles}
                    staged={true}
                    onSelect={onFileSelect}
                    onUnstage={handleUnstage}
                    onDiscard={handleDiscard}
                    selectedFile={selectedFile?.path}
                  />
                )}

                {unstagedFiles.length > 0 && (
                  <GitFlatFileList
                    files={unstagedFiles}
                    staged={false}
                    onSelect={onFileSelect}
                    onStage={handleStage}
                    onDiscard={handleDiscard}
                    selectedFile={selectedFile?.path}
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
                className="min-h-[80px] md:text-sm resize-none"
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
      )}

      <DeleteDialog
        open={discardConfirm.open}
        onOpenChange={handleCancelDiscard}
        onConfirm={handleConfirmDiscard}
        onCancel={handleCancelDiscard}
        title="Discard Changes"
        description={
          discardConfirm.paths.length === 1
            ? `Are you sure you want to discard all changes to "${discardConfirm.paths[0]}?"`
            : `Are you sure you want to discard all changes to ${discardConfirm.paths.length} files?`
        }
        itemName={discardConfirm.paths.length === 1 ? discardConfirm.paths[0] : undefined}
        isDeleting={git.discardFiles.isPending}
      />
    </>
  )
}

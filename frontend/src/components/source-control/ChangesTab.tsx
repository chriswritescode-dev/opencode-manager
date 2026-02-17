import { useState } from 'react'
import { useGitStatus } from '@/api/git'
import { useGit } from '@/hooks/useGit'
import { GitFlatFileList } from './GitFlatFileList'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { FileDiffView } from '@/components/file-browser/FileDiffView'
import { Loader2, GitCommit, FileText, AlertCircle } from 'lucide-react'

interface ChangesTabProps {
  repoId: number
  onFileSelect: (path: string, staged: boolean) => void
  selectedFile?: {path: string, staged: boolean}
  isMobile: boolean
  onError?: (error: unknown) => void
}

export function ChangesTab({ repoId, onFileSelect, selectedFile, isMobile, onError }: ChangesTabProps) {
  const { data: status, isLoading, error } = useGitStatus(repoId)
  const git = useGit(repoId, onError)
  const [commitMessage, setCommitMessage] = useState('')

  const stagedFiles = status?.files.filter(f => f.staged) || []
  const unstagedFiles = status?.files.filter(f => !f.staged) || []
  const canCommit = commitMessage.trim() && stagedFiles.length > 0 && !git.commit.isPending

  const handleStage = (paths: string[]) => {
    git.stageFiles.mutate(paths)
  }

  const handleUnstage = (paths: string[]) => {
    git.unstageFiles.mutate(paths)
  }

  const handleDiscard = (paths: string[], staged: boolean) => {
    git.discardFiles.mutate({ paths, staged })
  }

  const handleCommit = () => {
    git.commit.mutate({ message: commitMessage.trim() })
    setCommitMessage('')
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
                        selectedFile={selectedFile?.path}
                      />
                    )}

                    {unstagedFiles.length > 0 && (
                      <GitFlatFileList
                        files={unstagedFiles}
                        staged={false}
                        onSelect={onFileSelect}
                        onStage={handleStage}
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
}

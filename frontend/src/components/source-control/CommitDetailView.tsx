import { useCommitDetails } from '@/api/git'
import { Loader2, GitCommit, FileText, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GitFlatFileList } from './GitFlatFileList'
import { FileDiffView } from '@/components/file-browser/FileDiffView'

interface CommitDetailViewProps {
  repoId: number
  commitHash: string
  onBack: () => void
  onFileSelect: (path: string) => void
  selectedFile?: string
}

export function CommitDetailView({ repoId, commitHash, onBack, onFileSelect, selectedFile }: CommitDetailViewProps) {
  const { data: commit, isLoading, error } = useCommitDetails(repoId, commitHash)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !commit) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <GitCommit className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Failed to load commit details</p>
        <p className="text-xs mt-1">{error?.message}</p>
        <Button variant="outline" size="sm" onClick={onBack} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to commits
        </Button>
      </div>
    )
  }

  const commitFiles = commit.files.map(f => ({
    path: f.path,
    status: f.status,
    staged: false,
    oldPath: f.oldPath,
    additions: f.additions,
    deletions: f.deletions
  }))

  const totalAdditions = commit.files.reduce((sum, f) => sum + (f.additions || 0), 0)
  const totalDeletions = commit.files.reduce((sum, f) => sum + (f.deletions || 0), 0)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="h-7 w-7 p-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{commit.message}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{commit.hash.substring(0, 7)}</span>
              <span>·</span>
              <span>{commit.authorName}</span>
              <span>·</span>
              <span>{new Date(parseInt(commit.date, 10) * 1000).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-[40%] border-r border-border overflow-y-auto">
          <div className="p-3">
            <div className="flex items-center gap-2 mb-3">
              <GitCommit className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Changed Files ({commit.files.length})</span>
              {(totalAdditions > 0 || totalDeletions > 0) && (
                <div className="flex items-center gap-1 text-xs">
                  {totalAdditions > 0 && <span className="text-green-500">+{totalAdditions}</span>}
                  {totalDeletions > 0 && <span className="text-red-500">-{totalDeletions}</span>}
                </div>
              )}
            </div>
            <GitFlatFileList
              files={commitFiles}
              staged={false}
              onSelect={(path) => onFileSelect(path)}
              selectedFile={selectedFile}
              readOnly={true}
            />
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedFile ? (
            <div className="flex-1 overflow-auto">
              <FileDiffView
                repoId={repoId}
                filePath={selectedFile}
                includeStaged={false}
                commitHash={commitHash}
                onBack={() => onFileSelect('')}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileText className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">Select a file to view changes</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
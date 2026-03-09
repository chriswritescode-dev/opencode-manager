import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createRepo, discoverRepos } from '@/api/repos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { showToast } from '@/lib/toast'
import type { DiscoverReposResponse } from '@opencode-manager/shared/types'
import type { Repo } from '@/api/types'

interface AddRepoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const [repoType, setRepoType] = useState<'remote' | 'local' | 'folder'>('remote')
  const [repoUrl, setRepoUrl] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [branch, setBranch] = useState('')
  const [skipSSHVerification, setSkipSSHVerification] = useState(false)
  const queryClient = useQueryClient()

  const isSSHUrl = (url: string): boolean => {
    return url.startsWith('git@') || url.startsWith('ssh://')
  }

  const showSkipSSHCheckbox = repoType === 'remote' && isSSHUrl(repoUrl)

  type AddRepoResult =
    | { mode: 'single'; repo: Repo }
    | ({ mode: 'discover' } & DiscoverReposResponse)

  const mutation = useMutation({
    mutationFn: async (): Promise<AddRepoResult> => {
      if (repoType === 'local') {
        const repo = await createRepo(undefined, localPath, branch || undefined, undefined, false)
        return { mode: 'single', repo }
      }

      if (repoType === 'folder') {
        const result = await discoverRepos(folderPath)
        return { mode: 'discover', ...result }
      }

      const repo = await createRepo(repoUrl, undefined, branch || undefined, undefined, false, skipSSHVerification)
      return { mode: 'single', repo }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['repos'] })
      queryClient.invalidateQueries({ queryKey: ['reposGitStatus'] })
      setRepoUrl('')
      setLocalPath('')
      setFolderPath('')
      setBranch('')
      setRepoType('remote')
      setSkipSSHVerification(false)

      if (result.mode === 'discover') {
        const summary = [
          result.discoveredCount > 0 ? `${result.discoveredCount} new` : null,
          result.existingCount > 0 ? `${result.existingCount} existing` : null,
        ].filter(Boolean).join(', ')

        if (result.errors.length > 0) {
          showToast.warning('Repository discovery completed with issues', {
            description: `${summary || 'No repos imported'}. ${result.errors[0]?.error || 'Some folders could not be imported.'}`,
          })
        } else if (result.discoveredCount === 0 && result.existingCount === 0) {
          showToast.info('No Git repositories found in that folder')
        } else {
          showToast.success('Repository discovery complete', {
            description: summary,
          })
        }
      } else {
        showToast.success('Repository added')
      }

      onOpenChange(false)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if ((repoType === 'remote' && repoUrl) || (repoType === 'local' && localPath) || (repoType === 'folder' && folderPath)) {
      mutation.mutate()
    }
  }

  const handleRepoUrlChange = (value: string) => {
    setRepoUrl(value)
    if (!isSSHUrl(value)) {
      setSkipSSHVerification(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-[#141414] border-[#2a2a2a]">
        <DialogHeader>
          <DialogTitle className="text-xl bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
            Add Repository
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <label className="text-sm text-zinc-400">Repository Type</label>
            <div className="flex gap-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="repoType"
                  value="remote"
                  checked={repoType === 'remote'}
                  onChange={(e) => setRepoType(e.target.value as 'remote')}
                  disabled={mutation.isPending}
                  className="text-blue-600 bg-[#1a1a1a] border-[#2a2a2a]"
                />
                <span className="text-sm text-white">Remote Repository</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="repoType"
                  value="local"
                  checked={repoType === 'local'}
                  onChange={(e) => setRepoType(e.target.value as 'local')}
                  disabled={mutation.isPending}
                  className="text-blue-600 bg-[#1a1a1a] border-[#2a2a2a]"
                />
                <span className="text-sm text-white">Local Repository</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="repoType"
                  value="folder"
                  checked={repoType === 'folder'}
                  onChange={(e) => setRepoType(e.target.value as 'folder')}
                  disabled={mutation.isPending}
                  className="text-blue-600 bg-[#1a1a1a] border-[#2a2a2a]"
                />
                <span className="text-sm text-white">Folder Discovery</span>
              </label>
            </div>
          </div>

          {repoType === 'remote' ? (
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Repository URL</label>
              <Input
                placeholder="owner/repo or https://github.com/user/repo.git"
                value={repoUrl}
                onChange={(e) => handleRepoUrlChange(e.target.value)}
                disabled={mutation.isPending}
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500"
              />
              <p className="text-xs text-zinc-500">
                Full URL or shorthand format (owner/repo for GitHub)
              </p>
            </div>
          ) : repoType === 'local' ? (
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Local Path</label>
              <Input
                placeholder="my-local-project OR /absolute/path/to/git-repo"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                disabled={mutation.isPending}
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500"
              />
              <p className="text-xs text-zinc-500">
                Directory name for a new repo, or an absolute path to link an existing Git repo in place so its OpenCode sessions stay attached
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Folder Path</label>
              <Input
                placeholder="/absolute/path/to/projects"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                disabled={mutation.isPending}
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500"
              />
              <p className="text-xs text-zinc-500">
                Scans the folder for nested Git repositories and links each one in place so existing OpenCode sessions show up immediately
              </p>
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-sm text-zinc-400">Branch</label>
            <Input
              placeholder="Optional - uses default if empty"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={mutation.isPending || repoType === 'folder'}
              className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500"
            />
            <p className="text-xs text-zinc-500">
              {repoType === 'folder'
                ? 'Folder discovery links each repository on its current branch'
                : branch 
                ? repoType === 'remote' 
                  ? `Clones repository directly to '${branch}' branch`
                  : localPath?.startsWith('/') 
                    ? `Links the repo in place and checks out '${branch}' branch`
                    : `Initializes repository with '${branch}' branch`
                : repoType === 'remote'
                  ? "Clones repository to default branch"
                  : localPath?.startsWith('/')
                    ? 'Links the repo in place and keeps its current branch'
                    : "Initializes repository with 'main' branch"
              }
            </p>
          </div>

          {showSkipSSHCheckbox && (
            <div className="flex items-start space-x-2">
              <input
                type="checkbox"
                id="skip-ssh-verification"
                checked={skipSSHVerification}
                onChange={(e) => setSkipSSHVerification(e.target.checked)}
                disabled={mutation.isPending}
                className="mt-1 h-4 w-4 rounded border-[#2a2a2a] bg-[#1a1a1a] text-blue-600 focus:ring-blue-600"
              />
              <div className="flex-1">
                <label htmlFor="skip-ssh-verification" className="cursor-pointer text-sm text-white">
                  Skip SSH host key verification
                </label>
                <p className="text-xs text-zinc-500">
                  Auto-accept the SSH host key. Use for self-hosted or internal Git servers.
                </p>
              </div>
            </div>
          )}

          <Button 
            type="submit" 
            disabled={(!repoUrl && repoType === 'remote') || (!localPath && repoType === 'local') || (!folderPath && repoType === 'folder') || mutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {repoType === 'local' ? 'Linking...' : repoType === 'folder' ? 'Discovering...' : 'Cloning...'}
              </>
            ) : (
              repoType === 'folder' ? 'Discover Repositories' : 'Add Repository'
            )}
          </Button>
          {mutation.isError && (
            <p className="text-sm text-red-400">
              {mutation.error.message}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}

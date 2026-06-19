import { useState, useRef, useCallback, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { listRepos, createRepo, discoverRepos } from '@/api/repos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2 } from 'lucide-react'
import { showToast } from '@/lib/toast'
import { invalidateRepoListCaches } from '@/lib/queryInvalidation'
import { getRepoBaseDirectoryName, getRepoDirectoryNameError, getRepoNameFromUrl, normalizeRepoUrlForCompare, sanitizeRepoDirectoryName } from '@opencode-manager/shared/utils'
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
  const [directoryName, setDirectoryName] = useState('')
  const [branch, setBranch] = useState('')
  const [skipSSHVerification, setSkipSSHVerification] = useState(false)
  const directoryTouched = useRef(false)
  const queryClient = useQueryClient()

  const isSSHUrl = (url: string): boolean => {
    return url.startsWith('git@') || url.startsWith('ssh://')
  }

  const showSkipSSHCheckbox = repoType === 'remote' && isSSHUrl(repoUrl)
  const showDirectoryName = repoType === 'remote'

  const { data: existingRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
    staleTime: 30_000,
  })

  const directoryNameError = useMemo(() => {
    if (!showDirectoryName || !directoryName) return null
    return getRepoDirectoryNameError(directoryName)
  }, [showDirectoryName, directoryName])

  const directoryCollision = useMemo(() => {
    if (!showDirectoryName || !directoryName || directoryNameError || !existingRepos) return null
    const normalizedNewUrl = normalizeRepoUrlForCompare(repoUrl)
    const colliding = existingRepos.find((r) => {
      if (r.localPath !== directoryName && getRepoBaseDirectoryName(r) !== directoryName) return false
      if (r.repoUrl && normalizeRepoUrlForCompare(r.repoUrl) === normalizedNewUrl) return false
      return true
    })
    return colliding ?? null
  }, [showDirectoryName, directoryName, directoryNameError, existingRepos, repoUrl])

  type AddRepoResult =
    | { mode: 'single'; repo: Repo }
    | ({ mode: 'discover' } & DiscoverReposResponse)

  const mutation = useMutation({
    mutationFn: async (): Promise<AddRepoResult> => {
      if (repoType === 'local') {
        const repo = await createRepo({ localPath, branch: branch || undefined, useWorktree: false })
        return { mode: 'single', repo }
      }

      if (repoType === 'folder') {
        const result = await discoverRepos(folderPath)
        return { mode: 'discover', ...result }
      }

      const repo = await createRepo({
        repoUrl,
        directoryName: directoryName || undefined,
        branch: branch || undefined,
        useWorktree: false,
        skipSSHVerification,
      })
      return { mode: 'single', repo }
    },
    onSuccess: (result) => {
      invalidateRepoListCaches(queryClient)
      setRepoUrl('')
      setLocalPath('')
      setFolderPath('')
      setDirectoryName('')
      setBranch('')
      setRepoType('remote')
      setSkipSSHVerification(false)
      directoryTouched.current = false

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

  const handleRepoUrlChange = useCallback((value: string) => {
    setRepoUrl(value)
    if (!isSSHUrl(value)) {
      setSkipSSHVerification(false)
    }
    if (!directoryTouched.current) {
      const extracted = sanitizeRepoDirectoryName(getRepoNameFromUrl(value))
      setDirectoryName(extracted)
    }
  }, [])

  const handleDirectoryNameChange = useCallback((value: string) => {
    directoryTouched.current = true
    setDirectoryName(value)
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen mobileSwipeToClose className="content-start gap-0 sm:max-w-[500px] sm:max-h-[80vh] sm:h-auto sm:top-[50%] sm:translate-y-[-50%] bg-[#141414] border-[#2a2a2a]">
        <DialogHeader className="px-4 sm:px-6 pt-2 sm:pt-6 pb-2 sm:pb-3 h-fit">
          <DialogTitle className="text-xl bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
            Add Repository
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-4 sm:px-6">
          <div className="space-y-2">
            <label className="text-sm text-zinc-400">Repository Type</label>
            <Tabs value={repoType} onValueChange={(value) => setRepoType(value as 'remote' | 'local' | 'folder')}>
              <TabsList className="grid w-full grid-cols-3 bg-[#1a1a1a]">
                <TabsTrigger value="remote">Remote</TabsTrigger>
                <TabsTrigger value="local">Local</TabsTrigger>
                <TabsTrigger value="folder">Folder</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {repoType === 'remote' ? (
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Repository URL</label>
              <Input
                placeholder="owner/repo or https://github.com/user/repo.git"
                value={repoUrl}
                onChange={(e) => handleRepoUrlChange(e.target.value)}
                disabled={mutation.isPending}
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500 min-h-[44px] text-base"
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
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500 min-h-[44px] text-base"
              />
              <p className="text-xs text-zinc-500">
                Directory name for a new repo, or an absolute path to link an existing Git repo
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
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500 min-h-[44px] text-base"
              />
              <p className="text-xs text-zinc-500">
                Scans the folder for nested Git repositories and links each one
              </p>
            </div>
          )}

          {showDirectoryName && (
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Directory Name</label>
              <Input
                placeholder="Auto-detected from URL"
                value={directoryName}
                onChange={(e) => handleDirectoryNameChange(e.target.value)}
                disabled={mutation.isPending}
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500 min-h-[44px] text-base"
              />
              {directoryNameError ? (
                <p className="text-xs text-amber-400">
                  {directoryNameError}.
                </p>
              ) : directoryCollision ? (
                <p className="text-xs text-amber-400">
                  A repository named '{directoryName}' already exists.
                  {directoryCollision.repoUrl && directoryCollision.repoUrl !== repoUrl
                    ? ` (${directoryCollision.repoUrl})`
                    : ''
                  }
                  {' '}Choose a different directory name to clone this fork.
                </p>
              ) : (
                <p className="text-xs text-zinc-500">
                  Custom directory name for the cloned repository
                </p>
              )}
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-sm text-zinc-400">Branch (optional)</label>
            <Input
              placeholder="Uses default if empty"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={mutation.isPending || repoType === 'folder'}
              className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500 min-h-[44px] text-base"
            />
            <p className="text-xs text-zinc-500">
              {repoType === 'folder' 
                ? 'Links each repository on its current branch'
                : branch 
                  ? `Uses '${branch}' branch`
                  : 'Uses default branch'
              }
            </p>
          </div>

          {showSkipSSHCheckbox && (
            <div className="flex items-start space-x-3">
              <input
                type="checkbox"
                id="skip-ssh-verification"
                checked={skipSSHVerification}
                onChange={(e) => setSkipSSHVerification(e.target.checked)}
                disabled={mutation.isPending}
                className="mt-1 h-5 w-5 rounded border-[#2a2a2a] bg-[#1a1a1a] text-blue-600 focus:ring-blue-600"
              />
              <div className="flex-1">
                <label htmlFor="skip-ssh-verification" className="cursor-pointer text-sm text-white">
                  Skip SSH host key verification
                </label>
                <p className="text-xs text-zinc-500">
                  Auto-accept the SSH host key for self-hosted or internal servers
                </p>
              </div>
            </div>
          )}

          <Button 
            type="submit" 
            disabled={(!repoUrl && repoType === 'remote') || (!localPath && repoType === 'local') || (!folderPath && repoType === 'folder') || mutation.isPending || (showDirectoryName && (!!directoryNameError || !!directoryCollision))}
            className="w-full min-h-[48px] bg-blue-600 hover:bg-blue-700 text-white text-base font-medium"
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

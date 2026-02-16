import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createRepo } from '@/api/repos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

interface AddRepoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const [repoType, setRepoType] = useState<'remote' | 'local'>('remote')
  const [repoUrl, setRepoUrl] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [branch, setBranch] = useState('')
  const [skipSSHVerification, setSkipSSHVerification] = useState(false)
  const queryClient = useQueryClient()

  const isSSHUrl = (url: string): boolean => {
    return url.startsWith('git@') || url.startsWith('ssh://')
  }

  const showSkipSSHCheckbox = repoType === 'remote' && isSSHUrl(repoUrl)

  const mutation = useMutation({
    mutationFn: () => {
      if (repoType === 'local') {
        return createRepo(undefined, localPath, branch || undefined, undefined, false)
      } else {
        return createRepo(repoUrl, undefined, branch || undefined, undefined, false, skipSSHVerification)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] })
      queryClient.invalidateQueries({ queryKey: ['reposGitStatus'] })
      setRepoUrl('')
      setLocalPath('')
      setBranch('')
      setRepoType('remote')
      setSkipSSHVerification(false)
      onOpenChange(false)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if ((repoType === 'remote' && repoUrl) || (repoType === 'local' && localPath)) {
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
          ) : (
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
                Directory name for new repo, OR absolute path to existing Git repo (will be copied to workspace)
              </p>
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-sm text-zinc-400">Branch</label>
            <Input
              placeholder="Optional - uses default if empty"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={mutation.isPending}
              className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500"
            />
            <p className="text-xs text-zinc-500">
              {branch 
                ? repoType === 'remote' 
                  ? `Clones repository directly to '${branch}' branch`
                  : localPath?.startsWith('/') 
                    ? `Copies repo and checks out '${branch}' branch (creates if needed)`
                    : `Initializes repository with '${branch}' branch`
                : repoType === 'remote'
                  ? "Clones repository to default branch"
                  : localPath?.startsWith('/')
                    ? "Copies repo and checks out current branch"
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
            disabled={(!repoUrl && repoType === 'remote') || (!localPath && repoType === 'local') || mutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {repoType === 'local' ? 'Initializing...' : 'Cloning...'}
              </>
            ) : (
              'Add Repository'
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

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
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => {
      if (repoType === 'local') {
        return createRepo(undefined, localPath, branch || undefined, undefined, false)
      } else {
        return createRepo(repoUrl, undefined, branch || undefined, undefined, false)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] })
      setRepoUrl('')
      setLocalPath('')
      setBranch('')
      setRepoType('remote')
      onOpenChange(false)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if ((repoType === 'remote' && repoUrl) || (repoType === 'local' && localPath)) {
      mutation.mutate()
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
                 onChange={(e) => setRepoUrl(e.target.value)}
                 disabled={mutation.isPending}
                 className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500"
               />
               <p className="text-xs text-zinc-500">
                 Full URL or GitHub shorthand format (owner/repo)
               </p>
             </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Local Path</label>
              <Input
                placeholder="my-local-project"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                disabled={mutation.isPending}
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500"
              />
              <p className="text-xs text-zinc-500">
                Directory name will be created in the repos folder
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
                  : `Initializes repository with '${branch}' branch`
                : repoType === 'remote'
                  ? "Clones repository to default branch"
                  : "Initializes repository with 'main' branch"
              }
            </p>
          </div>
          
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

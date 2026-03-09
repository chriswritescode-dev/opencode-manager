import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createRepo } from '@/api/repos'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useMobile } from '@/hooks/useMobile'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface AddRepoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const isMobile = useMobile()
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

  const repoTypeOptions = [
    {
      id: 'remote' as const,
      label: 'Remote Repository',
      description: 'Clone from GitHub, GitLab, or any accessible remote.',
    },
    {
      id: 'local' as const,
      label: 'Local Repository',
      description: 'Import a local path or initialize a fresh workspace repo.',
    },
  ]

  const sourceValue = repoType === 'remote' ? repoUrl : localPath
  const sourceLabel = repoType === 'remote' ? 'Repository URL' : 'Local Path'
  const sourcePlaceholder = repoType === 'remote'
    ? 'owner/repo or https://github.com/user/repo.git'
    : 'my-local-project OR /absolute/path/to/git-repo'
  const sourceDescription = repoType === 'remote'
    ? 'Full URL or shorthand format for GitHub repositories.'
    : 'Use a new directory name or an absolute path to an existing Git repository.'
  const branchOutcome = branch
    ? repoType === 'remote'
      ? `Clones directly to '${branch}'.`
      : localPath?.startsWith('/')
        ? `Copies the repo and checks out '${branch}' (creating it if needed).`
        : `Initializes the repository with '${branch}'.`
    : repoType === 'remote'
      ? 'Clones the repository to its default branch.'
      : localPath?.startsWith('/')
        ? 'Copies the repo and keeps the current branch.'
        : "Initializes the repository with 'main'."
  const submitLabel = mutation.isPending ? (repoType === 'local' ? 'Initializing...' : 'Cloning...') : 'Add Repository'
  const isSubmitDisabled = (!repoUrl && repoType === 'remote') || (!localPath && repoType === 'local') || mutation.isPending

  const formSections = (
    <div className="space-y-4">
      <div className="surface-panel rounded-[1.5rem] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Import Plan</p>
          <Badge variant={repoType === 'remote' ? 'info' : 'secondary'}>{repoType === 'remote' ? 'Remote' : 'Local'}</Badge>
          {showSkipSSHCheckbox && skipSSHVerification && <Badge variant="warning">SSH verification disabled</Badge>}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Source</p>
            <p className="mt-1 text-sm text-foreground">{sourceValue || (repoType === 'remote' ? 'Choose a remote repository' : 'Choose a local path')}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Branch</p>
            <p className="mt-1 text-sm text-foreground">{branch || (repoType === 'remote' ? 'Default branch' : localPath?.startsWith('/') ? 'Keep current branch' : 'main')}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{branchOutcome}</p>
      </div>

      <div className="surface-panel-muted rounded-[1.5rem] p-4 sm:p-5">
        <label className="text-sm font-medium text-foreground">Repository Type</label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {repoTypeOptions.map((option) => {
            const isSelected = repoType === option.id

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setRepoType(option.id)}
                disabled={mutation.isPending}
                className={cn(
                  'rounded-2xl border border-border/70 bg-background/70 p-4 text-left transition-[transform,border-color,background-color] hover:border-primary/20 hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50',
                  isSelected && 'border-primary/35 bg-primary/10'
                )}
              >
                <p className={cn('text-sm font-semibold', isSelected ? 'text-primary' : 'text-foreground')}>
                  {option.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="surface-panel-muted rounded-[1.5rem] p-4 sm:p-5">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{sourceLabel}</label>
            <Input
              placeholder={sourcePlaceholder}
              value={sourceValue}
              onChange={(e) => {
                if (repoType === 'remote') {
                  handleRepoUrlChange(e.target.value)
                } else {
                  setLocalPath(e.target.value)
                }
              }}
              disabled={mutation.isPending}
            />
            <p className="text-xs leading-5 text-muted-foreground">{sourceDescription}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Branch</label>
            <Input
              placeholder="Optional - uses default if empty"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={mutation.isPending}
            />
            <p className="text-xs leading-5 text-muted-foreground">{branchOutcome}</p>
          </div>

          {showSkipSSHCheckbox && (
            <label className="rounded-2xl border border-warning/20 bg-warning/10 p-4 flex items-start gap-3">
              <input
                type="checkbox"
                id="skip-ssh-verification"
                checked={skipSSHVerification}
                onChange={(e) => setSkipSSHVerification(e.target.checked)}
                disabled={mutation.isPending}
                className="mt-1 h-4 w-4 rounded border-input bg-background accent-primary focus:ring-primary"
              />
              <div className="flex-1">
                <span className="cursor-pointer text-sm font-medium text-foreground">Skip SSH host key verification</span>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Auto-accept the SSH host key for self-hosted or internal Git servers.
                </p>
              </div>
            </label>
          )}
        </div>
      </div>

      {mutation.isError && (
        <p className="px-1 text-sm text-destructive">{mutation.error.message}</p>
      )}
    </div>
  )

  const submitButton = (
    <Button type="submit" disabled={isSubmitDisabled} className="w-full">
      {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {submitLabel}
    </Button>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[94dvh]">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader className="border-b border-border/60 pb-4">
            <DrawerTitle className="heading-ink">Add Repository</DrawerTitle>
            <DrawerDescription>Bring a remote repo into the workspace or import a local Git directory.</DrawerDescription>
          </DrawerHeader>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-3 pb-safe">
            {formSections}
          </div>
          <DrawerFooter className="border-t border-border/60 bg-background/90 pb-[calc(1rem+env(safe-area-inset-bottom))] supports-[backdrop-filter]:backdrop-blur-xl">
            {submitButton}
          </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="heading-ink text-xl">Add Repository</DialogTitle>
          <DialogDescription>Bring a remote repo into the workspace or import a local Git directory.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-2 space-y-4">
          {formSections}
          {submitButton}
        </form>
      </DialogContent>
    </Dialog>
  )
}

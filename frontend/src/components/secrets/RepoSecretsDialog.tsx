import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SecretsManager } from './SecretsManager'

interface RepoSecretsContentProps {
  repoId: number
}

export function RepoSecretsContent({ repoId }: RepoSecretsContentProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
      <SecretsManager scope={{ scope: 'repo', repoId }} />
    </div>
  )
}

interface RepoSecretsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
}

export function RepoSecretsDialog({ open, onOpenChange, repoId }: RepoSecretsDialogProps) {
  if (!repoId) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-3xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b shrink-0">
          <DialogTitle>Secrets</DialogTitle>
        </DialogHeader>
        <RepoSecretsContent repoId={repoId} />
      </DialogContent>
    </Dialog>
  )
}

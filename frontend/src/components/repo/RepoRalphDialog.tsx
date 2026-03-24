import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RepoRalphList } from './RepoRalphList'
import { useRalphStatus } from '@/hooks/useRalphStatus'

interface RepoRalphDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
}

export function RepoRalphDialog({ open, onOpenChange, repoId }: RepoRalphDialogProps) {
  const { data, isLoading, error, cancelMutation } = useRalphStatus(repoId, open)

  if (!repoId) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0 shrink-0">
          <DialogTitle>Ralph Loops</DialogTitle>
        </DialogHeader>
        <RepoRalphList
          isLoading={isLoading}
          data={data?.loops}
          error={error}
          onCancel={(sessionId) => cancelMutation.mutate({ sessionId })}
          cancelPending={cancelMutation.isPending}
        />
      </DialogContent>
    </Dialog>
  )
}

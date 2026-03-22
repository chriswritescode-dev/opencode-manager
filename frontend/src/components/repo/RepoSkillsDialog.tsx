import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RepoSkillsList } from './RepoSkillsList'
import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'

interface RepoSkillsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
}

export function RepoSkillsDialog({ open, onOpenChange, repoId }: RepoSkillsDialogProps) {
  const { isLoading, data, error } = useQuery({
    queryKey: ['settings', 'skills', repoId],
    queryFn: () => settingsApi.listManagedSkills(repoId),
    enabled: open && !!repoId,
    staleTime: 30000,
  })

  if (!repoId) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] w-full">
        <DialogHeader>
          <DialogTitle>Skills</DialogTitle>
        </DialogHeader>
        <RepoSkillsList isLoading={isLoading} data={data} error={error} />
      </DialogContent>
    </Dialog>
  )
}

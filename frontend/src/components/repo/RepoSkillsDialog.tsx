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

  const repoSkills = data?.filter(skill => skill.scope === 'project')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0 shrink-0">
          <DialogTitle>Skills</DialogTitle>
        </DialogHeader>
        <RepoSkillsList isLoading={isLoading} data={repoSkills} error={error} />
      </DialogContent>
    </Dialog>
  )
}

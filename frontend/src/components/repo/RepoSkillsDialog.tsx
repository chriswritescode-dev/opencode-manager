import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { SkillLibraryList } from '@/components/skills/SkillLibraryList'
import { SkillInstallDialog } from '@/components/settings/SkillInstallDialog'
import { settingsApi } from '@/api/settings'
import { useLoadSkill } from '@/hooks/useOpenCode'
import type { SkillFileInfo } from '@opencode-manager/shared'
import { toast } from 'sonner'

type RepoSkillsDialogBaseProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
}

type RepoSkillsDialogProps = RepoSkillsDialogBaseProps & (
  | { sessionId: string; opcodeUrl: string; directory?: string; onSkillLoaded?: (skill: SkillFileInfo) => void }
  | { sessionId?: undefined; opcodeUrl?: undefined; directory?: undefined; onSkillLoaded?: undefined }
)

export function RepoSkillsDialog({
  open,
  onOpenChange,
  repoId,
  sessionId,
  opcodeUrl,
  directory,
  onSkillLoaded,
}: RepoSkillsDialogProps) {
  const queryClient = useQueryClient()
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [deleteSkill, setDeleteSkill] = useState<SkillFileInfo | null>(null)
  const skillsQueryKey = directory ? ['settings', 'skills', 'directory', directory] : ['settings', 'skills', repoId]

  const { isLoading, data, error } = useQuery({
    queryKey: skillsQueryKey,
    queryFn: () => settingsApi.listManagedSkills(repoId, directory),
    enabled: open && (!!repoId || !!directory),
    staleTime: 30000,
  })

  const canLoad = !!sessionId && !!opcodeUrl
  const loadSkill = useLoadSkill(opcodeUrl, sessionId, directory)

  const deleteMutation = useMutation({
    mutationFn: ({ name, scope, repoId }: { name: string; scope: SkillFileInfo['scope']; repoId?: number }) =>
      settingsApi.deleteSkill(name, scope, repoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'skills'] })
      queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
      toast.success('Skill deleted successfully')
    },
    onError: (deleteError) => {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Failed to delete skill')
    },
  })

  const handleLoad = (skill: SkillFileInfo) => {
    loadSkill.mutate({ skillName: skill.name })
    onSkillLoaded?.(skill)
    onOpenChange(false)
  }

  const confirmDelete = () => {
    if (!deleteSkill) return
    deleteMutation.mutate({
      name: deleteSkill.name,
      scope: deleteSkill.scope,
      repoId: deleteSkill.scope === 'project' ? deleteSkill.repoId : undefined,
    }, {
      onSettled: () => setDeleteSkill(null),
    })
  }

  const handleInstalled = () => {
    queryClient.invalidateQueries({ queryKey: ['settings', 'skills'] })
    queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
  }

  if (!repoId && !sessionId) {
    return null
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen className="sm:max-w-3xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
          <DialogHeader className="p-4 sm:p-6 border-b shrink-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <DialogTitle>Skills</DialogTitle>
                <DialogDescription>
                  {canLoad ? 'Search and load a skill into the current session' : 'Skills available for this repository'}
                </DialogDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setInstallDialogOpen(true)}>
                <Download className="h-4 w-4 mr-1" />
                Install Skill
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <SkillLibraryList
              isLoading={isLoading}
              data={data}
              error={error as Error | null}
              primaryAction={canLoad ? { label: 'Load', onClick: handleLoad } : undefined}
              rowActions={[{ label: 'Delete', onClick: setDeleteSkill, destructive: true }]}
              emptyTitle="No skills found"
              emptyHint="Install a skill or add one to .opencode/skills/<name>/SKILL.md."
              maxHeightClassName="max-h-[55vh]"
            />
          </div>
        </DialogContent>
      </Dialog>

      <SkillInstallDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        onInstalled={handleInstalled}
      />

      <DeleteDialog
        open={deleteSkill !== null}
        onOpenChange={(isOpen) => !isOpen && setDeleteSkill(null)}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteSkill(null)}
        title="Delete Skill"
        description="Delete this managed skill directory and bundled files? This action cannot be undone."
        itemName={deleteSkill?.name}
        isDeleting={deleteMutation.isPending}
      />
    </>
  )
}

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { SkillLibraryList } from '@/components/skills/SkillLibraryList'
import { SkillInstallDialog } from '@/components/settings/SkillInstallDialog'
import { settingsApi } from '@/api/settings'
import { useLoadSkill } from '@/hooks/useOpenCode'
import { useDeleteSkill } from '@/hooks/useDeleteSkill'
import { invalidateSkillCaches } from '@/lib/queryInvalidation'
import type { SkillFileInfo } from '@opencode-manager/shared'

type RepoSkillsSessionProps =
  | { sessionId: string; directory?: string; onSkillLoaded?: (skill: SkillFileInfo) => void }
  | { sessionId?: undefined; directory?: undefined; onSkillLoaded?: undefined }

type RepoSkillsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
} & RepoSkillsSessionProps

type RepoSkillsContentProps = {
  open: boolean
  repoId: number
  onDone: () => void
} & RepoSkillsSessionProps

export function RepoSkillsContent({
  open,
  repoId,
  sessionId,
  directory,
  onSkillLoaded,
  onDone,
}: RepoSkillsContentProps) {
  const queryClient = useQueryClient()
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const { deleteSkill, setDeleteSkill, confirmDelete, isDeleting } = useDeleteSkill()
  const skillsQueryKey = directory ? ['settings', 'skills', 'directory', directory] : ['settings', 'skills', repoId]

  const { isLoading, data, error } = useQuery({
    queryKey: skillsQueryKey,
    queryFn: () => settingsApi.listManagedSkills(repoId, directory),
    enabled: open && (!!repoId || !!directory),
    staleTime: 30000,
  })

  const canLoad = !!sessionId
  const loadSkill = useLoadSkill(sessionId)

  const handleLoad = (skill: SkillFileInfo) => {
    loadSkill.mutate({ skillName: skill.name })
    onSkillLoaded?.(skill)
    onDone()
  }

  const handleInstalled = () => {
    invalidateSkillCaches(queryClient)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <p className="text-sm text-muted-foreground">
          {canLoad ? 'Search and load a skill into the current session' : 'Skills available for this repository'}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setInstallDialogOpen(true)}>
          <Download className="h-4 w-4 mr-1" />
          Install Skill
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <SkillLibraryList
          isLoading={isLoading}
          data={data}
          error={error as Error | null}
          primaryAction={canLoad ? { label: 'Load', onClick: handleLoad } : undefined}
          rowActions={[{ label: 'Delete', onClick: setDeleteSkill, destructive: true }]}
          emptyTitle="No skills found"
          emptyHint="Install a skill or add one to .opencode/skills/<name>/SKILL.md."
          maxHeightClassName="max-h-none"
        />
      </div>

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
        isDeleting={isDeleting}
      />
    </div>
  )
}

export function RepoSkillsDialog({ onOpenChange, ...props }: RepoSkillsDialogProps) {
  if (!props.repoId && !props.sessionId) {
    return null
  }

  return (
    <Dialog open={props.open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-3xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b shrink-0">
          <DialogTitle>Skills</DialogTitle>
        </DialogHeader>
        <RepoSkillsContent {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

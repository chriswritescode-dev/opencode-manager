import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { SkillLibraryList } from '@/components/skills/SkillLibraryList'
import { SkillInstallDialog } from '@/components/settings/SkillInstallDialog'
import { settingsApi } from '@/api/settings'
import { listSkills } from '@/api/opencode'
import { useLoadSkill } from '@/hooks/useOpenCode'
import { useDeleteSkill } from '@/hooks/useDeleteSkill'
import { invalidateSkillCaches } from '@/lib/queryInvalidation'
import { isLocalOpenCodeServer, useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { serverScopedKey } from '@/lib/serverScope'
import type { SkillFileInfo } from '@opencode-manager/shared'
import type { SkillInfo } from '@opencode-manager/shared/opencode'

function toRemoteSkillFileInfo(skill: SkillInfo): SkillFileInfo {
  return {
    name: skill.name,
    description: skill.description ?? '',
    body: skill.content,
    scope: 'project',
    location: skill.path,
  }
}

type RepoSkillsSessionProps =
  | { sessionId: string; directory?: string; onSkillLoaded?: (skill: SkillFileInfo) => void }
  | { sessionId?: undefined; directory?: string; onSkillLoaded?: undefined }

type RepoSkillsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId?: number
} & RepoSkillsSessionProps

type RepoSkillsContentProps = {
  open: boolean
  repoId?: number
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
  const serverId = useOpenCodeServerId()
  const isRemoteServer = !isLocalOpenCodeServer(serverId)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const { deleteSkill, setDeleteSkill, confirmDelete, isDeleting } = useDeleteSkill()
  const skillsQueryKey = directory ? ['settings', 'skills', 'directory', directory] : ['settings', 'skills', repoId]

  const { isLoading: isLocalLoading, data: localSkills, error: localError } = useQuery({
    queryKey: skillsQueryKey,
    queryFn: () => settingsApi.listManagedSkills(repoId, directory),
    enabled: open && !isRemoteServer && (!!repoId || !!directory),
    staleTime: 30000,
  })

  const { isLoading: isRemoteLoading, data: remoteSkillInfos, error: remoteError } = useQuery({
    queryKey: serverScopedKey(['opencode', 'skills', directory], serverId),
    queryFn: () => listSkills(directory, serverId),
    enabled: open && isRemoteServer && Boolean(directory),
    staleTime: 30000,
  })

  const remoteSkills = useMemo(
    () => remoteSkillInfos?.map(toRemoteSkillFileInfo),
    [remoteSkillInfos],
  )
  const skills = isRemoteServer ? remoteSkills : localSkills
  const isLoading = isRemoteServer ? isRemoteLoading : isLocalLoading
  const error = isRemoteServer ? remoteError : localError

  const canLoad = !!sessionId
  const loadSkill = useLoadSkill(sessionId)
  const description = isRemoteServer
    ? canLoad ? 'Load a skill from this server into the current session' : 'Skills available on this server'
    : canLoad ? 'Search and load a skill into the current session' : 'Skills available for this repository'
  const emptyHint = isRemoteServer
    ? 'This server exposes no skills for this location.'
    : 'Install a skill or add one to .opencode/skills/<name>/SKILL.md.'

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
          {description}
        </p>
        {!isRemoteServer && (
          <Button type="button" variant="outline" size="sm" onClick={() => setInstallDialogOpen(true)}>
            <Download className="h-4 w-4 mr-1" />
            Install Skill
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <SkillLibraryList
          isLoading={isLoading}
          data={skills}
          error={error as Error | null}
          primaryAction={canLoad ? { label: 'Load', onClick: handleLoad } : undefined}
          rowActions={isRemoteServer ? [] : [{ label: 'Delete', onClick: setDeleteSkill, destructive: true }]}
          emptyTitle="No skills found"
          emptyHint={emptyHint}
          maxHeightClassName="max-h-none"
        />
      </div>

      {!isRemoteServer && (
        <SkillInstallDialog
          open={installDialogOpen}
          onOpenChange={setInstallDialogOpen}
          onInstalled={handleInstalled}
        />
      )}

      {!isRemoteServer && (
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
      )}
    </div>
  )
}

export function RepoSkillsDialog({ onOpenChange, ...props }: RepoSkillsDialogProps) {
  if (!props.repoId && !props.sessionId && !props.directory) {
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

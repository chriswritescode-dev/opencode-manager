import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { RepoSkillsList } from './RepoSkillsList'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { useLoadSkill } from '@/hooks/useOpenCode'
import type { SkillFileInfo } from '@opencode-manager/shared'
import { useMemo, useState, useEffect } from 'react'

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
  const { isLoading, data, error } = useQuery({
    queryKey: directory ? ['settings', 'skills', 'directory', directory] : ['settings', 'skills', repoId],
    queryFn: () => settingsApi.listManagedSkills(repoId, directory),
    enabled: open && (!!repoId || !!directory),
    staleTime: 30000,
  })

  const projectSkills = useMemo(
    () => data?.filter((s) => s.scope === 'project') ?? [],
    [data],
  )
  const globalSkills = useMemo(
    () => data?.filter((s) => s.scope === 'global') ?? [],
    [data],
  )

  const canLoad = !!sessionId && !!opcodeUrl
  const loadSkill = useLoadSkill(opcodeUrl, sessionId, directory)

  const [activeTab, setActiveTab] = useState<'project' | 'global'>('project')

  useEffect(() => {
    if (data && projectSkills.length === 0 && globalSkills.length > 0) {
      setActiveTab('global')
    }
  }, [data, projectSkills.length, globalSkills.length])

  const handleTabChange = (value: string) => {
    setActiveTab(value as 'project' | 'global')
  }

  const handleLoad = (skill: SkillFileInfo) => {
    loadSkill.mutate({ skillName: skill.name })
    onSkillLoaded?.(skill)
    onOpenChange(false)
  }

  if (!repoId && !sessionId) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b shrink-0">
          <DialogTitle>Skills</DialogTitle>
          <DialogDescription>
            {canLoad ? 'Load a skill into the current session' : 'Skills available for this repository'}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 sm:mx-6 mt-3">
            <TabsTrigger value="project">Project</TabsTrigger>
            <TabsTrigger value="global">Global</TabsTrigger>
          </TabsList>
          <TabsContent value="project" className="flex-1 min-h-0 flex flex-col">
            <RepoSkillsList
              isLoading={isLoading}
              data={projectSkills}
              error={error as Error | null}
              emptyTitle="No local skills found"
              emptyHint="Add skills to .opencode/skills/&lt;name&gt;/SKILL.md in this repository."
              onLoad={canLoad ? handleLoad : undefined}
            />
          </TabsContent>
          <TabsContent value="global" className="flex-1 min-h-0 flex flex-col">
            <RepoSkillsList
              isLoading={isLoading}
              data={globalSkills}
              error={error as Error | null}
              emptyTitle="No global skills"
              emptyHint="Global skills live under ~/.config/opencode/skills/."
              onLoad={canLoad ? handleLoad : undefined}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkillDialog } from './SkillDialog'
import { SkillInstallDialog } from './SkillInstallDialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { SkillLibraryList } from '@/components/skills/SkillLibraryList'
import { settingsApi } from '@/api/settings'
import type { SkillFileInfo, CreateSkillRequest, UpdateSkillRequest, SkillScope } from '@opencode-manager/shared'
import { toast } from 'sonner'

interface SkillsEditorProps {
  managedSkills?: SkillFileInfo[]
}

export function SkillsEditor({ managedSkills = [] }: SkillsEditorProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillFileInfo | null>(null)
  const [deleteSkill, setDeleteSkill] = useState<SkillFileInfo | null>(null)

  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (data: CreateSkillRequest) => settingsApi.createSkill(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
      toast.success('Skill created successfully')
      setDialogOpen(false)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create skill')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ name, scope, repoId, ...data }: UpdateSkillRequest & { name: string; scope: SkillScope; repoId?: number }) =>
      settingsApi.updateSkill(name, scope, data, repoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
      toast.success('Skill updated successfully')
      setDialogOpen(false)
      setEditingSkill(null)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update skill')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ name, scope, repoId }: { name: string; scope: SkillScope; repoId?: number }) =>
      settingsApi.deleteSkill(name, scope, repoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
      toast.success('Skill deleted successfully')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete skill')
    },
  })

  const handleEdit = (skill: SkillFileInfo) => {
    setEditingSkill(skill)
    setDialogOpen(true)
  }

  const handleDelete = (skill: SkillFileInfo) => {
    setDeleteSkill(skill)
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

  const handleCreate = () => {
    setEditingSkill(null)
    setDialogOpen(true)
  }

  const handleSubmit = (data: CreateSkillRequest | (UpdateSkillRequest & { name: string; scope: SkillScope; repoId?: number })) => {
    if ('name' in data && editingSkill) {
      updateMutation.mutate(data as UpdateSkillRequest & { name: string; scope: SkillScope; repoId?: number })
    } else {
      createMutation.mutate(data as CreateSkillRequest)
    }
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button type="button" variant="outline" onClick={() => setInstallDialogOpen(true)} size="sm">
            <Download className="h-4 w-4 mr-1" />
            Install Skill
          </Button>
          <Button type="button" onClick={handleCreate} size="sm" className="flex-1 sm:flex-none">
            <Plus className="h-4 w-4 mr-1" />
            Create Skill
          </Button>
        </div>
      </div>

      <SkillLibraryList
        isLoading={false}
        data={managedSkills}
        error={null}
        primaryAction={{ label: 'Edit', onClick: handleEdit }}
        rowActions={[{ label: 'Delete', onClick: handleDelete, destructive: true }]}
        emptyTitle="No skills created"
        emptyHint="Create or install your first skill to get started."
        maxHeightClassName="max-h-[calc(100dvh-300px)] sm:max-h-[420px]"
      />

      <SkillInstallDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        onInstalled={() => queryClient.invalidateQueries({ queryKey: ['managed-skills'] })}
      />

      <SkillDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        editingSkill={editingSkill}
      />

      <DeleteDialog
        open={deleteSkill !== null}
        onOpenChange={(open) => !open && setDeleteSkill(null)}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteSkill(null)}
        title="Delete Skill"
        description="Delete this managed skill directory and bundled files? This action cannot be undone."
        itemName={deleteSkill?.name}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}

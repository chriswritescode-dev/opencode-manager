import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { SkillDialog } from './SkillDialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { settingsApi } from '@/api/settings'
import type { OpenCodeConfigInput, SkillFileInfo, CreateSkillRequest, UpdateSkillRequest, SkillScope } from '@opencode-manager/shared'
import { toast } from 'sonner'

interface SkillsEditorProps {
  skills?: OpenCodeConfigInput['skills']
  managedSkills?: SkillFileInfo[]
  onChange?: (skills: OpenCodeConfigInput['skills']) => void
}

interface SkillPathEditorProps {
  items: string[]
  onChange: (items: string[]) => void
  onAddItem: () => void
  onRemoveItem: (index: number) => void
  label: string
  placeholder: string
}

function SkillPathEditor({ items, onChange, onAddItem, onRemoveItem, label, placeholder }: SkillPathEditorProps) {
  const handleItemChange = (index: number, value: string) => {
    const updated = [...items]
    updated[index] = value
    onChange(updated)
  }

  return (
    <div className="space-y-3">
      <Label>{label}</Label>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-4 text-center">
          <p className="text-sm text-muted-foreground">No {label.toLowerCase()} configured. Add one to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={item}
                onChange={(e) => handleItemChange(index, e.target.value)}
                placeholder={placeholder}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemoveItem(index)}
                className="h-9 w-9"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAddItem}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-1" />
        Add {label}
      </Button>
    </div>
  )
}

export function SkillsEditor({ skills, managedSkills = [], onChange }: SkillsEditorProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillFileInfo | null>(null)
  const [collapsiblesOpen, setCollapsiblesOpen] = useState({
    managed: true,
    config: false,
  })
  const [localPaths, setLocalPaths] = useState<string[]>(skills?.paths ?? [])
  const [localUrls, setLocalUrls] = useState<string[]>(skills?.urls ?? [])
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [deleteSkill, setDeleteSkill] = useState<SkillFileInfo | null>(null)

  useEffect(() => {
    if (!hasUnsavedChanges) {
      setLocalPaths(skills?.paths ?? [])
      setLocalUrls(skills?.urls ?? [])
    }
  }, [skills?.paths, skills?.urls, hasUnsavedChanges])

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

  const handlePathsChange = (paths: string[]) => {
    setLocalPaths(paths)
    setHasUnsavedChanges(true)
  }

  const handleUrlsChange = (urls: string[]) => {
    setLocalUrls(urls)
    setHasUnsavedChanges(true)
  }

  const handleSave = () => {
    const filteredPaths = localPaths.filter(p => p.trim() !== '')
    const filteredUrls = localUrls.filter(u => u.trim() !== '')
    
    onChange?.({
      paths: filteredPaths.length > 0 ? filteredPaths : undefined,
      urls: filteredUrls.length > 0 ? filteredUrls : undefined,
    })
    setHasUnsavedChanges(false)
    toast.success('Skills configuration saved')
  }

  const handleCancel = () => {
    setLocalPaths(skills?.paths ?? [])
    setLocalUrls(skills?.urls ?? [])
    setHasUnsavedChanges(false)
  }

  const getScopeBadge = (skill: SkillFileInfo) => {
    if (skill.scope === 'global') {
      return <Badge variant="secondary">Global</Badge>
    }
    return (
      <Badge variant="outline">
        Project{skill.repoName ? `: ${skill.repoName}` : ''}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCollapsiblesOpen(prev => ({ ...prev, managed: !prev.managed }))}
          className="h-auto p-0 font-medium"
        >
          {collapsiblesOpen.managed ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
          Managed Skills
          {managedSkills.length > 0 && (
            <Badge variant="secondary" className="ml-2">{managedSkills.length}</Badge>
          )}
        </Button>
        <Button type="button" onClick={handleCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Create Skill
        </Button>
      </div>

      {collapsiblesOpen.managed && (
        <>
          {managedSkills.length === 0 ? (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-sm font-medium">No skills created</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Create your first skill to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              <div className="grid gap-3">
                {managedSkills.map((skill) => (
                  <Card key={`${skill.scope}-${skill.name}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{skill.name}</CardTitle>
                        <div className="flex items-center gap-1">
                          {getScopeBadge(skill)}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(skill)}
                            className="h-8 w-8"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(skill)}
                            className="h-8 w-8"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {skill.description && (
                        <p className="text-sm text-muted-foreground">{skill.description}</p>
                      )}
                      {skill.body && (
                        <div className="text-xs font-mono bg-muted rounded p-2 line-clamp-3 max-h-[60px] overflow-hidden whitespace-pre-wrap">
                          {skill.body}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCollapsiblesOpen(prev => ({ ...prev, config: !prev.config }))}
            className="h-auto p-0 font-medium"
          >
            {collapsiblesOpen.config ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
            Advanced: Custom Paths & URLs
          </Button>
        </div>

        {collapsiblesOpen.config && (
          <div className="space-y-4">
            <SkillPathEditor
              items={localPaths}
              onChange={handlePathsChange}
              onAddItem={() => {
                if (localPaths.length === 0 || localPaths[localPaths.length - 1] !== '') {
                  handlePathsChange([...localPaths, ''])
                }
              }}
              onRemoveItem={(index) => {
                const updated = localPaths.filter((_, i) => i !== index)
                handlePathsChange(updated.length > 0 ? updated : [])
              }}
              label="Skill Paths"
              placeholder="e.g., .opencode/skills/"
            />

            <SkillPathEditor
              items={localUrls}
              onChange={handleUrlsChange}
              onAddItem={() => {
                if (localUrls.length === 0 || localUrls[localUrls.length - 1] !== '') {
                  handleUrlsChange([...localUrls, ''])
                }
              }}
              onRemoveItem={(index) => {
                const updated = localUrls.filter((_, i) => i !== index)
                handleUrlsChange(updated.length > 0 ? updated : [])
              }}
              label="Skill URLs"
              placeholder="e.g., https://example.com/skills/"
            />

            {hasUnsavedChanges && (
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleSave}
                  className="flex-1"
                >
                  <Save className="h-4 w-4 mr-1" />
                  Save Changes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  className="flex-1"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

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
        description="Are you sure you want to delete this skill? This action cannot be undone."
        itemName={deleteSkill?.name}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}


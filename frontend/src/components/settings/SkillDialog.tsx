import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SkillFileInfo, CreateSkillRequest, UpdateSkillRequest, SkillScope } from '@opencode-manager/shared'
import type { Repo } from '@/api/types'
import { listRepos } from '@/api/repos'
import { useQuery } from '@tanstack/react-query'

const skillFormSchema = z.object({
  name: z.string()
    .min(1, 'Skill name is required')
    .max(64, 'Skill name must be 64 characters or less')
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Must be lowercase letters, numbers, and hyphens only'),
  description: z.string().min(1, 'Description is required').max(1024, 'Description must be 1024 characters or less'),
  body: z.string().min(1, 'Skill body is required'),
  scope: z.enum(['global', 'project']),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
})

type SkillFormValues = z.infer<typeof skillFormSchema>

interface SkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: CreateSkillRequest | (UpdateSkillRequest & { name: string; scope: SkillScope; repoId?: number })) => void
  editingSkill?: SkillFileInfo | null
}

export function SkillDialog({ open, onOpenChange, onSubmit, editingSkill }: SkillDialogProps) {
  const { data: repos = [] } = useQuery<Repo[]>({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>(undefined)

  const getDefaultValues = (skill?: SkillFileInfo | null): SkillFormValues => {
    return {
      name: skill?.name || '',
      description: skill?.description || '',
      body: skill?.body || '',
      scope: skill?.scope || 'global',
      license: skill?.license || '',
      compatibility: skill?.compatibility || '',
      metadata: skill?.metadata || {},
    }
  }

  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: getDefaultValues(editingSkill)
  })

  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues(editingSkill))
      if (editingSkill?.repoId) {
        setSelectedRepoId(editingSkill.repoId)
      }
    }
  }, [open, editingSkill, form])

  const handleSubmit = (values: SkillFormValues) => {
    if (!editingSkill && values.scope === 'project' && !selectedRepoId) {
      form.setError('scope', { message: 'Please select a repository for project-scoped skills' })
      return
    }

    if (editingSkill) {
      onSubmit({
        name: editingSkill.name,
        scope: editingSkill.scope,
        repoId: editingSkill.scope === 'project' ? editingSkill.repoId : undefined,
        description: values.description,
        body: values.body,
        license: values.license || undefined,
        compatibility: values.compatibility || undefined,
        metadata: Object.keys(values.metadata || {}).length > 0 ? values.metadata : undefined,
      })
    } else {
      onSubmit({
        name: values.name,
        description: values.description,
        body: values.body,
        scope: values.scope,
        repoId: values.scope === 'project' ? selectedRepoId : undefined,
        license: values.license || undefined,
        compatibility: values.compatibility || undefined,
        metadata: Object.keys(values.metadata || {}).length > 0 ? values.metadata : undefined,
      })
    }
    form.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset()
    }
    onOpenChange(isOpen)
  }

  const scope = form.watch('scope')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>{editingSkill ? 'Edit Skill' : 'Create Skill'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          <Form {...form}>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Skill Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="my-skill"
                        disabled={!!editingSkill}
                        className={editingSkill ? 'bg-muted' : ''}
                      />
                    </FormControl>
                    <FormDescription>
                      Use lowercase letters, numbers, and hyphens only
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Brief description of what this skill does"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Skill Body</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="## What I do&#10;&#10;- Step 1&#10;- Step 2&#10;&#10;## When to use me&#10;&#10;Use this when..."
                        rows={10}
                        className="font-mono md:text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="scope"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scope</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!editingSkill}>
                      <FormControl>
                        <SelectTrigger className={editingSkill ? 'bg-muted' : ''}>
                          <SelectValue placeholder="Select scope" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="global">Global</SelectItem>
                        <SelectItem value="project">Project</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {scope === 'project' && (
                <FormField
                  control={form.control}
                  name="metadata"
                  render={() => (
                    <FormItem>
                      <FormLabel>Repository</FormLabel>
                      <FormControl>
                        <Select
                          value={selectedRepoId?.toString()}
                          onValueChange={(value) => setSelectedRepoId(value ? parseInt(value, 10) : undefined)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select repository" />
                          </SelectTrigger>
                          <SelectContent>
                            {repos.map((repo) => (
                              <SelectItem key={repo.id} value={repo.id.toString()}>
                                {repo.localPath}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="license"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>License (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="MIT"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="compatibility"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Compatibility (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="opencode"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Form>
        </div>

        <DialogFooter className="flex flex-row gap-2 pt-2 border-t border-border sm:justify-end pb-4 p-3">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button
            onClick={() => form.handleSubmit(handleSubmit)()}
            disabled={!form.formState.isValid}
            className="flex-1 sm:flex-none"
          >
            {editingSkill ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

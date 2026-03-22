import { useState, useEffect } from 'react'
import type { PromptTemplate, CreatePromptTemplateRequest } from '@opencode-manager/shared/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { useCreatePromptTemplate, useUpdatePromptTemplate } from '@/hooks/usePromptTemplates'

interface PromptTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template?: PromptTemplate
}

export function PromptTemplateDialog({ open, onOpenChange, template }: PromptTemplateDialogProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [cadenceHint, setCadenceHint] = useState('')
  const [suggestedName, setSuggestedName] = useState('')
  const [suggestedDescription, setSuggestedDescription] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')

  const createMutation = useCreatePromptTemplate()
  const updateMutation = useUpdatePromptTemplate()
  const isSaving = createMutation.isPending || updateMutation.isPending

  useEffect(() => {
    if (open) {
      setTitle(template?.title ?? '')
      setCategory(template?.category ?? '')
      setCadenceHint(template?.cadenceHint ?? '')
      setSuggestedName(template?.suggestedName ?? '')
      setSuggestedDescription(template?.suggestedDescription ?? '')
      setDescription(template?.description ?? '')
      setPrompt(template?.prompt ?? '')
    } else {
      setTitle('')
      setCategory('')
      setCadenceHint('')
      setSuggestedName('')
      setSuggestedDescription('')
      setDescription('')
      setPrompt('')
    }
  }, [template, open])

  const handleSubmit = () => {
    const data: CreatePromptTemplateRequest = {
      title: title.trim(),
      category: category.trim(),
      cadenceHint: cadenceHint.trim(),
      suggestedName: suggestedName.trim(),
      suggestedDescription: suggestedDescription.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
    }

    if (template) {
      updateMutation.mutate({ id: template.id, data }, { onSuccess: () => onOpenChange(false) })
    } else {
      createMutation.mutate(data, { onSuccess: () => onOpenChange(false) })
    }
  }

  const isValid = title.trim() && category.trim() && cadenceHint.trim() && suggestedName.trim() && prompt.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className=" flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col overflow-hidden sm:h-auto sm:max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit template' : 'New template'}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="template-title">Title</Label>
              <Input id="template-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Repo Health Report" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-category">Category</Label>
              <Input id="template-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Health" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="template-cadence">Cadence hint</Label>
              <Input id="template-cadence" value={cadenceHint} onChange={(e) => setCadenceHint(e.target.value)} placeholder="Weekly" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-suggested-name">Suggested job name</Label>
              <Input id="template-suggested-name" value={suggestedName} onChange={(e) => setSuggestedName(e.target.value)} placeholder="Weekly repo health report" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-description">Description</Label>
            <Input id="template-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary shown on the template card" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-suggested-description">Suggested job description</Label>
            <Input id="template-suggested-description" value={suggestedDescription} onChange={(e) => setSuggestedDescription(e.target.value)} placeholder="Pre-fills the schedule job description field" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-prompt">Prompt</Label>
            <Textarea id="template-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-[200px]" placeholder="The full prompt sent to the agent when the schedule runs." />
          </div>
        </div>
        <div className="flex flex-row gap-2 pt-2 border-t border-border sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving} className="flex-1 sm:flex-none">Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !isValid} className="flex-1 sm:flex-none">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaving ? 'Saving...' : template ? 'Save changes' : 'Create template'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

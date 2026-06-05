import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import type { PromptTemplate } from '@opencode-manager/shared/types'

type PromptTabProps = {
  prompt: string
  onPromptChange: (value: string) => void
  selectedPromptTemplateId: number | null
  onApplyTemplate: (template: PromptTemplate) => void
  templates: PromptTemplate[]
  onEditTemplate: (template: PromptTemplate) => void
  onDeleteTemplate: (templateId: number) => void
  onNewTemplate: () => void
}

type PromptTemplateCardProps = {
  template: PromptTemplate
  selected?: boolean
  onApply?: (template: PromptTemplate) => void
  onEdit: (template: PromptTemplate) => void
  onDelete: (templateId: number) => void
}

export function PromptTemplateCard({ template, selected = false, onApply, onEdit, onDelete }: PromptTemplateCardProps) {
  const cardClassName = `w-full rounded-xl border-2 p-4 text-left transition-all ${
    selected
      ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
      : 'border-border bg-card hover:bg-accent/40'
  }`

  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-orange-500 text-[10px] uppercase tracking-wide text-white">
          {template.category}
        </Badge>
        <Badge className="border-transparent bg-slate-600 text-[10px] uppercase tracking-wide text-white">
          {template.cadenceHint}
        </Badge>
      </div>
      <div className="mt-3">
        <p className="text-sm font-semibold">{template.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
      </div>
      <p className="mt-3 line-clamp-3 text-xs text-muted-foreground">{template.suggestedDescription}</p>
      {selected && (
        <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
          <Check className="h-3 w-3 text-primary-foreground" />
        </div>
      )}
    </>
  )

  return (
    <div className="group relative">
      {onApply ? (
        <button type="button" onClick={() => onApply(template)} className={cardClassName}>
          {content}
        </button>
      ) : (
        <div className={cardClassName}>{content}</div>
      )}
      <div className={`absolute top-2 flex gap-1 transition-opacity ${selected || onApply ? 'right-10' : 'right-2'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => { e.stopPropagation(); onEdit(template) }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(template.id) }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

export function PromptTab({
  prompt,
  onPromptChange,
  selectedPromptTemplateId,
  onApplyTemplate,
  templates,
  onEditTemplate,
  onDeleteTemplate,
  onNewTemplate,
}: PromptTabProps) {
  return (
    <TabsContent value="prompt" className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-5 sm:px-4">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Label>Prompt templates</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={onNewTemplate}
            >
              <Plus className="h-3 w-3" />
              New
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {templates.map((template) => {
              const isSelected = selectedPromptTemplateId === template.id

              return (
                <PromptTemplateCard
                  key={template.id}
                  template={template}
                  selected={isSelected}
                  onApply={onApplyTemplate}
                  onEdit={onEditTemplate}
                  onDelete={onDeleteTemplate}
                />
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="schedule-prompt">Prompt</Label>
          <Textarea
            id="schedule-prompt"
            value={prompt}
            onChange={(event) => {
              onPromptChange(event.target.value)
            }}
            className="min-h-[320px]"
            placeholder="Review the repo, summarize notable risks, and open a session I can inspect later."
          />
        </div>
        <p className="text-xs text-muted-foreground">
          This prompt becomes the first message sent to the agent when the schedule runs.
        </p>
      </div>
    </TabsContent>
  )
}

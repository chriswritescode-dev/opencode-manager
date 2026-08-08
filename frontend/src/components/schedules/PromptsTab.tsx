import { useState, useRef } from 'react'
import type { CreatePromptTemplateRequest } from '@opencode-manager/shared/types'
import type { PromptDialog } from '@/hooks/useScheduleUrlState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, FileText, Plus, Upload } from 'lucide-react'
import { usePromptTemplates, useDeletePromptTemplate } from '@/hooks/usePromptTemplates'
import { parseMarkdownTemplate } from '@/lib/schedules/markdownTemplate'
import { PromptTemplateDialog } from './PromptTemplateDialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { PromptTemplateCard } from './PromptTab'

interface PromptsTabProps {
  promptDialog: PromptDialog
  templateId: number | null
  onNew: () => void
  onEdit: (id: number) => void
  onDelete: (id: number) => void
  onImport: () => void
  onCloseDialog: () => void
}

export function PromptsTab({ promptDialog, templateId, onNew, onEdit, onDelete, onImport, onCloseDialog }: PromptsTabProps) {
  const [importValues, setImportValues] = useState<Partial<CreatePromptTemplateRequest> | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: templates = [], isLoading } = usePromptTemplates()
  const deleteMutation = useDeletePromptTemplate()

  const editingTemplate = templates.find((t) => t.id === templateId)
  const dialogOpen = promptDialog === 'new' || promptDialog === 'edit' || promptDialog === 'import'
  const deleteDialogOpen = promptDialog === 'delete'

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setImportValues(parseMarkdownTemplate(content, file.name))
      onImport()
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      onCloseDialog()
      setImportValues(undefined)
    }
  }

  const handleDeleteConfirm = () => {
    if (templateId !== null) {
      deleteMutation.mutate(templateId, { onSuccess: onCloseDialog })
    }
  }

  const handleDeleteDialogOpenChange = (open: boolean) => {
    if (!open && !deleteMutation.isPending) {
      onCloseDialog()
    }
  }

  const handleDeleteCancel = () => {
    if (!deleteMutation.isPending) {
      onCloseDialog()
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Prompt templates</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={onNew}
          >
            <Plus className="h-3 w-3" />
            New
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3 w-3" />
            Import .md
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown"
        className="hidden"
        onChange={handleFileImport}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex min-h-full items-center justify-center">
            <Card className="max-w-md border-dashed border-border/70">
              <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                <div className="rounded-full border border-border bg-muted/40 p-4">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="space-y-2">
                  <p className="text-lg font-semibold">No templates yet</p>
                  <p className="text-sm text-muted-foreground">
                    Create prompt templates to reuse across your schedules.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {templates.map((template) => (
              <PromptTemplateCard
                key={template.id}
                template={template}
                onEdit={(item) => onEdit(item.id)}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>

      <PromptTemplateDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        template={promptDialog === 'edit' ? editingTemplate : undefined}
        initialValues={promptDialog === 'import' ? importValues : undefined}
      />

      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={handleDeleteDialogOpenChange}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        title="Delete template"
        description="Are you sure you want to delete this template?"
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}

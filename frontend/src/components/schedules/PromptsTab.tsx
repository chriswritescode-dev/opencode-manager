import { useState, useRef } from 'react'
import { z } from 'zod'
import type { CreatePromptTemplateRequest } from '@opencode-manager/shared/types'
import type { PromptDialog } from '@/hooks/useScheduleUrlState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, FileText, MoreHorizontal, Plus, Upload } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { usePromptTemplates, useDeletePromptTemplate } from '@/hooks/usePromptTemplates'
import { parseMarkdownTemplate } from '@/lib/schedules/markdownTemplate'
import { PromptTemplateDialog } from './PromptTemplateDialog'
import { ScheduleListToolbar } from './ScheduleListToolbar'
import { DeleteDialog } from '@/components/ui/delete-dialog'

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

  const [search, setSearch] = useState('')
  const { data: templates = [], isLoading } = usePromptTemplates()
  const searchTerm = search.trim().toLowerCase()
  const visibleTemplates = searchTerm
    ? templates.filter((template) =>
      [template.title, template.description, template.category, template.cadenceHint, template.suggestedName]
        .some((field) => field.toLowerCase().includes(searchTerm)),
    )
    : templates
  const deleteMutation = useDeletePromptTemplate()

  const editingTemplate = templates.find((t) => t.id === templateId)
  const dialogOpen = promptDialog === 'new' || promptDialog === 'edit' || promptDialog === 'import'
  const deleteDialogOpen = promptDialog === 'delete'

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = z.string().safeParse(e.target?.result)
      setImportValues(parseMarkdownTemplate(content.success ? content.data : '', file.name))
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
      <ScheduleListToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Search prompts">
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1" onClick={onNew}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1"
          aria-label="Import .md"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline">Import .md</span>
        </Button>
      </ScheduleListToolbar>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown"
        className="hidden"
        onChange={handleFileImport}
      />

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibleTemplates.length === 0 ? (
          <div className="flex min-h-full items-center justify-center">
            <Card className="max-w-md border-dashed border-border/70">
              <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                <div className="rounded-full border border-border bg-muted/40 p-4">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="space-y-2">
                  <p className="text-lg font-semibold">{searchTerm ? 'No matching templates' : 'No templates yet'}</p>
                  <p className="text-sm text-muted-foreground">
                    {searchTerm ? 'Try a different search.' : 'Create prompt templates to reuse across your schedules.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 whitespace-nowrap bg-background text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Template</th>
                  <th scope="col" className="hidden px-3 py-2.5 text-left font-medium sm:table-cell">Category</th>
                  <th scope="col" className="hidden px-3 py-2.5 text-left font-medium sm:table-cell">Cadence</th>
                  <th scope="col" className="hidden px-3 py-2.5 text-left font-medium md:table-cell">Updated</th>
                  <th scope="col" className="w-px px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visibleTemplates.map((template) => (
                  <tr
                    key={template.id}
                    onClick={() => onEdit(template.id)}
                    className="cursor-pointer transition-colors hover:bg-accent/40"
                  >
                    <td className="w-full max-w-0 px-3 py-2.5 sm:w-auto sm:max-w-none">
                      <div className="flex min-w-0 flex-col">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            onEdit(template.id)
                          }}
                          aria-label={`Edit ${template.title}`}
                          className="truncate font-medium sm:max-w-[32rem] rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {template.title}
                        </button>
                        {template.description && (
                          <span className="truncate text-xs sm:max-w-[32rem] text-muted-foreground">{template.description}</span>
                        )}
                        <span className="truncate text-xs text-muted-foreground sm:hidden">
                          {template.category} · {template.cadenceHint}
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 text-muted-foreground sm:table-cell">
                      <span className="capitalize">{template.category}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-muted-foreground sm:table-cell">{template.cadenceHint}</td>
                    <td
                      className="hidden px-3 py-2.5 text-muted-foreground md:table-cell"
                      title={new Date(template.updatedAt).toLocaleString()}
                    >
                      {formatDistanceToNow(template.updatedAt, { addSuffix: true })}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="More actions"
                            className="h-7 w-7 text-muted-foreground"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                          <DropdownMenuItem onClick={() => onEdit(template.id)}>Edit</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(template.id)}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

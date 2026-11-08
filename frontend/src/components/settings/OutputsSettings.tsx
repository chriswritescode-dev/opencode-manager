import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, Upload } from 'lucide-react'
import { UserOutputDefinitionInputSchema } from '@opencode-manager/shared/schemas'
import type { OutputDefinition, OutputDefinitionInput } from '@opencode-manager/shared/schemas'
import { Button } from '@/components/ui/button'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import { ModelCombobox } from '@/components/model/ModelCombobox'
import { useSettings } from '@/hooks/useSettings'
import { useAutosavedSetting } from '@/hooks/useAutosavedSetting'
import { useOutputDefinitions } from '@/hooks/useOutputs'
import {
  deleteOutputDefinition,
  putOutputDefinition,
  toOutputDefinitionInput,
} from '@/api/outputDefinitions'
import { saveFile } from '@/lib/download'
import { OutputDefinitionEditor } from './OutputDefinitionEditor'

/** Settings section that saves the global output model and manages global output definitions. */
export function OutputsSettings() {
  const { preferences, updateSettings } = useSettings()
  const queryClient = useQueryClient()
  const storedOutputModel = preferences?.outputModel ?? preferences?.walkthroughModel

  const { draft: outputModel, setDraft: setOutputModel } = useAutosavedSetting({
    stored: storedOutputModel,
    toDraft: (stored) => stored ?? '',
    toCommitted: (draft) => draft.trim(),
    isEqual: (a, b) => a === b,
    save: (next) => updateSettings({ outputModel: next }),
  })

  const definitionsQuery = useOutputDefinitions()
  const globalDefinitions = (definitionsQuery.data ?? []).filter(
    (definition) => definition.origin === 'global',
  )

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingDefinition, setEditingDefinition] = useState<OutputDefinition | null>(null)
  const [deletingDefinition, setDeletingDefinition] = useState<OutputDefinition | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<OutputDefinitionInput[] | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOutputDefinition(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['output-definitions'] })
      setDeletingDefinition(null)
    },
  })

  const importMutation = useMutation({
    mutationFn: async (inputs: OutputDefinitionInput[]) => {
      for (const input of inputs) {
        await putOutputDefinition(input.id, input)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['output-definitions'] })
    },
  })

  const openNewEditor = () => {
    setEditingDefinition(null)
    setEditorOpen(true)
  }

  const openEditEditor = (definition: OutputDefinition) => {
    setEditingDefinition(definition)
    setEditorOpen(true)
  }

  const handleEditorOpenChange = (open: boolean) => {
    setEditorOpen(open)
    if (!open) {
      setEditingDefinition(null)
    }
  }

  const handleSaved = () => {
    void queryClient.invalidateQueries({ queryKey: ['output-definitions'] })
  }

  const handleExport = () => {
    const inputs = globalDefinitions.map(toOutputDefinitionInput)
    void saveFile(
      new Blob([JSON.stringify(inputs, null, 2)], { type: 'application/json' }),
      'output-definitions.json',
    )
  }

  const runImport = async (inputs: OutputDefinitionInput[]) => {
    setImportError(null)
    try {
      await importMutation.mutateAsync(inputs)
      setImportDialogOpen(false)
      setPendingImport(null)
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : 'Failed to import output definitions',
      )
    }
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImportError(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      setImportError('The selected file is not valid JSON.')
      return
    }

    const result = UserOutputDefinitionInputSchema.array().safeParse(parsed)
    if (!result.success) {
      setImportError(
        `The file does not contain valid output definitions: ${result.error.issues
          .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
          .join('; ')}`,
      )
      return
    }

    const existingIds = new Set(globalDefinitions.map((definition) => definition.id))
    if (result.data.some((input) => existingIds.has(input.id))) {
      setPendingImport(result.data)
      setImportDialogOpen(true)
      return
    }

    await runImport(result.data)
  }

  const closeImportDialog = (open: boolean) => {
    setImportDialogOpen(open)
    if (!open) {
      setPendingImport(null)
      setImportError(null)
    }
  }

  const replacingIds = pendingImport
    ? pendingImport
        .filter((input) => globalDefinitions.some((definition) => definition.id === input.id))
        .map((input) => input.id)
    : []

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Outputs</h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="outputModel">Output model</Label>
          <p className="text-sm text-muted-foreground">
            Model of the separate session that builds outputs. Leave empty to use the session's
            model, or the OpenCode default.
          </p>
        </div>
        <ModelCombobox
          id="outputModel"
          ariaLabel="Output model"
          value={outputModel}
          onChange={setOutputModel}
          placeholder="Session model"
          allowCustomValue
          showClear
          emptyMeansDefault={false}
          className="w-full shrink-0 sm:w-64"
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-sm font-medium text-foreground">Saved output definitions</h3>
            <p className="text-sm text-muted-foreground">
              Global definitions are available in every session.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={openNewEditor}>
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
        </div>

        {importError && !importDialogOpen && (
          <p role="alert" className="text-sm text-destructive">
            {importError}
          </p>
        )}

        <SettingsList
          isLoading={definitionsQuery.isLoading}
          error={definitionsQuery.error}
          isEmpty={globalDefinitions.length === 0}
          emptyTitle="No saved output definitions"
          emptyHint="Create a definition to offer it in every session."
        >
          {globalDefinitions.map((definition) => (
            <SettingsListRow
              key={definition.id}
              title={definition.label}
              description={definition.description}
              primaryAction={{ label: 'Edit', onClick: () => openEditEditor(definition) }}
              actions={[
                {
                  label: 'Delete',
                  destructive: true,
                  onClick: () => setDeletingDefinition(definition),
                },
              ]}
              actionsLabel={`Actions for ${definition.label}`}
            />
          ))}
        </SettingsList>
      </div>

      <OutputDefinitionEditor
        open={editorOpen}
        onOpenChange={handleEditorOpenChange}
        editing={editingDefinition}
        onSaved={handleSaved}
      />

      <DeleteDialog
        open={deletingDefinition !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingDefinition(null)
            deleteMutation.reset()
          }
        }}
        onConfirm={() => {
          if (deletingDefinition) {
            deleteMutation.mutate(deletingDefinition.id)
          }
        }}
        onCancel={() => {
          setDeletingDefinition(null)
          deleteMutation.reset()
        }}
        title="Delete output definition"
        description="This definition will no longer be offered when generating outputs in sessions."
        itemName={deletingDefinition?.label}
        isDeleting={deleteMutation.isPending}
      >
        {deleteMutation.error && (
          <p role="alert" className="text-sm text-destructive">
            {deleteMutation.error.message}
          </p>
        )}
      </DeleteDialog>

      <Dialog open={importDialogOpen} onOpenChange={closeImportDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace existing output definitions?</DialogTitle>
            <DialogDescription>
              These ids already exist and will be updated: {replacingIds.join(', ')}
            </DialogDescription>
          </DialogHeader>
          {importError && (
            <p role="alert" className="text-sm text-destructive">
              {importError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeImportDialog(false)}
              disabled={importMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (pendingImport) {
                  void runImport(pendingImport)
                }
              }}
              disabled={importMutation.isPending}
            >
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

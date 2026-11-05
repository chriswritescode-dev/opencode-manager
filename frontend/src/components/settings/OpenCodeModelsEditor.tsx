import { useMemo, useState } from 'react'
import { Plus, Box } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import type { OpenCodeProviderConfig, OpenCodeProviderModelConfig } from '@opencode-manager/shared/opencode'
import type { OpenCodeProviderModelPatch, OpenCodeProviderPatch } from '@/api/types/settings'
import { OpenCodeModelDialog, type NewProviderConfig } from './OpenCodeModelDialog'

interface ProviderModels {
  providerId: string
  providerName: string
  models: Record<string, OpenCodeProviderModelConfig>
}

interface OpenCodeModelsEditorProps {
  providers: Record<string, OpenCodeProviderConfig>
  onSave: (providers: Record<string, OpenCodeProviderPatch>) => void
}

interface EditingModel {
  providerId: string
  modelId: string
  model: OpenCodeProviderModelConfig
}

/**
 * Renders configured provider models grouped by provider, with an empty state and dialogs for
 * creating and editing models. Submits the affected providers as a patch map so callers can apply
 * the changes in one config update.
 */
export function OpenCodeModelsEditor({ providers, onSave }: OpenCodeModelsEditorProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<EditingModel | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const availableProviderIds = useMemo(() => Object.keys(providers), [providers])

  const providerEntries: ProviderModels[] = Object.entries(providers).map(
    ([providerId, provider]) => ({
      providerId,
      providerName: provider.name || providerId,
      models: provider.models ?? {},
    })
  )

  const totalModelCount = providerEntries.reduce(
    (acc, p) => acc + Object.keys(p.models).length,
    0
  )

  /**
   * Builds a provider patch map for the submitted model, adding any new provider
   * and nulling the previous provider or model key when an edit moved or renamed
   * the entry, then hands the map to `onSave` and closes the dialog state.
   */
  const handleModelSubmit = (
    providerId: string,
    modelId: string,
    model: OpenCodeProviderModelPatch,
    newProvider?: NewProviderConfig,
    originalProviderId?: string,
    originalModelId?: string
  ) => {
    const patches: Record<string, OpenCodeProviderPatch> = {}

    /**
     * Accumulates a provider patch into `patches`, starting from a copy of the existing provider
     * config so model maps merge with prior entries instead of replacing them.
     */
    const addProviderPatch = (id: string, patch: OpenCodeProviderPatch) => {
      const existing: OpenCodeProviderPatch = patches[id]
        ?? (providers[id] ? { ...providers[id], models: { ...providers[id].models } } : {})
      const models = existing.models || patch.models
        ? { ...existing.models, ...patch.models }
        : undefined
      patches[id] = { ...existing, ...patch, ...(models ? { models } : {}) }
    }

    if (newProvider) {
      const providerPatch: OpenCodeProviderPatch = {
        name: newProvider.name || newProvider.id,
      }
      if (newProvider.type === 'api' && newProvider.baseUrl) {
        providerPatch.settings = { baseURL: newProvider.baseUrl }
      } else if (newProvider.type === 'npm' && newProvider.package) {
        providerPatch.package = newProvider.package
      }
      addProviderPatch(newProvider.id, providerPatch)
      providerId = newProvider.id
    }

    if (originalProviderId && originalModelId && originalProviderId !== providerId) {
      addProviderPatch(originalProviderId, { models: { [originalModelId]: null } })
    }

    const models: Record<string, OpenCodeProviderModelPatch | null> = { [modelId]: model }
    if (originalModelId && originalModelId !== modelId && originalProviderId === providerId) {
      models[originalModelId] = null
    }
    addProviderPatch(providerId, { models })

    onSave(patches)
    setEditingModel(null)
    setIsCreateDialogOpen(false)
  }

  /**
   * Saves the provider with the model's key set to null so the entry is removed
   * from the config; unknown providers are ignored.
   */
  const deleteModel = (providerId: string, modelId: string) => {
    const provider = providers[providerId]
    if (!provider) return

    onSave({
      [providerId]: {
        ...provider,
        models: { ...provider.models, [modelId]: null },
      },
    })
  }

  const startEdit = (providerId: string, modelId: string, model: OpenCodeProviderModelConfig) => {
    setEditingModel({ providerId, modelId, model })
  }

  const openCreateDialog = (providerId?: string) => {
    setSelectedProviderId(providerId || Object.keys(providers)[0] || '')
    setIsCreateDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => openCreateDialog()}>
              <Plus className="h-4 w-4 mr-1" />
              Add Model
            </Button>
          </DialogTrigger>
          <OpenCodeModelDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
            onSubmit={handleModelSubmit}
            availableProviders={availableProviderIds}
            existingProviders={providers}
            selectedProviderId={selectedProviderId}
          />
        </Dialog>
      </div>

      {totalModelCount === 0 ? (
        <SettingsList
          isEmpty
          emptyTitle="No models configured"
          emptyHint="Add your first model to get started."
        >
          <div />
        </SettingsList>
      ) : (
        <div className="space-y-3">
          {providerEntries.map(({ providerId, providerName, models }) => {
            const modelEntries = Object.entries(models)
            if (modelEntries.length === 0) return null

            return (
              <div key={providerId} className="space-y-2">
                <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                  <Box className="h-3.5 w-3.5" />
                  <span>{providerName}</span>
                  <span>{modelEntries.length} model{modelEntries.length !== 1 ? 's' : ''}</span>
                </div>
                <SettingsList isEmpty={false} maxHeightClassName="max-h-[420px]">
                  {modelEntries.map(([modelId, model]) => (
                    <SettingsListRow
                      key={modelId}
                      title={model.name || modelId}
                      description={<span className="font-mono">{modelId}</span>}
                      belowDescription={(model.limit?.context || model.limit?.output) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Limits: {model.limit?.context && `Context ${model.limit.context}`}{model.limit?.context && model.limit?.output && ' / '}{model.limit?.output && `Output ${model.limit.output}`}
                        </p>
                      )}
                      onClick={() => startEdit(providerId, modelId, model)}
                      primaryAction={{ label: 'Edit', onClick: () => startEdit(providerId, modelId, model) }}
                      actions={[{ label: 'Delete', destructive: true, onClick: () => deleteModel(providerId, modelId) }]}
                      actionsLabel={`Actions for ${model.name || modelId}`}
                    />
                  ))}
                </SettingsList>
              </div>
            )
          })}
        </div>
      )}

      <OpenCodeModelDialog
        open={!!editingModel}
        onOpenChange={() => setEditingModel(null)}
        onSubmit={(providerId: string, modelId: string, model: OpenCodeProviderModelPatch, newProvider?: NewProviderConfig) => {
          if (editingModel) {
            handleModelSubmit(providerId, modelId, model, newProvider, editingModel.providerId, editingModel.modelId)
          }
        }}
        availableProviders={availableProviderIds}
        existingProviders={providers}
        selectedProviderId={editingModel?.providerId || ''}
        editingModel={editingModel || undefined}
      />
    </div>
  )
}

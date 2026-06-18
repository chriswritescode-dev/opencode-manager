import { useMemo, useState } from 'react'
import { Plus, Box } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import { OpenCodeModelDialog, type NewProviderConfig } from './OpenCodeModelDialog'
import type { ModelConfig, ProviderConfig } from '@/api/types/settings'

export type ConfigModel = Partial<ModelConfig> & Record<string, unknown>
export type ConfigProvider = Omit<Partial<ProviderConfig>, 'models' | 'env'> & {
  api?: string
  npm?: string
  env?: string[]
  models?: Record<string, ConfigModel>
} & Record<string, unknown>

interface ProviderModels {
  providerId: string
  providerName: string
  models: Record<string, ConfigModel>
}

interface OpenCodeModelsEditorProps {
  providers: Record<string, ConfigProvider>
  onChange: (providers: Record<string, ConfigProvider>) => void
}

interface EditingModel {
  providerId: string
  modelId: string
  model: ConfigModel
}

export function OpenCodeModelsEditor({ providers, onChange }: OpenCodeModelsEditorProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<EditingModel | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const availableProviderIds = useMemo(() => Object.keys(providers), [providers])

  const providerEntries: ProviderModels[] = Object.entries(providers).map(
    ([providerId, provider]) => ({
      providerId,
      providerName: provider.name || providerId,
      models: provider.models || {},
    })
  )

  const totalModelCount = providerEntries.reduce(
    (acc, p) => acc + Object.keys(p.models).length,
    0
  )

  const handleModelSubmit = (
    providerId: string,
    modelId: string,
    model: ConfigModel,
    newProvider?: NewProviderConfig,
    originalProviderId?: string,
    originalModelId?: string
  ) => {
    const updatedProviders = { ...providers }

    if (newProvider) {
      const providerConfig: ConfigProvider = {
        name: newProvider.name || newProvider.id,
      }
      if (newProvider.type === 'api' && newProvider.baseUrl) {
        providerConfig.api = newProvider.baseUrl
        providerConfig.options = { baseURL: newProvider.baseUrl }
      } else if (newProvider.type === 'npm' && newProvider.npm) {
        providerConfig.npm = newProvider.npm
      }
      updatedProviders[newProvider.id] = providerConfig
      providerId = newProvider.id
    }

    if (originalProviderId && originalModelId && originalProviderId !== providerId) {
      const originalProvider = updatedProviders[originalProviderId]
      if (originalProvider?.models) {
        const updatedModels = { ...originalProvider.models }
        delete updatedModels[originalModelId]
        updatedProviders[originalProviderId] = {
          ...originalProvider,
          models: updatedModels,
        }
      }
    }

    if (originalModelId && originalModelId !== modelId) {
      const targetProvider = updatedProviders[providerId] || {}
      if (targetProvider.models?.[originalModelId]) {
        const updatedModels = { ...targetProvider.models }
        delete updatedModels[originalModelId]
        updatedProviders[providerId] = {
          ...targetProvider,
          models: updatedModels,
        }
      }
    }

    const targetProvider = updatedProviders[providerId] || {}
    const oldModel = targetProvider.models?.[modelId] || {}
    updatedProviders[providerId] = {
      ...targetProvider,
      models: {
        ...(targetProvider.models || {}),
        [modelId]: {
          ...(oldModel),
          ...model,
          ...(model.limit === undefined ? { limit: undefined } : {}),
        },
      },
    }

    onChange(updatedProviders)
    setEditingModel(null)
    setIsCreateDialogOpen(false)
  }

  const deleteModel = (providerId: string, modelId: string) => {
    const updatedProviders = { ...providers }
    const provider = updatedProviders[providerId]
    if (provider?.models?.[modelId]) {
      const updatedModels = { ...provider.models }
      delete updatedModels[modelId]
      updatedProviders[providerId] = {
        ...provider,
        models: updatedModels,
      }
      onChange(updatedProviders)
    }
  }

  const startEdit = (providerId: string, modelId: string, model: ConfigModel) => {
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
        onSubmit={(providerId: string, modelId: string, model: ConfigModel, newProvider?: NewProviderConfig) => {
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

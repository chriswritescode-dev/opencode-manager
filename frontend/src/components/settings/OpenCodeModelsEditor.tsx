import { useMemo, useState } from 'react'
import { Plus, Trash2, Edit, Box } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
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
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Models</h3>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="mr-1 h-6" onClick={() => openCreateDialog()}>
              <Plus className="h-4 w-4" />
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
        <Card>
          <CardContent className="p-2 sm:p-8 text-center">
            <p className="text-muted-foreground">
              No models configured. Add your first model to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {providerEntries.map(({ providerId, providerName, models }) => {
            const modelEntries = Object.entries(models)
            if (modelEntries.length === 0) return null

            return (
              <Card key={providerId}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Box className="h-4 w-4" />
                      {providerName}
                      <span className="text-xs text-muted-foreground font-normal">
                        ({modelEntries.length} model{modelEntries.length !== 1 ? 's' : ''})
                      </span>
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-2 space-y-3">
                  {modelEntries.map(([modelId, model]) => (
                    <div
                      key={modelId}
                      className="flex items-center justify-between p-2 bg-muted/50 rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{model.name || modelId}</p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {modelId}
                        </p>
                        {(model.limit?.context || model.limit?.output) && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Limits:{' '}
                            {model.limit.context && `Context ${model.limit.context}`}
                            {model.limit.context && model.limit.output && ' / '}
                            {model.limit.output && `Output ${model.limit.output}`}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(providerId, modelId, model)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteModel(providerId, modelId)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
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

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import type { ComboboxOption } from '@/components/ui/combobox'
import { getProviders } from '@/api/providers'
import { useModelStore } from '@/stores/modelStore'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ChevronDown, ChevronRight, Save, Loader2, Database, Brain, AlertCircle, RefreshCw, Play, Cpu, FileText, Layers, Syringe, MessageSquare } from 'lucide-react'
import { getPluginConfig, updatePluginConfig, reindexMemories, testEmbeddingConfig } from '@/api/memory'
import { FetchError } from '@/api/fetchWrapper'
import { settingsApi } from '@/api/settings'
import type { PluginConfig, EmbeddingProviderType } from '@opencode-manager/shared/types'
import { showToast } from '@/lib/toast'

const EMBEDDING_PROVIDERS: { value: EmbeddingProviderType; label: string }[] = [
  { value: 'local', label: 'Local (all-MiniLM-L6-v2)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'voyage', label: 'Voyage AI' },
]

const DEFAULT_CONFIGS: Record<EmbeddingProviderType, { model: string; dimensions: number }> = {
  local: { model: 'all-MiniLM-L6-v2', dimensions: 384 },
  openai: { model: 'text-embedding-3-small', dimensions: 1536 },
  voyage: { model: 'voyage-3', dimensions: 1024 },
}

interface MemoryPluginConfigProps {
  memoryPluginEnabled: boolean
  onToggle: (enabled: boolean) => void
}

export function MemoryPluginConfig({ memoryPluginEnabled, onToggle }: MemoryPluginConfigProps) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['memory-plugin-config'],
    queryFn: getPluginConfig,
    staleTime: 60000,
    enabled: memoryPluginEnabled && expanded,
  })

  const { data: providersData } = useQuery({
    queryKey: ['providers-for-execution-model'],
    queryFn: getProviders,
    staleTime: 60000,
    enabled: memoryPluginEnabled && expanded,
  })

  const recentModels = useModelStore((s) => s.recentModels)

  const executionModelOptions = useMemo<ComboboxOption[]>(() => {
    if (!providersData?.providers) return []

    const connectedProviders = providersData.providers.filter((p) => p.isConnected)

    const recentSet = new Set<string>()
    const recentOptions: ComboboxOption[] = []

    for (const recent of recentModels) {
      const modelValue = `${recent.providerID}/${recent.modelID}`
      const provider = connectedProviders.find((p) => p.id === recent.providerID)
      const model = provider?.models[recent.modelID]
      if (!model || !provider) continue
      recentSet.add(modelValue)
      recentOptions.push({
        value: modelValue,
        label: model.name || model.id,
        description: provider.name,
        group: 'Recent',
      })
    }

    const providerOptions: ComboboxOption[] = []
    for (const provider of connectedProviders.sort((a, b) => a.name.localeCompare(b.name))) {
      for (const [modelId, model] of Object.entries(provider.models)) {
        const modelValue = `${provider.id}/${modelId}`
        if (recentSet.has(modelValue)) continue
        providerOptions.push({
          value: modelValue,
          label: model.name || model.id,
          description: modelId,
          group: provider.name,
        })
      }
    }

    return [...recentOptions, ...providerOptions]
  }, [providersData, recentModels])

  const config = data?.config
  const [localConfig, setLocalConfig] = useState<PluginConfig | null>(null)

  useEffect(() => {
    if (config && !localConfig) {
      setLocalConfig(config)
    }
  }, [config, localConfig])

  const handleProviderChange = (provider: EmbeddingProviderType) => {
    if (!localConfig && !config) return
    const current = localConfig ?? config!
    const defaults = DEFAULT_CONFIGS[provider]
    setLocalConfig({
      ...current,
      embedding: {
        provider,
        model: defaults.model,
        dimensions: defaults.dimensions,
      },
    })
  }

  const updateMutation = useMutation({
    mutationFn: updatePluginConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(['memory-plugin-config'], { config: data.config })
    },
  })

  const reindexMutation = useMutation({
    mutationFn: reindexMemories,
    onSuccess: (data) => {
      if (data.requiresRestart) {
        showToast.success(data.message)
      } else {
        showToast.success(`Reindex complete: ${data.embedded}/${data.total} memories embedded`)
      }
    },
    onError: () => {
      showToast.error('Failed to reindex memories')
    },
  })

  const testMutation = useMutation({
    mutationFn: testEmbeddingConfig,
    onSuccess: (data) => {
      showToast.success(data.message || 'Configuration test passed')
    },
    onError: (error) => {
      const message = error instanceof FetchError ? error.message : 'Failed to test configuration'
      showToast.error(message)
    },
  })

  const handleReindex = () => {
    reindexMutation.mutate()
  }

  const handleTest = async () => {
    if (isDirty && localConfig) {
      await updateMutation.mutateAsync(localConfig)
    }
    testMutation.mutate()
  }

  const handleSave = async () => {
    if (!localConfig) return
    showToast.loading('Saving configuration...', { id: 'memory-save' })
    updateMutation.mutate(localConfig, {
      onSuccess: async () => {
        showToast.loading('Restarting OpenCode server...', { id: 'memory-save' })
        try {
          await settingsApi.restartOpenCodeServer()
          showToast.success('Configuration saved and server restarted', { id: 'memory-save' })
        } catch {
          showToast.error('Failed to restart server', { id: 'memory-save' })
        }
      },
      onError: () => {
        showToast.error('Failed to save configuration', { id: 'memory-save' })
      },
    })
  }

  const handleFieldChange = (field: keyof PluginConfig['embedding'], value: string | number | undefined) => {
    if (!localConfig && !config) return
    setLocalConfig({
      ...(localConfig ?? config!),
      embedding: {
        ...(localConfig?.embedding ?? config!.embedding),
        [field]: value === '' ? undefined : value,
      },
    })
  }

  const handleNestedChange = <K extends 'logging' | 'compaction' | 'memoryInjection' | 'messagesTransform' | 'tui'>(
    section: K,
    field: string,
    value: string | number | boolean | undefined,
  ) => {
    if (!localConfig && !config) return
    const current = localConfig ?? config!
    setLocalConfig({
      ...current,
      [section]: {
        ...current[section],
        [field]: value === '' ? undefined : value,
      },
    })
  }

  const displayConfig = localConfig ?? config
  const isApiProvider = displayConfig?.embedding.provider !== 'local'
  const isDirty = localConfig !== null && JSON.stringify(localConfig) !== JSON.stringify(config)

  return (
    <Card className="mt-4 border-transparent">
      <CardHeader className="py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 p-1 hover:opacity-80 transition-opacity"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Brain className="h-4 w-4 text-blue-500" />
              <CardTitle className="text-sm">Memory Plugin</CardTitle>
            </button>
            <Switch
              checked={memoryPluginEnabled}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
        <CardDescription className="text-xs">
          Configure embedding, deduplication, and storage options
        </CardDescription>
      </CardHeader>

      {memoryPluginEnabled && expanded && (
        <CardContent className="space-y-6 pt-0">
          {isLoading && (
            <div className="flex items-center gap-2 p-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-muted-foreground">Loading configuration...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-4 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>Failed to load plugin configuration</span>
            </div>
          )}

          {config && !isLoading && !error && displayConfig && (
            <>
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-medium">Embedding</span>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="provider">Provider</Label>
                    <select
                      id="provider"
                      className="flex h-10 w-full rounded-md bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={displayConfig.embedding.provider}
                      onChange={(e) => handleProviderChange(e.target.value as EmbeddingProviderType)}
                    >
                      {EMBEDDING_PROVIDERS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="model">Model</Label>
                    <Input
                      id="model"
                      value={displayConfig.embedding.model}
                      onChange={(e) => handleFieldChange('model', e.target.value)}
                      placeholder="Model name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dimensions">Dimensions</Label>
                    <Input
                      id="dimensions"
                      type="number"
                      value={displayConfig.embedding.dimensions ?? ''}
                      onChange={(e) => handleFieldChange('dimensions', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                      placeholder="384"
                    />
                  </div>

                  {isApiProvider && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="apiKey">API Key</Label>
                        <div className="relative">
                          <Input
                            id="apiKey"
                            type={showApiKey ? 'text' : 'password'}
                            value={displayConfig.embedding.apiKey ?? ''}
                            onChange={(e) => handleFieldChange('apiKey', e.target.value)}
                            placeholder="Enter API key"
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showApiKey ? <span className="text-xs">Hide</span> : <span className="text-xs">Show</span>}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="baseUrl">Base URL (optional)</Label>
                        <Input
                          id="baseUrl"
                          value={displayConfig.embedding.baseUrl ?? ''}
                          onChange={(e) => handleFieldChange('baseUrl', e.target.value)}
                          placeholder="https://api.openai.com"
                        />
                        <p className="text-xs text-muted-foreground">
                          Root URL without path — /v1/embeddings is appended automatically
                        </p>
                      </div>
                    </>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-purple-500" />
                      <span className="text-sm font-medium">Reindex</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleReindex}
                      disabled={reindexMutation.isPending}
                      className="w-full justify-start"
                    >
                      {reindexMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Reindex
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Regenerate embeddings for all memories
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 border-t pt-4">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium">Storage</span>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dedupThreshold">Deduplication Threshold</Label>
                    <div className="flex items-center gap-4">
                      <input
                        id="dedupThreshold"
                        type="range"
                        min="0"
                        max="0.4"
                        step="0.05"
                        value={displayConfig.dedupThreshold ?? 0.25}
                        onChange={(e) => {
                          setLocalConfig({
                            ...displayConfig,
                            dedupThreshold: parseFloat(e.target.value),
                          })
                        }}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground w-12">
                        {(displayConfig.dedupThreshold ?? 0.25).toFixed(2)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Lower values = more aggressive deduplication (0.0 - 0.4)
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Cpu className="h-4 w-4 text-orange-500" />
                    <span className="text-sm font-medium">Plan Execution</span>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="executionModel">Execution Model</Label>
                    <Combobox
                      value={displayConfig.executionModel ?? ''}
                      onChange={(value) => {
                        setLocalConfig({
                          ...displayConfig,
                          executionModel: value || undefined,
                        })
                      }}
                      options={executionModelOptions}
                      placeholder="default model"
                      allowCustomValue
                      showClear
                    />
                    <p className="text-xs text-muted-foreground">
                      Model used when executing plans from the Architect. Format: provider/model. Leave empty to use the current session's model.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 border-t pt-4">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm font-medium">Logging</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="loggingEnabled">Enabled</Label>
                    <Switch
                      id="loggingEnabled"
                      checked={displayConfig.logging?.enabled ?? false}
                      onCheckedChange={(checked) => handleNestedChange('logging', 'enabled', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="loggingDebug">Debug</Label>
                    <Switch
                      id="loggingDebug"
                      checked={displayConfig.logging?.debug ?? false}
                      onCheckedChange={(checked) => handleNestedChange('logging', 'debug', checked)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="loggingFile">Log File</Label>
                    <Input
                      id="loggingFile"
                      value={displayConfig.logging?.file ?? ''}
                      onChange={(e) => handleNestedChange('logging', 'file', e.target.value)}
                      placeholder="Path to log file"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers className="h-4 w-4 text-cyan-500" />
                    <span className="text-sm font-medium">Compaction</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="customPrompt">Custom Prompt</Label>
                    <Switch
                      id="customPrompt"
                      checked={displayConfig.compaction?.customPrompt ?? true}
                      onCheckedChange={(checked) => handleNestedChange('compaction', 'customPrompt', checked)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxContextTokens">Max Context Tokens</Label>
                    <Input
                      id="maxContextTokens"
                      type="number"
                      value={displayConfig.compaction?.maxContextTokens ?? 4000}
                      onChange={(e) => handleNestedChange('compaction', 'maxContextTokens', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                      placeholder="4000"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 border-t pt-4">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Syringe className="h-4 w-4 text-pink-500" />
                    <span className="text-sm font-medium">Memory Injection</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="injectionEnabled">Enabled</Label>
                    <Switch
                      id="injectionEnabled"
                      checked={displayConfig.memoryInjection?.enabled ?? true}
                      onCheckedChange={(checked) => handleNestedChange('memoryInjection', 'enabled', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="injectionDebug">Debug</Label>
                    <Switch
                      id="injectionDebug"
                      checked={displayConfig.memoryInjection?.debug ?? false}
                      onCheckedChange={(checked) => handleNestedChange('memoryInjection', 'debug', checked)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="injectionMaxTokens">Max Tokens</Label>
                    <Input
                      id="injectionMaxTokens"
                      type="number"
                      value={displayConfig.memoryInjection?.maxTokens ?? 2000}
                      onChange={(e) => handleNestedChange('memoryInjection', 'maxTokens', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                      placeholder="2000"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cacheTtlMs">Cache TTL (ms)</Label>
                    <Input
                      id="cacheTtlMs"
                      type="number"
                      value={displayConfig.memoryInjection?.cacheTtlMs ?? 30000}
                      onChange={(e) => handleNestedChange('memoryInjection', 'cacheTtlMs', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                      placeholder="30000"
                    />
                    <p className="text-xs text-muted-foreground">
                      How long injected memories are cached before re-querying
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="h-4 w-4 text-teal-500" />
                    <span className="text-sm font-medium">Messages Transform</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="transformEnabled">Enabled</Label>
                    <Switch
                      id="transformEnabled"
                      checked={displayConfig.messagesTransform?.enabled ?? true}
                      onCheckedChange={(checked) => handleNestedChange('messagesTransform', 'enabled', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="transformDebug">Debug</Label>
                    <Switch
                      id="transformDebug"
                      checked={displayConfig.messagesTransform?.debug ?? false}
                      onCheckedChange={(checked) => handleNestedChange('messagesTransform', 'debug', checked)}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers className="h-4 w-4 text-indigo-500" />
                    <span className="text-sm font-medium">TUI</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="tuiSidebar">Show Sidebar</Label>
                    <Switch
                      id="tuiSidebar"
                      checked={displayConfig.tui?.sidebar ?? true}
                      onCheckedChange={(checked) => handleNestedChange('tui', 'sidebar', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="tuiShowLoops">Show Loops</Label>
                    <Switch
                      id="tuiShowLoops"
                      checked={displayConfig.tui?.showLoops ?? true}
                      onCheckedChange={(checked) => handleNestedChange('tui', 'showLoops', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="tuiShowVersion">Show Version</Label>
                    <Switch
                      id="tuiShowVersion"
                      checked={displayConfig.tui?.showVersion ?? true}
                      onCheckedChange={(checked) => handleNestedChange('tui', 'showVersion', checked)}
                    />
                  </div>
                </div>
              </div>

              {displayConfig.dataDir && (
                <div className="space-y-2">
                  <Label>Data Directory</Label>
                  <Input value={displayConfig.dataDir} disabled className="text-muted-foreground text-xs" />
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertCircle className="h-3 w-3" />
                  <span>Server will restart automatically after saving</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTest}
                    disabled={testMutation.isPending}
                  >
                    {testMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Play className="h-4 w-4 mr-1" />
                    )}
                    Test
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!isDirty || updateMutation.isPending}
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ChevronDown, ChevronRight, Save, Loader2, Database, Brain, AlertCircle, RefreshCw, Play } from 'lucide-react'
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

  const config = data?.config
  const [localConfig, setLocalConfig] = useState<PluginConfig | null>(null)

  useEffect(() => {
    if (config && !localConfig) {
      setLocalConfig(config)
    }
  }, [config, localConfig])

  const handleProviderChange = (provider: EmbeddingProviderType) => {
    if (!localConfig && !config) return
    const defaults = DEFAULT_CONFIGS[provider]
    setLocalConfig({
      embedding: {
        provider,
        model: defaults.model,
        dimensions: defaults.dimensions,
      },
      dedupThreshold: config?.dedupThreshold ?? 0.25,
    })
  }

  const updateMutation = useMutation({
    mutationFn: updatePluginConfig,
    onSuccess: (data) => {
      showToast.success('Memory plugin configuration saved')
      queryClient.setQueryData(['memory-plugin-config'], { config: data.config })
    },
    onError: () => {
      showToast.error('Failed to save configuration')
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
    updateMutation.mutate(localConfig, {
      onSuccess: async () => {
        showToast.loading('Restarting OpenCode server...', { id: 'memory-restart' })
        try {
          await settingsApi.restartOpenCodeServer()
          showToast.success('Configuration saved and server restarted', { id: 'memory-restart' })
        } catch {
          showToast.error('Failed to restart server', { id: 'memory-restart' })
        }
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
                </div>
              </div>

              <div className="space-y-4 border-t pt-4">
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

              {displayConfig.dataDir && (
                <div className="space-y-2">
                  <Label>Data Directory</Label>
                  <Input value={displayConfig.dataDir} disabled className="text-muted-foreground text-xs" />
                </div>
              )}

              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium">Reindex</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReindex}
                    disabled={reindexMutation.isPending}
                  >
                    {reindexMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    Reindex
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Regenerate embeddings for all memories. Use when changing embedding model or if embeddings are missing.
                </p>
              </div>

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

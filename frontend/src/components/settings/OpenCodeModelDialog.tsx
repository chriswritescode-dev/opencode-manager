import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import { RefreshCw, Loader2 } from 'lucide-react'
import { settingsApi } from '@/api/settings'
import { isRecord } from '@opencode-manager/shared/utils'
import type { OpenCodeProviderConfig, OpenCodeProviderModelConfig } from '@opencode-manager/shared/opencode'
import type { OpenCodeProviderModelPatch } from '@/api/types/settings'

const handledModelKeys = new Set([
  'modelID',
  'name',
  'family',
  'releaseDate',
  'package',
  'settings',
  'headers',
  'capabilities',
  'cost',
  'variants',
  'limit',
])

type JsonObject = Record<string, unknown>

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function parseJsonObject(value: string): JsonObject | null {
  const parsed = parseJson(value)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as JsonObject
  }
  return null
}

function parseJsonContainer(value: string): JsonObject | unknown[] | null {
  const parsed = parseJson(value)
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') return parsed as JsonObject
  return null
}

function parseJsonArray(value: string): unknown[] | null {
  const parsed = parseJson(value)
  return Array.isArray(parsed) ? parsed : null
}

function stringifyJson(value: unknown): string {
  if (!value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as JsonObject).length === 0)) {
    return ''
  }

  return JSON.stringify(value, null, 2)
}

function parseOptionalJsonField(value: string): JsonObject | undefined {
  if (!value.trim()) return undefined
  return parseJsonObject(value) ?? undefined
}

function parseOptionalJsonContainerField(value: string): JsonObject | unknown[] | undefined {
  if (!value.trim()) return undefined
  return parseJsonContainer(value) ?? undefined
}

function parseOptionalJsonArrayField(value: string): unknown[] | undefined {
  if (!value.trim()) return undefined
  return parseJsonArray(value) ?? undefined
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function withRemovedKeysAsNull(previous: unknown, next: unknown): unknown {
  if (!isRecord(previous) || !isRecord(next)) return next

  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(previous)) {
    if (!(key in next)) patch[key] = null
  }
  for (const [key, value] of Object.entries(next)) {
    patch[key] = withRemovedKeysAsNull(previous[key], value)
  }
  return patch
}

function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]/g, '-')
}

function prettifyModelName(modelId: string): string {
  return modelId
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function jsonObjectField(label: string) {
  return z.string().superRefine((value, ctx) => {
    if (!value.trim()) return
    if (!parseJsonObject(value)) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} must be a valid JSON object`,
      })
    }
  })
}

function jsonContainerField(label: string) {
  return z.string().superRefine((value, ctx) => {
    if (!value.trim()) return
    if (!parseJsonContainer(value)) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} must be a valid JSON object or array`,
      })
    }
  })
}

function jsonArrayField(label: string) {
  return z.string().superRefine((value, ctx) => {
    if (!value.trim()) return
    if (!parseJsonArray(value)) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} must be a valid JSON array`,
      })
    }
  })
}

const modelFormSchema = z.object({
  providerId: z.string(),
  modelId: z.string().min(1, 'Model ID is required').regex(/^[a-zA-Z0-9._-]+$/, 'Must use only letters, numbers, dots, hyphens, and underscores'),
  backingModelId: z.string(),
  displayName: z.string(),
  family: z.string(),
  releaseDate: z.string(),
  modelPackage: z.string(),
  contextLimit: z.string(),
  inputLimit: z.string(),
  outputLimit: z.string(),
  settingsJson: jsonObjectField('Settings'),
  headersJson: jsonObjectField('Headers'),
  capabilitiesJson: jsonObjectField('Capabilities'),
  costJson: jsonContainerField('Cost'),
  variantsJson: jsonArrayField('Variants'),
  extraJson: jsonObjectField('Advanced fields'),
  createNewProvider: z.boolean(),
  newProviderType: z.enum(['api', 'npm']),
  newProviderId: z.string(),
  newProviderName: z.string().optional(),
  newProviderBaseUrl: z.string().optional(),
  newProviderPackage: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.createNewProvider) {
    if (!data.newProviderId?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'Provider ID is required when creating a new provider', path: ['newProviderId'] })
    } else if (!/^[a-z0-9-]+$/.test(data.newProviderId)) {
      ctx.addIssue({ code: 'custom', message: 'Must be lowercase letters, numbers, and hyphens only', path: ['newProviderId'] })
    }
    if (data.newProviderType === 'api' && !data.newProviderBaseUrl?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'Base URL is required for API providers', path: ['newProviderBaseUrl'] })
    }
    if (data.newProviderType === 'npm' && !data.newProviderPackage?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'NPM package is required for npm providers', path: ['newProviderPackage'] })
    }
  } else {
    if (!data.providerId?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'Provider is required', path: ['providerId'] })
    }
  }

  for (const [field, label] of [
    ['contextLimit', 'Context limit'],
    ['inputLimit', 'Input limit'],
    ['outputLimit', 'Output limit'],
  ] as const) {
    const value = data[field]
    if (value.trim() && parseOptionalNumber(value) === undefined) {
      ctx.addIssue({ code: 'custom', message: `${label} must be a number`, path: [field] })
    }
  }
})

type ModelFormValues = z.infer<typeof modelFormSchema>

export interface NewProviderConfig {
  id: string
  type: 'api' | 'npm'
  name?: string
  baseUrl?: string
  package?: string
}

interface OpenCodeModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (providerId: string, modelId: string, model: OpenCodeProviderModelPatch, newProvider?: NewProviderConfig) => void
  availableProviders: string[]
  existingProviders?: Record<string, OpenCodeProviderConfig>
  selectedProviderId: string
  editingModel?: {
    providerId: string
    modelId: string
    model: OpenCodeProviderModelConfig
  }
}

export function OpenCodeModelDialog({
  open,
  onOpenChange,
  onSubmit,
  availableProviders,
  existingProviders,
  selectedProviderId,
  editingModel,
}: OpenCodeModelDialogProps) {
  const getDefaultValues = useCallback((): ModelFormValues => {
    if (editingModel) {
      const extraEntries = Object.fromEntries(
        Object.entries(editingModel.model).filter(([key]) => !handledModelKeys.has(key))
      )

      return {
        providerId: editingModel.providerId,
        modelId: editingModel.modelId,
        backingModelId: editingModel.model.modelID || '',
        displayName: editingModel.model.name || '',
        family: editingModel.model.family || '',
        releaseDate: editingModel.model.releaseDate || '',
        modelPackage: editingModel.model.package || '',
        contextLimit: editingModel.model.limit?.context?.toString() || '',
        inputLimit: editingModel.model.limit?.input?.toString() || '',
        outputLimit: editingModel.model.limit?.output?.toString() || '',
        settingsJson: stringifyJson(editingModel.model.settings),
        headersJson: stringifyJson(editingModel.model.headers),
        capabilitiesJson: stringifyJson(editingModel.model.capabilities),
        costJson: stringifyJson(editingModel.model.cost),
        variantsJson: stringifyJson(editingModel.model.variants),
        extraJson: stringifyJson(extraEntries),
        createNewProvider: false,
        newProviderType: 'api',
        newProviderId: '',
        newProviderName: '',
        newProviderBaseUrl: '',
        newProviderPackage: '',
      }
    }

    return {
      providerId: selectedProviderId || availableProviders[0] || '',
      modelId: '',
      backingModelId: '',
      displayName: '',
      family: '',
      releaseDate: '',
      modelPackage: '',
      contextLimit: '',
      inputLimit: '',
      outputLimit: '',
      settingsJson: '',
      headersJson: '',
      capabilitiesJson: '',
      costJson: '',
      variantsJson: '',
      extraJson: '',
      createNewProvider: availableProviders.length === 0,
      newProviderType: 'api',
      newProviderId: '',
      newProviderName: '',
      newProviderBaseUrl: '',
      newProviderPackage: '',
    }
  }, [editingModel, selectedProviderId, availableProviders])

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(modelFormSchema),
    defaultValues: getDefaultValues(),
    mode: 'onChange',
  })

  const { isValid } = form.formState
  const createNewProvider = form.watch('createNewProvider')
  const newProviderType = form.watch('newProviderType')
  const watchedProviderId = form.watch('providerId')
  const watchedNewProviderBaseUrl = form.watch('newProviderBaseUrl')
  const resetKeyRef = useRef<string | null>(null)
  const resetKey = editingModel
    ? `edit-${editingModel.providerId}-${editingModel.modelId}`
    : `create-${selectedProviderId || availableProviders[0] || ''}`

  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [discoveryApiKey, setDiscoveryApiKey] = useState('')

  const discoveryBaseUrl = useMemo(() => {
    if (createNewProvider) {
      return watchedNewProviderBaseUrl?.trim() || ''
    }
    const baseURL = existingProviders?.[watchedProviderId]?.settings?.baseURL
    return typeof baseURL === 'string' ? baseURL.trim() : ''
  }, [createNewProvider, watchedNewProviderBaseUrl, watchedProviderId, existingProviders])

  const discoverModels = useCallback(async (forceRefresh = false) => {
    if (!discoveryBaseUrl) {
      setDiscoveredModels([])
      return
    }
    try {
      new URL(discoveryBaseUrl)
    } catch {
      setDiscoveredModels([])
      return
    }
    setIsLoadingModels(true)
    setDiscoveryError(null)
    try {
      const response = await settingsApi.discoverOpenCodeModels(discoveryBaseUrl, discoveryApiKey || undefined, forceRefresh)
      setDiscoveredModels(response.models)
    } catch {
      setDiscoveredModels([])
      setDiscoveryError('Failed to discover models. Check the endpoint URL and API key.')
    } finally {
      setIsLoadingModels(false)
    }
  }, [discoveryBaseUrl, discoveryApiKey])

  useEffect(() => {
    if (!open) return
    if (!discoveryBaseUrl) {
      setDiscoveredModels([])
      setDiscoveryError(null)
      return
    }
    if (createNewProvider && newProviderType !== 'api') return
    const timer = setTimeout(() => {
      void discoverModels()
    }, 600)
    return () => clearTimeout(timer)
  }, [open, discoveryBaseUrl, createNewProvider, newProviderType, discoverModels])

  const handleDiscoveredModelSelect = useCallback((modelId: string) => {
    const currentModelId = form.getValues('modelId')
    const sanitized = sanitizeModelId(modelId)
    if (!currentModelId && sanitized) {
      form.setValue('modelId', sanitized, { shouldValidate: true, shouldDirty: true })
    }
    const currentDisplayName = form.getValues('displayName')
    if (!currentDisplayName) {
      form.setValue('displayName', prettifyModelName(modelId), { shouldValidate: true, shouldDirty: true })
    }
  }, [form])

  useEffect(() => {
    if (!open) {
      resetKeyRef.current = null
      setDiscoveredModels([])
      setDiscoveryError(null)
      setDiscoveryApiKey('')
      return
    }

    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey
      form.reset(getDefaultValues())
      void form.trigger()
    }
  }, [open, resetKey, form, getDefaultValues])

  const handleSubmit = (values: ModelFormValues) => {
    const extra = parseOptionalJsonField(values.extraJson)
    const settings = parseOptionalJsonField(values.settingsJson)
    const headers = parseOptionalJsonField(values.headersJson)
    const capabilities = parseOptionalJsonField(values.capabilitiesJson)
    const cost = parseOptionalJsonContainerField(values.costJson)
    const variants = parseOptionalJsonArrayField(values.variantsJson)

    const builtModel: OpenCodeProviderModelPatch = {
      ...(extra ?? {}),
      modelID: values.backingModelId.trim() || null,
      name: values.displayName.trim() || null,
      family: values.family.trim() || null,
      releaseDate: values.releaseDate.trim() || null,
      package: values.modelPackage.trim() || null,
    }

    const contextLimit = parseOptionalNumber(values.contextLimit)
    const inputLimit = parseOptionalNumber(values.inputLimit)
    const outputLimit = parseOptionalNumber(values.outputLimit)
    builtModel.limit = contextLimit !== undefined || inputLimit !== undefined || outputLimit !== undefined
      ? {
          ...(contextLimit !== undefined ? { context: contextLimit } : {}),
          ...(inputLimit !== undefined ? { input: inputLimit } : {}),
          ...(outputLimit !== undefined ? { output: outputLimit } : {}),
        }
      : null

    builtModel.settings = (settings as OpenCodeProviderModelConfig['settings'] | undefined) ?? null
    builtModel.headers = (headers as Record<string, string> | undefined) ?? null
    builtModel.capabilities = (capabilities as OpenCodeProviderModelConfig['capabilities'] | undefined) ?? null
    builtModel.cost = (cost as OpenCodeProviderModelConfig['cost'] | undefined) ?? null
    builtModel.variants = (variants as OpenCodeProviderModelConfig['variants'] | undefined) ?? null

    const model = editingModel
      ? withRemovedKeysAsNull(editingModel.model, builtModel) as OpenCodeProviderModelPatch
      : builtModel

    let newProvider: NewProviderConfig | undefined
    if (values.createNewProvider) {
      newProvider = {
        id: values.newProviderId,
        type: values.newProviderType,
        name: values.newProviderName || undefined,
        baseUrl: values.newProviderBaseUrl || undefined,
        package: values.newProviderPackage || undefined,
      }
    }

    if (newProvider) onSubmit(values.providerId, values.modelId, model, newProvider)
    else onSubmit(values.providerId, values.modelId, model)

    form.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) form.reset()
    onOpenChange(isOpen)
  }

  const providerOptions = useMemo(() => {
    return availableProviders.map((p: string) => ({ value: p, label: existingProviders?.[p]?.name || p }))
  }, [availableProviders, existingProviders])

  const discoveredModelOptions = useMemo(
    () => discoveredModels.map((m) => ({ value: m, label: m })),
    [discoveredModels],
  )

  const isEditing = !!editingModel

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} key={editingModel ? `edit-${editingModel.modelId}` : 'create'}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>{isEditing ? 'Edit Model' : 'Create Model'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <Form {...form}>
            <div className="space-y-4">
              {!isEditing && (
                <FormField
                  control={form.control}
                  name="createNewProvider"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Create new provider</FormLabel>
                        <p className="text-xs text-muted-foreground">Add a new provider configuration</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}

              {createNewProvider ? (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                  <h4 className="text-sm font-medium">New Provider</h4>

                  <FormField control={form.control} name="newProviderType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Provider Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="api">API (HTTP endpoint)</SelectItem>
                          <SelectItem value="npm">NPM Package</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="newProviderId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Provider ID</FormLabel>
                      <FormControl><Input {...field} placeholder="e.g., my-provider" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="newProviderName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl><Input {...field} placeholder="e.g., My Provider" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {newProviderType === 'api' && (
                    <FormField control={form.control} name="newProviderBaseUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Base URL</FormLabel>
                        <FormControl><Input {...field} placeholder="e.g., https://api.openai.com/v1" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}

                  {newProviderType === 'api' && (
                    <div className="space-y-2">
                      <Label htmlFor="discovery-api-key">API Key (for discovery)</Label>
                      <Input
                        id="discovery-api-key"
                        type="password"
                        value={discoveryApiKey}
                        onChange={(e) => setDiscoveryApiKey(e.target.value)}
                        placeholder="Optional - used to fetch the model list"
                      />
                      <p className="text-xs text-muted-foreground">
                        Used only to discover available models. Configure provider auth separately via env vars or headers.
                      </p>
                    </div>
                  )}

                  {newProviderType === 'npm' && (
                    <FormField control={form.control} name="newProviderPackage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>NPM Package</FormLabel>
                        <FormControl><Input {...field} placeholder="e.g., @scope/package" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </div>
              ) : (
                <FormField control={form.control} name="providerId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={isEditing}>
                      <FormControl>
                        <SelectTrigger className={isEditing ? 'bg-muted' : ''}>
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {providerOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="modelId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Config Key</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g., qwen-3.5-27b" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="backingModelId" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Provider Model ID</FormLabel>
                      {discoveryBaseUrl && (
                        <button
                          type="button"
                          onClick={() => discoverModels(true)}
                          disabled={isLoadingModels}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                        >
                          {isLoadingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {discoveredModels.length > 0 ? 'Refresh' : 'Discover'}
                        </button>
                      )}
                    </div>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        onChange={(value) => {
                          field.onChange(value)
                          if (discoveredModels.includes(value)) {
                            handleDiscoveredModelSelect(value)
                          }
                        }}
                        options={discoveredModelOptions}
                        placeholder="e.g., MiniMax-M2.7"
                        disabled={isLoadingModels}
                        allowCustomValue={true}
                      />
                    </FormControl>
                    {discoveryError && <p className="text-xs text-destructive">{discoveryError}</p>}
                    {!discoveryError && isLoadingModels && <p className="text-xs text-muted-foreground">Discovering models...</p>}
                    {!discoveryError && !isLoadingModels && discoveredModels.length > 0 && (
                      <p className="text-xs text-muted-foreground">{discoveredModels.length} model{discoveredModels.length === 1 ? '' : 's'} found</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField control={form.control} name="displayName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g., Qwen3.5-27B" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="family" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Family</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g., minimax" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="modelPackage" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Package</FormLabel>
                    <FormControl><Input {...field} placeholder="Optional" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="releaseDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Release Date</FormLabel>
                  <FormControl><Input {...field} placeholder="YYYY-MM-DD or YYYY-MM" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField control={form.control} name="contextLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Context Limit</FormLabel>
                    <FormControl><Input {...field} inputMode="numeric" placeholder="e.g., 200000" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="inputLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Input Limit</FormLabel>
                    <FormControl><Input {...field} inputMode="numeric" placeholder="Optional" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="outputLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Output Limit</FormLabel>
                    <FormControl><Input {...field} inputMode="numeric" placeholder="e.g., 81920" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                <h4 className="text-sm font-medium">Structured JSON fields</h4>

                <FormField control={form.control} name="settingsJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Settings JSON</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "temperature": 1
}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="headersJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Headers JSON</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "Authorization": "Bearer ..."
}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="capabilitiesJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capabilities JSON</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "reasoning": true
}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="costJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost JSON</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "input": 0.1,
  "output": 0.2
}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="variantsJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Variants JSON</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`[
  { "id": "fast", "settings": {} }
]`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="extraJson" render={({ field }) => (
                <FormItem>
                  <FormLabel>Advanced Fields JSON</FormLabel>
                  <FormControl>
                    <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder="Any unsupported model fields" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </Form>
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2 pb-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1 sm:flex-none">Cancel</Button>
          <Button onClick={() => form.handleSubmit(handleSubmit)()} disabled={!isValid} className="flex-1 sm:flex-none">
            {isEditing ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

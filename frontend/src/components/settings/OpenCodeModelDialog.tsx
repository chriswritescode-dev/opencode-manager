import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCallback, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ModelConfig, ProviderConfig } from '@/api/types/settings'

type ConfigModel = Partial<ModelConfig> & {
  limit?: {
    context?: number
    input?: number
    output?: number
  }
} & Record<string, unknown>

type ConfigProvider = Omit<Partial<ProviderConfig>, 'models' | 'env'> & {
  api?: string
  npm?: string
  env?: string[]
  models?: Record<string, ConfigModel>
} & Record<string, unknown>

const handledModelKeys = new Set([
  'id',
  'providerID',
  'api',
  'name',
  'family',
  'capabilities',
  'cost',
  'limit',
  'status',
  'options',
  'headers',
  'release_date',
  'variants',
])

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function stringifyJson(value: unknown): string {
  if (!value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0)) {
    return ''
  }

  return JSON.stringify(value, null, 2)
}

function parseOptionalJsonField(value: string): Record<string, unknown> | undefined {
  if (!value.trim()) return undefined
  return parseJsonObject(value) ?? undefined
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function jsonObjectField(label: string) {
  return z.string().superRefine((value, ctx) => {
    if (!value.trim()) return
    if (!parseJsonObject(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be a valid JSON object`,
      })
    }
  })
}

const modelFormSchema = z.object({
  providerId: z.string(),
  modelId: z.string().min(1, 'Model ID is required').regex(/^[a-zA-Z0-9._-]+$/, 'Must use only letters, numbers, dots, hyphens, and underscores'),
  backingModelId: z.string(),
  providerModelProviderId: z.string(),
  displayName: z.string(),
  family: z.string(),
  status: z.enum(['none', 'alpha', 'beta', 'deprecated', 'active']),
  releaseDate: z.string(),
  apiUrl: z.string(),
  apiNpm: z.string(),
  contextLimit: z.string(),
  inputLimit: z.string(),
  outputLimit: z.string(),
  capabilitiesJson: jsonObjectField('Capabilities'),
  costJson: jsonObjectField('Cost'),
  optionsJson: jsonObjectField('Options'),
  headersJson: jsonObjectField('Headers'),
  variantsJson: jsonObjectField('Variants'),
  extraJson: jsonObjectField('Advanced fields'),
  createNewProvider: z.boolean(),
  newProviderType: z.enum(['api', 'npm']),
  newProviderId: z.string(),
  newProviderName: z.string().optional(),
  newProviderBaseUrl: z.string().optional(),
  newProviderNpm: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.createNewProvider) {
    if (!data.newProviderId?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provider ID is required when creating a new provider', path: ['newProviderId'] })
    } else if (!/^[a-z0-9-]+$/.test(data.newProviderId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be lowercase letters, numbers, and hyphens only', path: ['newProviderId'] })
    }
    if (data.newProviderType === 'api' && !data.newProviderBaseUrl?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Base URL is required for API providers', path: ['newProviderBaseUrl'] })
    }
    if (data.newProviderType === 'npm' && !data.newProviderNpm?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'NPM package is required for npm providers', path: ['newProviderNpm'] })
    }
  } else {
    if (!data.providerId?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provider is required', path: ['providerId'] })
    }
  }

  for (const [field, label] of [
    ['contextLimit', 'Context limit'],
    ['inputLimit', 'Input limit'],
    ['outputLimit', 'Output limit'],
  ] as const) {
    const value = data[field]
    if (value.trim() && parseOptionalNumber(value) === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a number`, path: [field] })
    }
  }
})

type ModelFormValues = z.infer<typeof modelFormSchema>

export interface NewProviderConfig {
  id: string
  type: 'api' | 'npm'
  name?: string
  baseUrl?: string
  npm?: string
}

interface OpenCodeModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (providerId: string, modelId: string, model: ConfigModel, newProvider?: NewProviderConfig) => void
  availableProviders: string[]
  existingProviders?: Record<string, ConfigProvider>
  selectedProviderId: string
  editingModel?: {
    providerId: string
    modelId: string
    model: ConfigModel
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
        backingModelId: typeof editingModel.model.id === 'string' ? editingModel.model.id : '',
        providerModelProviderId: typeof editingModel.model.providerID === 'string' ? editingModel.model.providerID : '',
        displayName: editingModel.model.name || '',
        family: editingModel.model.family || '',
        status: (editingModel.model.status as ModelFormValues['status']) || 'none',
        releaseDate: editingModel.model.release_date || '',
        apiUrl: editingModel.model.api?.url || '',
        apiNpm: editingModel.model.api?.npm || '',
        contextLimit: editingModel.model.limit?.context?.toString() || '',
        inputLimit: editingModel.model.limit?.input?.toString() || '',
        outputLimit: editingModel.model.limit?.output?.toString() || '',
        capabilitiesJson: stringifyJson(editingModel.model.capabilities),
        costJson: stringifyJson(editingModel.model.cost),
        optionsJson: stringifyJson(editingModel.model.options),
        headersJson: stringifyJson(editingModel.model.headers),
        variantsJson: stringifyJson(editingModel.model.variants),
        extraJson: stringifyJson(extraEntries),
        createNewProvider: false,
        newProviderType: 'api',
        newProviderId: '',
        newProviderName: '',
        newProviderBaseUrl: '',
        newProviderNpm: '',
      }
    }

    return {
      providerId: selectedProviderId || availableProviders[0] || '',
      modelId: '',
      backingModelId: '',
      providerModelProviderId: '',
      displayName: '',
      family: '',
      status: 'none',
      releaseDate: '',
      apiUrl: '',
      apiNpm: '',
      contextLimit: '',
      inputLimit: '',
      outputLimit: '',
      capabilitiesJson: '',
      costJson: '',
      optionsJson: '',
      headersJson: '',
      variantsJson: '',
      extraJson: '',
      createNewProvider: availableProviders.length === 0,
      newProviderType: 'api',
      newProviderId: '',
      newProviderName: '',
      newProviderBaseUrl: '',
      newProviderNpm: '',
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

  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues())
      void form.trigger()
    }
  }, [open, form, getDefaultValues])

  const handleSubmit = (values: ModelFormValues) => {
    const extra = parseOptionalJsonField(values.extraJson)
    const capabilities = parseOptionalJsonField(values.capabilitiesJson)
    const cost = parseOptionalJsonField(values.costJson)
    const options = parseOptionalJsonField(values.optionsJson)
    const headers = parseOptionalJsonField(values.headersJson)
    const variants = parseOptionalJsonField(values.variantsJson)

    const model: ConfigModel = {
      ...(extra || {}),
    }

    if (values.backingModelId.trim()) model.id = values.backingModelId.trim()
    if (values.providerModelProviderId.trim()) model.providerID = values.providerModelProviderId.trim()
    if (values.displayName.trim()) model.name = values.displayName.trim()
    if (values.family.trim()) model.family = values.family.trim()
    if (values.status !== 'none') model.status = values.status
    if (values.releaseDate.trim()) model.release_date = values.releaseDate.trim()

    if (values.apiUrl.trim() || values.apiNpm.trim()) {
      model.api = { url: values.apiUrl.trim(), ...(values.apiNpm.trim() ? { npm: values.apiNpm.trim() } : {}) }
    }

    const contextLimit = parseOptionalNumber(values.contextLimit)
    const inputLimit = parseOptionalNumber(values.inputLimit)
    const outputLimit = parseOptionalNumber(values.outputLimit)
    if (contextLimit !== undefined || inputLimit !== undefined || outputLimit !== undefined) {
      model.limit = {
        ...(contextLimit !== undefined ? { context: contextLimit } : {}),
        ...(inputLimit !== undefined ? { input: inputLimit } : {}),
        ...(outputLimit !== undefined ? { output: outputLimit } : {}),
      } as ConfigModel['limit']
    }

    if (capabilities) model.capabilities = capabilities as ConfigModel['capabilities']
    if (cost) model.cost = cost as ConfigModel['cost']
    if (options) model.options = options
    if (headers) model.headers = headers as Record<string, string>
    if (variants) model.variants = variants as ConfigModel['variants']

    let newProvider: NewProviderConfig | undefined
    if (values.createNewProvider) {
      newProvider = {
        id: values.newProviderId,
        type: values.newProviderType,
        name: values.newProviderName || undefined,
        baseUrl: values.newProviderBaseUrl || undefined,
        npm: values.newProviderNpm || undefined,
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

  const isEditing = !!editingModel

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

                  {newProviderType === 'npm' && (
                    <FormField control={form.control} name="newProviderNpm" render={({ field }) => (
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
                    <FormLabel>Provider Model ID</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g., MiniMax-M2.7" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="beta">Beta</SelectItem>
                        <SelectItem value="alpha">Alpha</SelectItem>
                        <SelectItem value="deprecated">Deprecated</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="releaseDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Release Date</FormLabel>
                    <FormControl><Input {...field} placeholder="YYYY-MM-DD" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="providerModelProviderId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model Provider ID</FormLabel>
                    <FormControl><Input {...field} placeholder="Optional provider override" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="apiUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>API URL</FormLabel>
                      <FormControl><Input {...field} placeholder="Optional" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="apiNpm" render={({ field }) => (
                    <FormItem>
                      <FormLabel>API NPM</FormLabel>
                      <FormControl><Input {...field} placeholder="Optional" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

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

                <FormField control={form.control} name="optionsJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Options JSON</FormLabel>
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
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "fast": {}
}`} />
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

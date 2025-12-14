import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { getProvidersWithModels } from '@/api/providers'

const agentFormSchema = z.object({
  name: z.string().min(1, 'Agent name is required').regex(/^[a-z0-9-]+$/, 'Must be lowercase letters, numbers, and hyphens only'),
  description: z.string().optional(),
  prompt: z.string().min(1, 'Prompt is required'),
  mode: z.enum(['subagent', 'primary', 'all']),
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  write: z.boolean(),
  edit: z.boolean(),
  bash: z.boolean(),
  webfetch: z.boolean(),
  editPermission: z.enum(['ask', 'allow', 'deny']),
  bashPermission: z.enum(['ask', 'allow', 'deny']),
  webfetchPermission: z.enum(['ask', 'allow', 'deny']),
  disable: z.boolean()
})

type AgentFormValues = z.infer<typeof agentFormSchema>

interface Agent {
  prompt?: string
  description?: string
  mode?: 'subagent' | 'primary' | 'all'
  temperature?: number
  topP?: number
  top_p?: number
  model?: string
  tools?: Record<string, boolean>
  permission?: {
    edit?: 'ask' | 'allow' | 'deny'
    bash?: 'ask' | 'allow' | 'deny' | Record<string, 'ask' | 'allow' | 'deny'>
    webfetch?: 'ask' | 'allow' | 'deny'
  }
  disable?: boolean
  [key: string]: unknown
}

function parseModelString(model?: string): { providerId: string; modelId: string } {
  if (!model) return { providerId: '', modelId: '' }
  const [providerId, ...rest] = model.split('/')
  return { providerId: providerId || '', modelId: rest.join('/') || '' }
}

interface AgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, agent: Agent) => void
  editingAgent?: { name: string; agent: Agent } | null
}

export function AgentDialog({ open, onOpenChange, onSubmit, editingAgent }: AgentDialogProps) {
  const parsedModel = parseModelString(editingAgent?.agent.model)
  
  const { data: providers = [] } = useQuery({
    queryKey: ['providers-with-models'],
    queryFn: () => getProvidersWithModels(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const providerOptions: ComboboxOption[] = useMemo(() => {
    const sourceLabels: Record<string, string> = {
      configured: 'Custom',
      local: 'Local',
      builtin: 'Built-in',
    }
    return providers.map(p => ({
      value: p.id,
      label: p.name || p.id,
      description: p.models.length > 0 ? `${p.models.length} models` : undefined,
      group: sourceLabels[p.source] || 'Other',
    }))
  }, [providers])

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: editingAgent?.name || '',
      description: editingAgent?.agent.description || '',
      prompt: editingAgent?.agent.prompt || '',
      mode: editingAgent?.agent.mode || 'subagent',
      temperature: editingAgent?.agent.temperature ?? 0.7,
      topP: editingAgent?.agent.topP ?? editingAgent?.agent.top_p ?? 1,
      modelId: parsedModel.modelId,
      providerId: parsedModel.providerId,
      write: editingAgent?.agent.tools?.write ?? true,
      edit: editingAgent?.agent.tools?.edit ?? true,
      bash: editingAgent?.agent.tools?.bash ?? true,
      webfetch: editingAgent?.agent.tools?.webfetch ?? true,
      editPermission: editingAgent?.agent.permission?.edit ?? 'allow',
      bashPermission: typeof editingAgent?.agent.permission?.bash === 'string' ? editingAgent.agent.permission.bash : 'allow',
      webfetchPermission: editingAgent?.agent.permission?.webfetch ?? 'allow',
      disable: editingAgent?.agent.disable ?? false
    }
  })

  const selectedProviderId = form.watch('providerId')

  const modelOptions: ComboboxOption[] = useMemo(() => {
    const selectedProvider = providers.find(p => p.id === selectedProviderId)
    if (selectedProvider && selectedProvider.models.length > 0) {
      return selectedProvider.models.map(m => ({
        value: m.id,
        label: m.name || m.id,
      }))
    }
    return providers.flatMap(p => p.models.map(m => ({
      value: m.id,
      label: m.name || m.id,
      group: p.name || p.id,
    })))
  }, [providers, selectedProviderId])

  const handleSubmit = (values: AgentFormValues) => {
    const agent: Agent = {
      prompt: values.prompt,
      description: values.description || undefined,
      mode: values.mode,
      temperature: values.temperature,
      topP: values.topP,
      disable: values.disable,
      tools: {
        write: values.write,
        edit: values.edit,
        bash: values.bash,
        webfetch: values.webfetch
      },
      permission: {
        edit: values.editPermission,
        bash: values.bashPermission,
        webfetch: values.webfetchPermission
      }
    }

    if (values.modelId && values.providerId) {
      agent.model = `${values.providerId}/${values.modelId}`
    }

    onSubmit(values.name, agent)
    form.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset()
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingAgent ? 'Edit Agent' : 'Create Agent'}</DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="my-agent"
                      disabled={!!editingAgent}
                      className={editingAgent ? 'bg-muted' : ''}
                    />
                  </FormControl>
                  <FormDescription>
                    Use lowercase letters, numbers, and hyphens only
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Brief description of what the agent does"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="prompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prompt</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="The system prompt that defines the agent's behavior and role"
                      rows={6}
                      className="font-mono text-sm"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mode</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="subagent">Subagent</SelectItem>
                        <SelectItem value="primary">Primary</SelectItem>
                        <SelectItem value="all">All</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="temperature"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Temperature</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="topP"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Top P</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Model Configuration</div>
              <div className="flex flex-col sm:grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="providerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Provider ID</FormLabel>
                      <FormControl>
                        <Combobox
                          value={field.value || ''}
                          onChange={field.onChange}
                          options={providerOptions}
                          placeholder="Select or type provider..."
                          allowCustomValue
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="modelId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model ID</FormLabel>
                      <FormControl>
                        <Combobox
                          value={field.value || ''}
                          onChange={field.onChange}
                          options={modelOptions}
                          placeholder="Select or type model..."
                          allowCustomValue
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Tools Configuration</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <FormField
                  control={form.control}
                  name="write"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Write</FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="edit"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Edit</FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bash"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Bash</FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="webfetch"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Web Fetch</FormLabel>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Permissions</div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <FormField
                  control={form.control}
                  name="editPermission"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Edit</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ask">Ask</SelectItem>
                          <SelectItem value="allow">Allow</SelectItem>
                          <SelectItem value="deny">Deny</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bashPermission"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Bash</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ask">Ask</SelectItem>
                          <SelectItem value="allow">Allow</SelectItem>
                          <SelectItem value="deny">Deny</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="webfetchPermission"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Web Fetch</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ask">Ask</SelectItem>
                          <SelectItem value="allow">Allow</SelectItem>
                          <SelectItem value="deny">Deny</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <FormField
              control={form.control}
              name="disable"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Disable agent</FormLabel>
                    <FormDescription>
                      Prevent this agent from being used
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={!form.formState.isValid}
              >
                {editingAgent ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ModelCombobox } from '@/components/model/ModelCombobox'
import { configModelRef, formatOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import { readJsonNumber } from '@/components/jsonValue'
import type { OpenCodeAgentConfig, OpenCodePermissionRule } from '@opencode-manager/shared/opencode'
import type { OpenCodeAgentPatch } from '@/api/types/settings'

const MANAGED_PERMISSION_ACTIONS = ['edit', 'shell', 'webfetch'] as const

type ManagedPermissionAction = typeof MANAGED_PERMISSION_ACTIONS[number]

type PermissionEffect = OpenCodePermissionRule['effect'] | 'inherit'

const isManagedWildcardRule = (
  rule: OpenCodePermissionRule,
): rule is OpenCodePermissionRule & { action: ManagedPermissionAction } =>
  rule.resource === '*' && MANAGED_PERMISSION_ACTIONS.some((action) => action === rule.action)

const lastMatchingRule = (
  permissions: OpenCodePermissionRule[] | undefined,
  matches: (rule: OpenCodePermissionRule) => boolean,
): OpenCodePermissionRule | undefined => {
  let match: OpenCodePermissionRule | undefined
  for (const rule of permissions ?? []) {
    if (matches(rule)) {
      match = rule
    }
  }
  return match
}

const permissionEffect = (
  permissions: OpenCodePermissionRule[] | undefined,
  action: ManagedPermissionAction,
): PermissionEffect => {
  const rule = lastMatchingRule(permissions, (entry) => entry.action === action && entry.resource === '*')
  return rule?.effect ?? 'inherit'
}

const withManagedPermissionEffects = (
  permissions: OpenCodePermissionRule[] | undefined,
  effects: Record<ManagedPermissionAction, PermissionEffect>,
): OpenCodePermissionRule[] => {
  const updated = (permissions ?? []).flatMap((rule) => {
    if (!isManagedWildcardRule(rule)) return [rule]
    const effect = effects[rule.action]
    return effect === 'inherit' ? [] : [{ ...rule, effect }]
  })
  const actionsWithWildcard = new Set(updated.filter(isManagedWildcardRule).map((rule) => rule.action))
  const fallbacks = MANAGED_PERMISSION_ACTIONS.flatMap((action) => {
    const effect = effects[action]
    return effect === 'inherit' || actionsWithWildcard.has(action) ? [] : [{ action, resource: '*', effect }]
  })
  const fallbackIndex = updated.reduce(
    (index, rule, currentIndex) => (rule.action === '*' && rule.resource === '*' ? currentIndex + 1 : index),
    0,
  )
  return [...updated.slice(0, fallbackIndex), ...fallbacks, ...updated.slice(fallbackIndex)]
}

const optionalNumber = (value: string): number | undefined => {
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

const requestBodyNumber = (agent: OpenCodeAgentConfig | undefined, key: string): number | undefined =>
  readJsonNumber(agent?.request?.body?.[key])

const withSamplingValues = (
  previous: OpenCodeAgentConfig | undefined,
  values: Record<'temperature' | 'top_p', number | undefined>,
): Pick<OpenCodeAgentPatch, 'request'> => {
  const previousBody = previous?.request?.body ?? {}
  const body: NonNullable<NonNullable<OpenCodeAgentConfig['request']>['body']> = { ...previousBody }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      body[key] = value
    } else if (key in previousBody) {
      body[key] = null
    }
  }
  const request = { ...previous?.request, body }
  const bodyHasValues = Object.values(body).some((value) => value !== null && value !== undefined)
  const requestHasOtherFields = Object.entries(request).some(
    ([key, value]) => key !== 'body' && value !== undefined && value !== null,
  )
  if (bodyHasValues || requestHasOtherFields) return { request }
  return previous?.request ? { request: null } : {}
}

const agentFormSchema = z.object({
  name: z.string().min(1, 'Agent name is required').regex(/^[a-z0-9-]+$/, 'Must be lowercase letters, numbers, and hyphens only'),
  description: z.string().optional(),
  prompt: z.string().min(1, 'Prompt is required'),
  mode: z.enum(['subagent', 'primary', 'all']),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  model: z.string().optional(),
  editPermission: z.enum(['inherit', 'ask', 'allow', 'deny']),
  shellPermission: z.enum(['inherit', 'ask', 'allow', 'deny']),
  webfetchPermission: z.enum(['inherit', 'ask', 'allow', 'deny']),
  disable: z.boolean(),
})

type AgentFormValues = z.infer<typeof agentFormSchema>

const formPermissionEffects = (values: AgentFormValues) => ({
  edit: values.editPermission,
  shell: values.shellPermission,
  webfetch: values.webfetchPermission,
})

interface AgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, agent: OpenCodeAgentPatch) => void
  editingAgent?: { name: string; agent: OpenCodeAgentConfig } | null
}

export function AgentDialog({ open, onOpenChange, onSubmit, editingAgent }: AgentDialogProps) {
  const getDefaultValues = (agent?: { name: string; agent: OpenCodeAgentConfig } | null): AgentFormValues => {
    const modelRef = configModelRef(agent?.agent.model)
    return {
      name: agent?.name || '',
      description: agent?.agent.description || '',
      prompt: agent?.agent.system || '',
      mode: agent?.agent.mode || 'subagent',
      temperature: requestBodyNumber(agent?.agent, 'temperature'),
      topP: requestBodyNumber(agent?.agent, 'top_p'),
      model: modelRef ? formatOpenCodeModelRef(modelRef) : '',
      editPermission: permissionEffect(agent?.agent.permissions, 'edit'),
      shellPermission: permissionEffect(agent?.agent.permissions, 'shell'),
      webfetchPermission: permissionEffect(agent?.agent.permissions, 'webfetch'),
      disable: agent?.agent.disabled ?? false,
    }
  }

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: getDefaultValues(editingAgent),
  })

  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues(editingAgent))
    }
  }, [open, editingAgent, form])

  const handleSubmit = (values: AgentFormValues) => {
    const previous = editingAgent?.agent
    const permissions = withManagedPermissionEffects(previous?.permissions, formPermissionEffects(values))
    const agent: OpenCodeAgentPatch = {
      ...previous,
      system: values.prompt,
      description: values.description || null,
      mode: values.mode,
      model: values.model?.trim() || null,
      disabled: values.disable,
      ...(permissions.length > 0 ? { permissions } : previous?.permissions ? { permissions: null } : {}),
      ...withSamplingValues(previous, { temperature: values.temperature, top_p: values.topP }),
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
      <DialogContent mobileFullscreen keyboardAware className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>{editingAgent ? 'Edit Agent' : 'Create Agent'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          <Form {...form}>
            <div className="space-y-4">
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
                        className="font-mono md:text-sm"
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
                          placeholder="Default"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(optionalNumber(e.target.value))}
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
                          placeholder="Default"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(optionalNumber(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl>
                      <ModelCombobox
                        id="agent-model"
                        ariaLabel="Model"
                        value={field.value || ''}
                        onChange={field.onChange}
                        enabled={open}
                        placeholder="OpenCode default"
                        allowCustomValue
                        showClear
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                            <SelectItem value="inherit">Default</SelectItem>
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
                    name="shellPermission"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Shell</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="inherit">Default</SelectItem>
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
                            <SelectItem value="inherit">Default</SelectItem>
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
            </div>
          </Form>
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2 pb-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="h-11 flex-1 sm:h-9 sm:flex-none">
            Cancel
          </Button>
          <Button
            onClick={() => form.handleSubmit(handleSubmit)()}
            disabled={!form.formState.isValid}
            className="h-11 flex-1 sm:h-9 sm:flex-none"
          >
            {editingAgent ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

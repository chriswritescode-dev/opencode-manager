import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TabsContent } from '@/components/ui/tabs'
import { Info } from 'lucide-react'

type GeneralTabProps = {
  name: string
  onNameChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  agentSlug: string
  onAgentSlugChange: (value: string) => void
  agentOptions: ComboboxOption[]
  model: string
  onModelChange: (value: string) => void
  modelOptions: ComboboxOption[]
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  showRepoSelector?: boolean
  isEditing: boolean
  repoId?: number
  onRepoChange?: (repoId: number | undefined) => void
  repoOptions: ComboboxOption[]
}

function InfoHint({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground"
    >
      <Info className="h-3.5 w-3.5" />
    </span>
  )
}

export function GeneralTab({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  agentSlug,
  onAgentSlugChange,
  agentOptions,
  model,
  onModelChange,
  modelOptions,
  enabled,
  onEnabledChange,
  showRepoSelector,
  isEditing,
  repoId,
  onRepoChange,
  repoOptions,
}: GeneralTabProps) {
  return (
    <TabsContent value="basics" className="mt-0 min-h-0 flex-1 overflow-y-auto pt-4 pb-5">
      <div className="space-y-4">
        {showRepoSelector && !isEditing && (
          <div className="space-y-2">
            <Label>Repository</Label>
            <Combobox
              value={repoId?.toString() ?? ''}
              onChange={(value) => onRepoChange?.(value ? Number(value) : undefined)}
              options={repoOptions}
              placeholder="Select a repository"
              allowCustomValue={false}
            />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="schedule-name">Name</Label>
            <Input
              id="schedule-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Nightly repo health check"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-description">Description</Label>
            <Input
              id="schedule-description"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="What this job checks or produces"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="schedule-agent">Agent slug</Label>
            <Combobox
              value={agentSlug}
              onChange={onAgentSlugChange}
              options={agentOptions}
              placeholder="Select an agent"
              allowCustomValue
              showClear
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="schedule-model">Model override</Label>
              <InfoHint text="Pick from detected OpenCode models or type a custom provider/model value." />
            </div>
            <Combobox
              value={model}
              onChange={onModelChange}
              options={modelOptions}
              placeholder="Workspace default"
              allowCustomValue
              showClear
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Enabled</p>
              <InfoHint text="Auto-run this job on its schedule while still allowing manual runs from the dashboard." />
            </div>
            <Switch checked={enabled} onCheckedChange={onEnabledChange} />
          </div>
        </div>
      </div>
    </TabsContent>
  )
}

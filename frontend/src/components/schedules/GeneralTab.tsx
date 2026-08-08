import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
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
  branch: string
  onBranchChange: (value: string) => void
  branchOptions: ComboboxOption[]
  branchesLoading: boolean
  showRepoSelector?: boolean
  isEditing: boolean
  repoId?: number
  onRepoChange?: (repoId: number | undefined) => void
  repoOptions: ComboboxOption[]
  allowExternalDirectory: boolean
  onAllowExternalDirectoryChange: (value: boolean) => void
  bashDenyPatterns: string[]
  onBashDenyPatternsChange: (value: string[]) => void
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
  branch,
  onBranchChange,
  branchOptions,
  branchesLoading,
  showRepoSelector,
  isEditing,
  repoId,
  onRepoChange,
  repoOptions,
  allowExternalDirectory,
  onAllowExternalDirectoryChange,
  bashDenyPatterns,
  onBashDenyPatternsChange,
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

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="schedule-branch">Base branch</Label>
              <InfoHint text="Scheduled runs execute in an isolated worktree branched off this base branch. Leave empty to use the repository's default branch." />
            </div>
            <Combobox
              value={branch}
              onChange={onBranchChange}
              options={branchOptions}
              placeholder={branchesLoading ? 'Loading branches…' : 'Defaults to default branch'}
              disabled={branchesLoading}
              allowCustomValue={false}
              showClear
            />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Permissions</h3>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Allow access outside the working directory</p>
                <InfoHint text="When disabled, runs are confined to the worktree. Enable to allow the agent to read/write files elsewhere on the system." />
              </div>
              <Switch checked={allowExternalDirectory} onCheckedChange={onAllowExternalDirectoryChange} />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="schedule-bash-deny">Blocked bash commands</Label>
                <InfoHint text="One glob per line. These bash commands are always blocked. The throwaway worktree (never auto-pushed) is the real safety boundary." />
              </div>
              <Textarea
                id="schedule-bash-deny"
                value={bashDenyPatterns.join('\n')}
                onChange={(event) => {
                  const patterns = event.target.value.split('\n')
                  onBashDenyPatternsChange(patterns)
                }}
                placeholder="rm -rf *"
                className="font-mono text-xs min-h-[100px]"
              />
            </div>
          </div>
        </div>
      </div>
    </TabsContent>
  )
}

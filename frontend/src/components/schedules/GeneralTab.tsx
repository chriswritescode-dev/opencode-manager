import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { ModelCombobox } from '@/components/model/ModelCombobox'
import { BranchCombobox } from '@/components/repo/BranchCombobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { TabsContent } from '@/components/ui/tabs'
import { RadioOptionGroup } from '@/components/ui/radio-option-group'
import { SandboxResourceInputs } from '@/components/sandbox/SandboxResourceInputs'
import { workspaceModeOptions } from '@/components/schedules/schedule-utils'
import type { ScheduleWorkspaceMode } from '@opencode-manager/shared/types'
import { Info } from 'lucide-react'

export type ScheduleSandboxFields = {
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  toggleDisabled: boolean
  unavailableReason: string | null
  cpus: string
  onCpusChange: (value: string) => void
  memoryGib: string
  onMemoryGibChange: (value: string) => void
  cpusPlaceholder: string
  memoryPlaceholder: string
  error: string | null
}

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
  modelDirectory?: string
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  showInInbox: boolean
  onShowInInboxChange: (value: boolean) => void
  branch: string
  onBranchChange: (value: string) => void
  branchRepoId: number | undefined
  workspaceMode: ScheduleWorkspaceMode
  onWorkspaceModeChange: (value: ScheduleWorkspaceMode) => void
  showWorkspaceMode: boolean
  showBranch?: boolean
  showRepoSelector?: boolean
  isEditing: boolean
  repoId?: number
  onRepoChange?: (repoId: number | undefined) => void
  repoOptions: ComboboxOption[]
  allowExternalDirectory: boolean
  onAllowExternalDirectoryChange: (value: boolean) => void
  allowQuestions: boolean
  onAllowQuestionsChange: (value: boolean) => void
  bashDenyPatterns: string[]
  onBashDenyPatternsChange: (value: string[]) => void
  sandbox?: ScheduleSandboxFields
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
  modelDirectory,
  enabled,
  onEnabledChange,
  showInInbox,
  onShowInInboxChange,
  branch,
  onBranchChange,
  branchRepoId,
  workspaceMode,
  onWorkspaceModeChange,
  showWorkspaceMode,
  showBranch = true,
  showRepoSelector,
  isEditing,
  repoId,
  onRepoChange,
  repoOptions,
  allowExternalDirectory,
  onAllowExternalDirectoryChange,
  allowQuestions,
  onAllowQuestionsChange,
  bashDenyPatterns,
  onBashDenyPatternsChange,
  sandbox,
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
            <ModelCombobox
              id="schedule-model"
              value={model}
              onChange={onModelChange}
              directory={modelDirectory}
              placeholder="Workspace default"
              allowCustomValue
              showClear
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <p id="schedule-enabled-label" className="text-sm font-medium">Enabled</p>
              <InfoHint text="Auto-run this job on its schedule while still allowing manual runs from the dashboard." />
            </div>
            <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-labelledby="schedule-enabled-label" />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <p id="schedule-show-in-inbox-label" className="text-sm font-medium">Show runs in inbox</p>
              <InfoHint text="When off, successful runs stay in this schedule's run history but skip the Reports inbox, its unread badge and push notifications. Failed runs are still announced." />
            </div>
            <Switch checked={showInInbox} onCheckedChange={onShowInInboxChange} aria-labelledby="schedule-show-in-inbox-label" />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          {showWorkspaceMode && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Workspace</p>
              <RadioOptionGroup
                name="schedule-workspace-mode"
                value={workspaceMode}
                onChange={onWorkspaceModeChange}
                options={workspaceModeOptions.filter((option) => option.value !== 'in-place')}
              />
            </div>
          )}
          {showBranch && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="schedule-branch">Base branch</Label>
              <InfoHint text="Runs start from origin/<branch> when it exists, so local commits that are not pushed are not included. A shared worktree continues from its own branch after the first run. Leave empty to use the repository's default branch." />
            </div>
            <BranchCombobox
              id="schedule-branch"
              repoId={branchRepoId}
              value={branch}
              onValueChange={onBranchChange}
              placeholder="Defaults to default branch"
              remotes="bare"
              clearable
            />
          </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Permissions</h3>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <p id="schedule-allow-external-label" className="text-sm font-medium">Allow access outside the working directory</p>
                <InfoHint text="When disabled, runs are confined to the worktree. Enable to allow the agent to read/write files elsewhere on the system." />
              </div>
              <Switch
                checked={allowExternalDirectory}
                onCheckedChange={onAllowExternalDirectoryChange}
                aria-labelledby="schedule-allow-external-label"
              />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <p id="schedule-allow-questions-label" className="text-sm font-medium">Allow questions</p>
                <InfoHint text="Scheduled runs are unattended. When disabled, the agent's question tool is denied so a run can never stall waiting for an answer that nobody is there to give." />
              </div>
              <Switch
                checked={allowQuestions}
                onCheckedChange={onAllowQuestionsChange}
                aria-labelledby="schedule-allow-questions-label"
              />
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

        {sandbox && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Sandbox</h3>
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <p id="schedule-sandbox-label" className="text-sm font-medium">Run in sandbox</p>
                  <p className="text-xs text-muted-foreground">
                    Each run and its subagents get a dedicated VM with Docker, removed after the run.
                  </p>
                  {sandbox.unavailableReason ? (
                    <p className="text-xs text-destructive">{sandbox.unavailableReason}</p>
                  ) : null}
                </div>
                <Switch
                  checked={sandbox.enabled}
                  onCheckedChange={sandbox.onEnabledChange}
                  disabled={sandbox.toggleDisabled}
                  aria-labelledby="schedule-sandbox-label"
                />
              </div>
              {sandbox.enabled && (
                <SandboxResourceInputs
                  idPrefix="schedule-sandbox"
                  cpus={sandbox.cpus}
                  onCpusChange={sandbox.onCpusChange}
                  memoryGib={sandbox.memoryGib}
                  onMemoryGibChange={sandbox.onMemoryGibChange}
                  cpusPlaceholder={sandbox.cpusPlaceholder}
                  memoryPlaceholder={sandbox.memoryPlaceholder}
                  error={sandbox.error}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </TabsContent>
  )
}

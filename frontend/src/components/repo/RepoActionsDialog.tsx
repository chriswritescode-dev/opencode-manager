import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, ShieldAlert } from 'lucide-react'
import { arrayMove } from '@dnd-kit/sortable'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsList, SettingsListRow, SettingsListRowActionsMenu } from '@/components/ui/settings-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useMoveProjectItem,
  useProjectConfig,
  useTrustRepoConfig,
  useUpdateProjectActions,
  useUpdateWorktreeSetup,
} from '@/api/projectConfig'
import { showToast } from '@/lib/toast'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'
import { randomId } from '@/lib/utils'
import type {
  ProjectAction,
  ProjectActionIcon,
  ProjectConfigResponse,
  ProjectItemSource,
} from '@opencode-manager/shared/types'
import { ACTION_ICON_OPTIONS, actionIcon } from './projectActionIcons'
import { TrustExecutableList } from './TrustExecutableList'

interface ActionDraft {
  id: string
  name: string
  command: string
  icon: ProjectActionIcon
  url: string
  autoOpenUrl: boolean
}

function emptyActionDraft(): ActionDraft {
  return { id: randomId(), name: '', command: '', icon: 'play', url: '', autoOpenUrl: false }
}

function actionToDraft(action: ProjectAction): ActionDraft {
  return {
    id: action.id,
    name: action.name,
    command: action.command,
    icon: action.icon ?? 'play',
    url: action.url ?? '',
    autoOpenUrl: action.autoOpenUrl,
  }
}

function actionToPayload(action: ProjectAction): ProjectAction {
  const payload: ProjectAction = {
    id: action.id,
    name: action.name,
    command: action.command,
    autoOpenUrl: action.autoOpenUrl,
  }
  if (action.icon) payload.icon = action.icon
  if (action.url) payload.url = action.url
  return payload
}

function draftToPayload(draft: ActionDraft): ProjectAction {
  const payload: ProjectAction = {
    id: draft.id,
    name: draft.name.trim(),
    command: draft.command.trim(),
    icon: draft.icon,
    autoOpenUrl: draft.autoOpenUrl,
  }
  const url = draft.url.trim()
  if (url) payload.url = url
  return payload
}

interface ActionFormProps {
  draft: ActionDraft
  isSaving: boolean
  onChange: (draft: ActionDraft) => void
  onSave: (draft: ActionDraft) => void
  onCancel: () => void
}

function ActionForm({ draft, isSaving, onChange, onSave, onCancel }: ActionFormProps) {
  const canSave = draft.name.trim().length > 0 && draft.command.trim().length > 0
  const formRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div ref={formRef} className="space-y-3 bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div className="space-y-1">
          <Label htmlFor="action-name">Name</Label>
          <Input
            id="action-name"
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="action-icon">Icon</Label>
          <Select
            value={draft.icon}
            onValueChange={(value) => onChange({ ...draft, icon: value as ProjectActionIcon })}
          >
            <SelectTrigger id="action-icon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_ICON_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="action-command">Command</Label>
        <Input
          id="action-command"
          value={draft.command}
          onChange={(event) => onChange({ ...draft, command: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="action-url">URL template</Label>
        <Input
          id="action-url"
          placeholder="http://localhost:3000/{worktree}"
          value={draft.url}
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="action-auto-open">Auto-open URL</Label>
        <Switch
          id="action-auto-open"
          checked={draft.autoOpenUrl}
          onCheckedChange={(checked) => onChange({ ...draft, autoOpenUrl: checked })}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => onSave(draft)} disabled={!canSave || isSaving}>
          Save
        </Button>
      </div>
    </div>
  )
}

type RepoFileExecutable = NonNullable<ProjectConfigResponse['repoFile']['executable']>

interface TrustReview {
  hash: string
  directory: string | undefined
  executable: RepoFileExecutable
}

const COMPACT_ROW_CLASS = 'flex-row items-center gap-3 py-2.5'

function ActionTitle({ action }: { action: ProjectAction }) {
  const Icon = actionIcon(action.icon)
  return (
    <>
      <Icon className="mr-2 inline h-4 w-4 align-[-3px] text-muted-foreground" />
      {action.name}
    </>
  )
}

function ActionUrl({ url }: { url: string | undefined }) {
  if (!url) return null
  return <p className="mt-0.5 truncate text-xs text-muted-foreground">{url}</p>
}

function TabCount({ count }: { count: number }) {
  return <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>
}

interface RepoActionsContentProps {
  repoId: number
  directory: string | undefined
  open: boolean
}

export function RepoActionsContent({ repoId, directory, open }: RepoActionsContentProps) {
  const configQuery = useProjectConfig(repoId, directory, open && !!directory)
  const updateActions = useUpdateProjectActions(repoId, directory)
  const updateSetup = useUpdateWorktreeSetup(repoId, directory)
  const trustConfig = useTrustRepoConfig(repoId)
  const moveItem = useMoveProjectItem(repoId)

  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const [setupCommands, setSetupCommands] = useState<string[]>([])
  const [focusSetupIndex, setFocusSetupIndex] = useState<number | null>(null)
  const [trustReview, setTrustReview] = useState<TrustReview | null>(null)

  const config = configQuery.data
  const repoFile = config?.repoFile

  const personalActions = useMemo(
    () => (config?.actions ?? []).filter((action) => action.source === 'personal'),
    [config],
  )
  const repoActions = useMemo(
    () => (config?.actions ?? []).filter((action) => action.source === 'repo'),
    [config],
  )
  const repoSetup = useMemo(
    () => (config?.worktreeSetup ?? []).filter((item) => item.source === 'repo'),
    [config],
  )
  const personalSetup = useMemo(
    () => (config?.worktreeSetup ?? []).filter((item) => item.source === 'personal').map((item) => item.command),
    [config],
  )
  const personalSetupBaseline = useMemo(() => JSON.stringify(personalSetup), [personalSetup])
  const setupSyncKey = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !config) {
      setupSyncKey.current = null
      setTrustReview(null)
      return
    }
    const syncKey = `${directory ?? ''}\u0000${personalSetupBaseline}`
    if (setupSyncKey.current === syncKey) return
    setupSyncKey.current = syncKey
    setSetupCommands(personalSetup)
    setFocusSetupIndex(null)
  }, [open, config, directory, personalSetup, personalSetupBaseline])

  const setupDirty = useMemo(
    () =>
      setupCommands.length !== personalSetup.length ||
      setupCommands.some((command, index) => command !== personalSetup[index]),
    [setupCommands, personalSetup],
  )
  const setupValid = setupCommands.every((command) => command.trim().length > 0)

  const handleSaveAction = (nextDraft: ActionDraft) => {
    const payload = draftToPayload(nextDraft)
    const exists = personalActions.some((action) => action.id === payload.id)
    const next = exists
      ? personalActions.map((action) => (action.id === payload.id ? payload : actionToPayload(action)))
      : [...personalActions.map(actionToPayload), payload]
    updateActions.mutate(next, {
      onSuccess: () => setDraft(null),
      onError: (error) => showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to save action')),
    })
  }

  const handleDeleteAction = (id: string) => {
    updateActions.mutate(personalActions.filter((action) => action.id !== id).map(actionToPayload), {
      onError: (error) => showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to delete action')),
    })
  }

  const handleSaveSetup = () => {
    updateSetup.mutate(setupCommands.map((command) => command.trim()), {
      onError: (error) => showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to save setup commands')),
    })
  }

  const addSetupCommand = () => {
    setFocusSetupIndex(setupCommands.length)
    setSetupCommands((current) => [...current, ''])
  }

  const needsTrust = Boolean(repoFile?.exists && !repoFile.trusted && repoFile.hash && repoFile.executable)

  const openTrustReview = () => {
    if (!repoFile?.hash || !repoFile.executable) return
    setTrustReview({ hash: repoFile.hash, directory, executable: repoFile.executable })
  }

  const handleTrust = () => {
    if (!trustReview) return
    trustConfig.mutate(
      { hash: trustReview.hash, directory: trustReview.directory },
      {
        onSuccess: () => setTrustReview(null),
        onError: (error) => showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to trust repository commands')),
      },
    )
  }

  const moveAction = (action: ProjectAction, to: ProjectItemSource) => {
    moveItem.mutate(
      { kind: 'action', id: action.id, to, directory },
      { onError: (error) => showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to move action')) },
    )
  }

  const moveSetup = (command: string, to: ProjectItemSource) => {
    moveItem.mutate(
      { kind: 'setup', command, to, directory },
      { onError: (error) => showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to move setup command')) },
    )
  }

  const isAddingAction = draft !== null && !personalActions.some((action) => action.id === draft.id)
  const hasRepoFileStatus = Boolean(repoFile?.error) || (repoFile?.warnings.length ?? 0) > 0 || needsTrust

  const renderActionForm = (current: ActionDraft) => (
    <ActionForm
      key={current.id}
      draft={current}
      isSaving={updateActions.isPending}
      onChange={setDraft}
      onSave={handleSaveAction}
      onCancel={() => setDraft(null)}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {configQuery.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : !config ? (
        <p className="px-4 py-4 text-sm text-destructive sm:px-6">
          {configQuery.error instanceof Error ? configQuery.error.message : 'No configuration available.'}
        </p>
      ) : (
        <>
          {hasRepoFileStatus && (
            <div className="shrink-0 space-y-2 px-4 pt-3 sm:px-6">
              {config.repoFile.error && (
                <p role="alert" className="text-sm text-destructive">
                  {config.repoFile.error}
                </p>
              )}
              {config.repoFile.warnings.map((warning) => (
                <p key={warning} className="text-xs text-warning">
                  {warning}
                </p>
              ))}
              {needsTrust && (
                <div className="flex items-center gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Repository commands are not trusted</p>
                    <p className="text-xs text-muted-foreground">They won't run until you review and trust them.</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={openTrustReview}>
                    Review
                  </Button>
                </div>
              )}
            </div>
          )}

          <Tabs defaultValue="actions" className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 px-4 pt-3 sm:px-6">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="actions">
                  Actions
                  <TabCount count={personalActions.length + repoActions.length} />
                </TabsTrigger>
                <TabsTrigger value="setup">
                  Worktree setup
                  <TabCount count={setupCommands.length + repoSetup.length} />
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="actions" className="mt-0 flex min-h-0 flex-1 flex-col px-0">
              <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <p className="text-xs text-muted-foreground">Start these from the actions menu in the header.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setDraft(emptyActionDraft())}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add action
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
                <SettingsList
                  isEmpty={personalActions.length === 0 && repoActions.length === 0 && !isAddingAction}
                  emptyTitle="No actions configured"
                  emptyHint="Add a command you run often, like a dev server or test watcher."
                  maxHeightClassName="max-h-none"
                >
                  {personalActions.map((action) =>
                    draft?.id === action.id ? (
                      renderActionForm(draft)
                    ) : (
                      <SettingsListRow
                        key={action.id}
                        className={COMPACT_ROW_CLASS}
                        title={<ActionTitle action={action} />}
                        description={<span className="font-mono" title={action.command}>{action.command}</span>}
                        belowDescription={<ActionUrl url={action.url} />}
                        onClick={() => setDraft(actionToDraft(action))}
                        trailing={
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Edit ${action.name}`}
                            onClick={() => setDraft(actionToDraft(action))}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        }
                        actions={[
                          {
                            label: 'Move to repository',
                            onClick: () => moveAction(action, 'repo'),
                            disabled: moveItem.isPending,
                          },
                          {
                            label: 'Delete',
                            destructive: true,
                            separatorBefore: true,
                            onClick: () => handleDeleteAction(action.id),
                            disabled: updateActions.isPending,
                          },
                        ]}
                        actionsLabel={`Actions for ${action.name}`}
                      />
                    ),
                  )}
                  {isAddingAction && draft && renderActionForm(draft)}
                  {repoActions.map((action) => (
                    <SettingsListRow
                      key={`repo:${action.id}`}
                      className={COMPACT_ROW_CLASS}
                      title={<ActionTitle action={action} />}
                      badges={<Badge variant="secondary" className="shrink-0">In repo</Badge>}
                      description={<span className="font-mono" title={action.command}>{action.command}</span>}
                      belowDescription={<ActionUrl url={action.url} />}
                      actions={[
                        {
                          label: 'Move to my settings',
                          onClick: () => moveAction(action, 'personal'),
                          disabled: moveItem.isPending,
                        },
                      ]}
                      actionsLabel={`Actions for ${action.name}`}
                    />
                  ))}
                </SettingsList>
              </div>
            </TabsContent>

            <TabsContent value="setup" className="mt-0 flex min-h-0 flex-1 flex-col px-0">
              <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <p className="text-xs text-muted-foreground">
                  Run in order after a new worktree is created.{' '}
                  <code className="font-mono">$ROOT_PROJECT_PATH</code> points to the main checkout.
                </p>
                <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={addSetupCommand}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add command
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
                <SettingsList
                  isEmpty={setupCommands.length === 0 && repoSetup.length === 0}
                  emptyTitle="No setup commands"
                  emptyHint="Add commands such as pnpm install to prepare new worktrees."
                  maxHeightClassName="max-h-none"
                >
                  {setupCommands.map((command, index) => (
                    <div key={index} className="flex items-center gap-1 bg-card px-3 py-2">
                      <Input
                        aria-label={`Setup command ${index + 1}`}
                        autoFocus={index === focusSetupIndex}
                        value={command}
                        className="mr-1 h-9 min-w-0 flex-1 font-mono md:text-xs"
                        onChange={(event) =>
                          setSetupCommands((current) =>
                            current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                          )
                        }
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => setSetupCommands((current) => arrayMove(current, index, index - 1))}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        aria-label="Move down"
                        disabled={index === setupCommands.length - 1}
                        onClick={() => setSetupCommands((current) => arrayMove(current, index, index + 1))}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <SettingsListRowActionsMenu
                        label={`Actions for setup command ${index + 1}`}
                        actions={[
                          {
                            label: 'Move to repository',
                            onClick: () => moveSetup(command, 'repo'),
                            disabled: setupDirty || moveItem.isPending,
                          },
                          {
                            label: 'Remove',
                            destructive: true,
                            separatorBefore: true,
                            onClick: () =>
                              setSetupCommands((current) => current.filter((_, itemIndex) => itemIndex !== index)),
                          },
                        ]}
                      />
                    </div>
                  ))}
                  {repoSetup.map((item) => (
                    <SettingsListRow
                      key={`repo:${item.command}`}
                      className={COMPACT_ROW_CLASS}
                      title={<span title={item.command}>{item.command}</span>}
                      titleClassName="font-mono text-xs font-normal"
                      badges={<Badge variant="secondary" className="shrink-0">In repo</Badge>}
                      actions={[
                        {
                          label: 'Move to my settings',
                          onClick: () => moveSetup(item.command, 'personal'),
                          disabled: moveItem.isPending,
                        },
                      ]}
                      actionsLabel={`Actions for ${item.command}`}
                    />
                  ))}
                </SettingsList>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {setupDirty ? 'Unsaved changes' : ''}
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveSetup}
                  disabled={!setupDirty || !setupValid || updateSetup.isPending}
                >
                  Save setup
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      <ConfirmDestructiveDialog
        open={open && trustReview !== null}
        onOpenChange={(next) => { if (!next) setTrustReview(null) }}
        onConfirm={handleTrust}
        onCancel={() => setTrustReview(null)}
        title="Trust repository commands"
        description="This repository defines commands that run on your machine."
        warning={trustReview ? <TrustExecutableList executable={trustReview.executable} /> : undefined}
        confirmLabel="Trust these commands"
        pendingLabel="Trusting…"
        isPending={trustConfig.isPending}
      />
    </div>
  )
}

interface RepoActionsDialogProps {
  repoId: number
  directory: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoActionsDialog({ repoId, directory, open, onOpenChange }: RepoActionsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        mobileFullscreen
        className="flex flex-col gap-0 overflow-hidden p-0 pb-safe sm:h-auto sm:max-h-[85vh] sm:max-w-[560px] sm:p-0"
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
          <DialogTitle>Project Actions</DialogTitle>
          <DialogDescription>Commands and setup steps for this location.</DialogDescription>
        </DialogHeader>

        <RepoActionsContent repoId={repoId} directory={directory} open={open} />
      </DialogContent>
    </Dialog>
  )
}

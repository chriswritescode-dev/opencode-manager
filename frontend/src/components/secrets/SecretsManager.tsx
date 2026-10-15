import { useId, useState, type FormEvent } from 'react'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { useDeleteSecret, useSecretEntries, useSetSecret } from '@/hooks/useSecrets'
import { copyTextToClipboard } from '@/lib/clipboard'
import { showToast } from '@/lib/toast'
import { formatShortRelativeTime } from '@/lib/utils'
import {
  EnvironmentNameSchema,
  SecretNameSchema,
  SecretValueSchema,
  type SecretEntry,
  type SecretKind,
} from '@opencode-manager/shared/schemas'
import type { SecretScope } from '@/api/secrets'

const KIND_META: Record<SecretKind, { label: string; namespace: string; emptyHint: string }> = {
  secret: {
    label: 'Secret',
    namespace: 'secrets',
    emptyHint: 'Secret values are encrypted and never shown again once saved.',
  },
  variable: {
    label: 'Variable',
    namespace: 'vars',
    emptyHint: 'Variable values are stored in plain text and shown here.',
  },
}

function secretReference(kind: SecretKind, name: string): string {
  return `\${{ ${KIND_META[kind].namespace}.${name} }}`
}

const PROJECT_CONFIG_EXAMPLE = `{
  "version": 1,
  "environment": "e2e",
  "env": {
    "OPENAI_API_KEY": "\${{ secrets.OPENAI_API_KEY }}",
    "BASE_URL": "\${{ vars.BASE_URL }}"
  }
}`

interface SecretsManagerProps {
  scope: SecretScope
}

export function SecretsManager({ scope }: SecretsManagerProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Values are injected into sessions only when the repository maps them in{' '}
        <code className="font-mono">.ocm/project.json</code>, for example:
      </p>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
        {PROJECT_CONFIG_EXAMPLE}
      </pre>
      <p className="text-xs text-muted-foreground">
        Precedence: environment &gt; repository &gt; global. The same reference text works in a GitHub workflow.
      </p>

      <Tabs defaultValue="secret">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="secret">Secrets</TabsTrigger>
          <TabsTrigger value="variable">Variables</TabsTrigger>
        </TabsList>
        <TabsContent value="secret" className="mt-2 px-0">
          <SecretKindPanel scope={scope} kind="secret" />
        </TabsContent>
        <TabsContent value="variable" className="mt-2 px-0">
          <SecretKindPanel scope={scope} kind="variable" />
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface SecretFormState {
  name: string
  value: string
  environment: string
}

interface SecretKindPanelProps {
  scope: SecretScope
  kind: SecretKind
}

function SecretKindPanel({ scope, kind }: SecretKindPanelProps) {
  const meta = KIND_META[kind]
  const isRepoScope = scope.scope === 'repo'
  const nameId = useId()
  const environmentId = useId()
  const valueId = useId()

  const entriesQuery = useSecretEntries(scope, kind)
  const setSecret = useSetSecret(scope)
  const deleteSecret = useDeleteSecret(scope)

  const [form, setForm] = useState<SecretFormState | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<SecretEntry | null>(null)

  const entries = entriesQuery.data ?? []

  const startAdd = () => {
    setIsEditing(false)
    setFormError(null)
    setForm({ name: '', value: '', environment: '' })
  }

  const startEdit = (entry: SecretEntry) => {
    setIsEditing(true)
    setFormError(null)
    setForm({ name: entry.name, value: '', environment: entry.environment ?? '' })
  }

  const cancelForm = () => {
    setForm(null)
    setIsEditing(false)
    setFormError(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form) return

    const nameResult = SecretNameSchema.safeParse(form.name)
    if (!nameResult.success) {
      setFormError(nameResult.error.issues[0]?.message ?? 'Invalid name')
      return
    }

    const valueResult = SecretValueSchema.safeParse(form.value)
    if (!valueResult.success) {
      setFormError(valueResult.error.issues[0]?.message ?? 'Invalid value')
      return
    }

    let environment: string | undefined
    const trimmedEnvironment = form.environment.trim()
    if (isRepoScope && trimmedEnvironment) {
      const environmentResult = EnvironmentNameSchema.safeParse(trimmedEnvironment)
      if (!environmentResult.success) {
        setFormError(environmentResult.error.issues[0]?.message ?? 'Invalid environment')
        return
      }
      environment = environmentResult.data
    }

    setFormError(null)
    try {
      await setSecret.mutateAsync({ kind, name: nameResult.data, value: valueResult.data, environment })
      showToast.success(`${meta.label} ${isEditing ? 'updated' : 'saved'}`)
      cancelForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : `Failed to save ${meta.label.toLowerCase()}`)
    }
  }

  const handleRemove = async () => {
    if (!removeTarget) return
    try {
      await deleteSecret.mutateAsync({
        kind,
        name: removeTarget.name,
        environment: removeTarget.environment ?? undefined,
      })
      showToast.success(`${meta.label} removed`)
      setRemoveTarget(null)
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : `Failed to remove ${meta.label.toLowerCase()}`)
    }
  }

  const handleCopyReference = async (entry: SecretEntry) => {
    const copied = await copyTextToClipboard(secretReference(kind, entry.name))
    if (copied) showToast.success('Reference copied')
    else showToast.error('Failed to copy reference')
  }

  return (
    <div className="space-y-3">
      {form ? (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border bg-card p-3">
          <div className="space-y-1">
            <Label htmlFor={nameId}>{meta.label} name</Label>
            <Input
              id={nameId}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value.toUpperCase() })}
              placeholder="MY_NAME"
              className="font-mono"
              autoComplete="off"
              disabled={isEditing}
            />
          </div>

          {isRepoScope && (
            <div className="space-y-1">
              <Label htmlFor={environmentId}>Environment (optional)</Label>
              <Input
                id={environmentId}
                value={form.environment}
                onChange={(event) => setForm({ ...form, environment: event.target.value })}
                placeholder="e.g. e2e"
                className="font-mono"
                autoComplete="off"
                disabled={isEditing}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor={valueId}>{meta.label} value</Label>
            <Textarea
              id={valueId}
              value={form.value}
              onChange={(event) => setForm({ ...form, value: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {formError && (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={cancelForm}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={setSecret.isPending}>
              {setSecret.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={startAdd}>
          <Plus className="h-3 w-3 mr-1" />
          Add {meta.label.toLowerCase()}
        </Button>
      )}

      <SettingsList
        isLoading={entriesQuery.isLoading}
        error={entriesQuery.error as Error | null}
        isEmpty={entries.length === 0}
        emptyTitle={`No ${meta.label.toLowerCase()}s yet`}
        emptyHint={meta.emptyHint}
        maxHeightClassName="max-h-none"
      >
        {entries.map((entry) => (
          <SettingsListRow
            key={`${entry.name}\u0000${entry.environment ?? ''}`}
            className="flex-row items-center gap-2 py-2.5"
            title={<span className="font-mono">{entry.name}</span>}
            badges={entry.environment ? <Badge variant="secondary">{entry.environment}</Badge> : undefined}
            description={
              <span>
                Updated {formatShortRelativeTime(new Date(entry.updatedAt))}
                {kind === 'variable' && entry.value !== undefined ? ` · ${entry.value}` : ''}
              </span>
            }
            trailing={
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Copy reference for ${entry.name}`}
                  onClick={() => handleCopyReference(entry)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Update ${entry.name}`}
                  onClick={() => startEdit(entry)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${entry.name}`}
                  onClick={() => setRemoveTarget(entry)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            }
          />
        ))}
      </SettingsList>

      <DeleteDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
        title={`Remove ${meta.label}`}
        description={`This removes the ${meta.label.toLowerCase()} from this scope. Sessions that reference it will no longer receive a value.`}
        itemName={removeTarget?.name}
        isDeleting={deleteSecret.isPending}
      />
    </div>
  )
}

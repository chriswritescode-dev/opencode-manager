import { useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, Loader2, Pencil, Plus, Trash2, XCircle } from 'lucide-react'
import type {
  CreateOpenCodeServerRequest,
  OpenCodeServer,
  OpenCodeServerTestResult,
  UpdateOpenCodeServerRequest,
} from '@opencode-manager/shared/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { showToast } from '@/lib/toast'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { OpenCodeServerDialog, type OpenCodeServerFormValues } from './OpenCodeServerDialog'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function ServerTestResult({ result }: { result: OpenCodeServerTestResult }) {
  if (!result.ok) {
    return (
      <div className="flex items-start gap-2 text-sm text-destructive">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="break-words">{result.error ?? 'Connection failed'}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      <span>OpenCode {result.version ?? 'unknown version'}</span>
      {result.versionSupported ? (
        <Badge variant="secondary">Supported</Badge>
      ) : (
        <Badge variant="destructive">Unsupported version</Badge>
      )}
    </div>
  )
}

export function OpenCodeServersSettings() {
  const {
    servers,
    isLoading,
    error,
    createAsync,
    isCreating,
    updateAsync,
    isUpdating,
    deleteAsync,
    isDeleting,
    testAsync,
    testByIdAsync,
  } = useOpenCodeServers()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<OpenCodeServer | null>(null)
  const [deletingServer, setDeletingServer] = useState<OpenCodeServer | null>(null)
  const [testingServerId, setTestingServerId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, OpenCodeServerTestResult>>({})

  const openAddDialog = () => {
    setEditingServer(null)
    setIsDialogOpen(true)
  }

  const openEditDialog = (server: OpenCodeServer) => {
    setEditingServer(server)
    setIsDialogOpen(true)
  }

  const handleDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open)
    if (!open) setEditingServer(null)
  }

  const handleSubmit = async (values: OpenCodeServerFormValues) => {
    if (editingServer) {
      const input: UpdateOpenCodeServerRequest = {
        name: values.name,
        baseUrl: values.baseUrl,
        username: values.username,
        enabled: values.enabled,
      }
      if (values.pairing) input.pairing = values.pairing
      else if (values.clearPassword) input.password = null
      else if (values.password) input.password = values.password
      await updateAsync({ id: editingServer.id, input })
      showToast.success('Server updated')
      return
    }

    const input: CreateOpenCodeServerRequest = {
      name: values.name,
      baseUrl: values.baseUrl,
      username: values.username,
      enabled: values.enabled,
    }
    if (values.pairing) input.pairing = values.pairing
    else if (values.password) input.password = values.password
    const { test } = await createAsync(input)
    if (test.ok) {
      showToast.success(`Server added${test.version ? ` — OpenCode ${test.version}` : ''}`)
    } else {
      showToast.warning(`Server added, but the connection test failed: ${test.error ?? 'unknown error'}`)
    }
  }

  const handleTest = async (values: OpenCodeServerFormValues) => {
    if (editingServer && !values.password) {
      return testByIdAsync(editingServer.id)
    }
    return testAsync({
      baseUrl: values.baseUrl,
      username: values.username,
      password: values.password || undefined,
    })
  }

  const toggleEnabled = async (server: OpenCodeServer, enabled: boolean) => {
    try {
      await updateAsync({ id: server.id, input: { enabled } })
    } catch (updateError) {
      showToast.error(errorMessage(updateError, 'Failed to update server'))
    }
  }

  const runTest = async (server: OpenCodeServer) => {
    setTestingServerId(server.id)
    setTestResults((current) => {
      const next = { ...current }
      delete next[server.id]
      return next
    })
    try {
      const result = await testByIdAsync(server.id)
      setTestResults((current) => ({ ...current, [server.id]: result }))
    } catch (testError) {
      showToast.error(errorMessage(testError, 'Connection test failed'))
    } finally {
      setTestingServerId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deletingServer) return
    try {
      await deleteAsync(deletingServer.id)
      showToast.success('Server deleted')
      setDeletingServer(null)
    } catch (deleteError) {
      showToast.error(errorMessage(deleteError, 'Failed to delete server'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Linked servers</h2>
          <p className="text-sm text-muted-foreground">
            Remote OpenCode servers this Manager can connect to. Disabled servers stay configured but are not used.
          </p>
        </div>
        <Button type="button" size="sm" onClick={openAddDialog} disabled={isCreating}>
          <Plus className="mr-2 h-4 w-4" />
          Add server
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading servers...
        </div>
      )}

      {!isLoading && error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage(error, 'Failed to load servers')}</span>
        </div>
      )}

      {!isLoading && !error && servers.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No linked servers. Add one with a pairing QR code or by entering its URL and credentials.
          </p>
        </div>
      )}

      {servers.length > 0 && (
        <div className="space-y-3">
          {servers.map((server) => (
            <div key={server.id} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{server.name}</span>
                    <Badge variant={server.hasPassword ? 'secondary' : 'outline'}>
                      {server.hasPassword ? 'Password set' : 'No password'}
                    </Badge>
                    {!server.enabled && <Badge variant="outline">Disabled</Badge>}
                  </div>
                  <p className="break-all text-sm text-muted-foreground">{server.baseUrl}</p>
                  <p className="text-xs text-muted-foreground">Username: {server.username}</p>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <Switch
                    checked={server.enabled}
                    onCheckedChange={(checked) => void toggleEnabled(server, checked)}
                    disabled={isUpdating}
                    aria-label={`Enable ${server.name}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void runTest(server)}
                    disabled={testingServerId === server.id}
                  >
                    {testingServerId === server.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Activity className="mr-2 h-4 w-4" />
                    )}
                    Test
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${server.name}`}
                    onClick={() => openEditDialog(server)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${server.name}`}
                    onClick={() => setDeletingServer(server)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              {testResults[server.id] && <ServerTestResult result={testResults[server.id]} />}
            </div>
          ))}
        </div>
      )}

      <OpenCodeServerDialog
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        server={editingServer}
        onSubmit={handleSubmit}
        onTest={handleTest}
      />

      <DeleteDialog
        open={Boolean(deletingServer)}
        onOpenChange={(open) => !open && setDeletingServer(null)}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeletingServer(null)}
        title="Delete Server"
        description="Remove this linked server from the Manager. Its sessions stay on the remote server."
        itemName={deletingServer?.name}
        isDeleting={isDeleting}
      />
    </div>
  )
}

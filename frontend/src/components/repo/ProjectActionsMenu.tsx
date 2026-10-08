import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalInfo } from '@opencode-manager/shared/types'
import { FetchError } from '@opencode-manager/shared'
import { isRunningActionTerminal } from '@opencode-manager/shared/utils'
import type {
  ProjectConfigResponse,
  RunProjectActionResponse,
} from '@opencode-manager/shared/types'
import { Play, Square } from 'lucide-react'
import {
  getProjectConfig,
  useProjectConfig,
  useRunProjectAction,
  useTrustRepoConfig,
} from '@/api/projectConfig'
import { useRemoveTerminal, useTerminals } from '@/api/terminals'
import { Button } from '@/components/ui/button'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { openDialogParam } from '@/hooks/useDialogParam'
import { useOpenPreview } from '@/hooks/useOpenPreview'
import { useOpenTerminal } from '@/hooks/useOpenTerminal'
import { useUrlParams } from '@/hooks/useUrlParams'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'
import { openUrlFromManager } from '@/lib/open-url'
import { showToast } from '@/lib/toast'
import { TrustExecutableList } from './TrustExecutableList'
import { actionIcon } from './projectActionIcons'

interface ProjectActionsMenuProps {
  repoId: number
  directory: string | undefined
}

interface PendingTrust {
  actionId: string
  hash: string
  directory: string
  executable: NonNullable<ProjectConfigResponse['repoFile']['executable']>
}

function untrustedHash(error: unknown): string | null {
  if (!(error instanceof FetchError) || error.code !== 'REPO_CONFIG_UNTRUSTED') return null
  const details = error.details
  if (details && typeof details === 'object' && typeof (details as { hash?: unknown }).hash === 'string') {
    return (details as { hash: string }).hash
  }
  return null
}

export function ProjectActionsMenu({ repoId, directory }: ProjectActionsMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { updateParams } = useUrlParams()
  const openPreview = useOpenPreview()
  const openTerminal = useOpenTerminal()
  const configQuery = useProjectConfig(repoId, directory, menuOpen && !!directory)
  const terminalsQuery = useTerminals(repoId, directory, {
    enabled: menuOpen && !!directory,
    refetchInterval: menuOpen ? 5000 : false,
  })
  const runAction = useRunProjectAction(repoId, directory)
  const removeTerminal = useRemoveTerminal(repoId)
  const trustConfig = useTrustRepoConfig(repoId)
  const [pendingTrust, setPendingTrust] = useState<PendingTrust | null>(null)
  const scopeRef = useRef({ repoId, directory })

  useEffect(() => {
    scopeRef.current = { repoId, directory }
    setPendingTrust(null)
  }, [repoId, directory])

  const actions = useMemo<ProjectConfigResponse['actions']>(
    () => configQuery.data?.actions ?? [],
    [configQuery.data],
  )

  const runningByAction = useMemo(() => {
    const map = new Map<string, TerminalInfo>()
    for (const terminal of terminalsQuery.data ?? []) {
      if (terminal.actionId && isRunningActionTerminal(terminal, terminal.actionId)) {
        map.set(terminal.actionId, terminal)
      }
    }
    return map
  }, [terminalsQuery.data])

  const handleRunSuccess = useCallback((result: RunProjectActionResponse) => {
    openTerminal(result.terminal.id)
    if (result.autoOpenUrl && result.resolvedUrl) {
      openUrlFromManager(result.resolvedUrl, { openPreview })
    }
  }, [openTerminal, openPreview])

  const requestTrustConfirmation = useCallback(async (actionId: string, hash: string) => {
    const requestDirectory = directory
    if (!requestDirectory) return
    let snapshot: ProjectConfigResponse
    try {
      snapshot = await getProjectConfig(repoId, requestDirectory)
    } catch (error) {
      showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to verify repository actions'))
      return
    }
    const scope = scopeRef.current
    if (scope.repoId !== repoId || scope.directory !== requestDirectory) return
    const repoAction = snapshot.actions.find(
      (action) => action.id === actionId && action.source === 'repo',
    )
    const executable = snapshot.repoFile.executable
    if (snapshot.repoFile.hash !== hash || !repoAction || !executable) {
      showToast.error('Repository actions changed. Reopen the menu to review them.')
      return
    }
    setPendingTrust({ actionId, hash, directory: requestDirectory, executable })
  }, [directory, repoId])

  const startRun = useCallback((actionId: string) => {
    runAction.mutate(actionId, {
      onSuccess: handleRunSuccess,
      onError: (error) => {
        const hash = untrustedHash(error)
        if (hash) {
          void requestTrustConfirmation(actionId, hash)
          return
        }
        showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to run action'))
      },
    })
  }, [runAction, handleRunSuccess, requestTrustConfirmation])

  const handleConfirmTrust = useCallback(() => {
    if (!pendingTrust) return
    const { actionId, hash, directory: trustDirectory } = pendingTrust
    const origin = { repoId, directory: trustDirectory }
    trustConfig.mutate({ hash, directory: trustDirectory }, {
      onSuccess: () => {
        const scope = scopeRef.current
        if (scope.repoId !== origin.repoId || scope.directory !== origin.directory) return
        setPendingTrust(null)
        startRun(actionId)
      },
      onError: (error) => showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to trust repository commands')),
    })
  }, [pendingTrust, trustConfig, startRun, repoId])

  const handleStop = useCallback((terminal: TerminalInfo) => {
    removeTerminal.mutate({ ptyID: terminal.id, directory }, {
      onError: (error) => showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to stop action')),
    })
  }, [removeTerminal, directory])

  const handleManage = useCallback(() => {
    openDialogParam(updateParams, 'actions')
  }, [updateParams])

  if (!directory) return null

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Project actions"
            className="h-10 w-10 text-muted-foreground hover:text-foreground sm:h-8 sm:w-8"
          >
            <Play className="h-5 w-5 sm:h-4 sm:w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {actions.length === 0 ? (
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              No actions configured
            </DropdownMenuLabel>
          ) : (
            actions.map((action) => {
              const Icon = actionIcon(action.icon)
              const running = runningByAction.get(action.id)
              return (
                <Fragment key={action.id}>
                  <DropdownMenuItem disabled={runAction.isPending} onSelect={() => startRun(action.id)}>
                    <Icon className="mr-2 h-4 w-4" />
                    <span className="truncate">{action.name}</span>
                    {running && (
                      <span
                        data-testid="action-running-dot"
                        className="ml-auto h-2 w-2 rounded-full bg-primary"
                      />
                    )}
                  </DropdownMenuItem>
                  {running && (
                    <DropdownMenuItem onSelect={() => handleStop(running)}>
                      <Square className="mr-2 h-4 w-4" />
                      Stop
                    </DropdownMenuItem>
                  )}
                </Fragment>
              )
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleManage}>Manage actions…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDestructiveDialog
        open={pendingTrust !== null}
        onOpenChange={(open) => { if (!open) setPendingTrust(null) }}
        onConfirm={handleConfirmTrust}
        onCancel={() => setPendingTrust(null)}
        title="Trust repository actions"
        description="This repository defines commands that run on your machine."
        warning={pendingTrust ? <TrustExecutableList executable={pendingTrust.executable} /> : undefined}
        confirmLabel="Trust and run"
        pendingLabel="Trusting…"
        isPending={trustConfig.isPending}
      />
    </>
  )
}

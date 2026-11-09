import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileBrowserSheet } from '@/components/file-browser/FileBrowserSheet'
import { PreviewPanel } from '@/components/preview/PreviewPanel'
import { MultiRunSheet } from '@/components/repo/MultiRunSheet'
import { RepoActionsDialog } from '@/components/repo/RepoActionsDialog'
import { RepoMcpDialog } from '@/components/repo/RepoMcpDialog'
import { RepoSecretsDialog } from '@/components/secrets/RepoSecretsDialog'
import { RepoSkillsDialog } from '@/components/repo/RepoSkillsDialog'
import { ResetPermissionsDialog } from '@/components/repo/ResetPermissionsDialog'
import { RemoteSourceControlPanel } from '@/components/source-control/RemoteSourceControlContent'
import { SourceControlPanel } from '@/components/source-control/SourceControlPanel'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'
import { useTerminalDirectoryParam } from '@/hooks/useOpenTerminal'
import { useUrlParams } from '@/hooks/useUrlParams'
import { parseProjectTarget } from '@/lib/projectTarget'
import { repoQueryOptions } from '@/lib/repoQuery'
import { getRepoDisplayName } from '@/lib/utils'

const DIALOG_OWNED_PARAMS: Readonly<Record<string, readonly string[]>> = {
  terminal: ['terminal', 'terminalDirectory'],
  preview: ['previewPort', 'previewPath'],
}

interface ProjectToolsState {
  dialog: string | null
  terminalDirectory: string | null
  closeDialog: (name: string) => void
}

interface RepoProjectToolsProps extends ProjectToolsState {
  repoId: number
}

interface ServerProjectToolsProps extends ProjectToolsState {
  serverId: string
  directory: string
}

function closeOnOpenChange(closeDialog: (name: string) => void, name: string): (open: boolean) => void {
  return (open) => {
    if (!open) closeDialog(name)
  }
}

function closeOnClick(closeDialog: (name: string) => void, name: string): () => void {
  return () => closeDialog(name)
}

/**
 * Hosts the repository and linked-server tool dialogs for the project in the `toolProject` param, so a
 * tool opened for one project renders in the current route without the route's own dialogs taking over.
 */
export function ProjectToolsHost() {
  const { searchParams, updateParams } = useUrlParams()
  const terminalDirectory = useTerminalDirectoryParam()
  const target = parseProjectTarget(searchParams.get('toolProject'))
  const dialog = searchParams.get('dialog')

  const closeDialog = useCallback((name: string) => {
    updateParams((params) => {
      if (params.get('dialog') !== name) return
      params.delete('dialog')
      params.delete('toolProject')
      for (const param of DIALOG_OWNED_PARAMS[name] ?? []) params.delete(param)
    }, 'replace')
  }, [updateParams])

  if (target === null) return null

  const state = { dialog, terminalDirectory, closeDialog }

  return target.kind === 'repo' ? (
    <RepoProjectTools repoId={target.repoId} {...state} />
  ) : (
    <ServerProjectTools serverId={target.serverId} directory={target.directory} {...state} />
  )
}

function RepoProjectTools({ repoId, dialog, terminalDirectory, closeDialog }: RepoProjectToolsProps) {
  const { data: repo } = useQuery(repoQueryOptions(repoId))

  if (!repo) return null

  const currentBranch = repo.currentBranch || repo.branch || 'main'

  return (
    <>
      <FileBrowserSheet
        isOpen={dialog === 'files'}
        onClose={closeOnClick(closeDialog, 'files')}
        basePath={repo.localPath}
        repoName={getRepoDisplayName(repo)}
        repoId={repoId}
        allowNavigateAboveBase
      />
      <RepoMcpDialog
        open={dialog === 'mcp'}
        onOpenChange={closeOnOpenChange(closeDialog, 'mcp')}
        directory={repo.fullPath}
      />
      <RepoSkillsDialog
        open={dialog === 'skills'}
        onOpenChange={closeOnOpenChange(closeDialog, 'skills')}
        repoId={repoId}
      />
      <RepoSecretsDialog
        open={dialog === 'secrets'}
        onOpenChange={closeOnOpenChange(closeDialog, 'secrets')}
        repoId={repoId}
      />
      <SourceControlPanel
        repoId={repoId}
        isOpen={dialog === 'sourceControl'}
        onClose={closeOnClick(closeDialog, 'sourceControl')}
        currentBranch={currentBranch}
        repoName={getRepoDisplayName(repo)}
      />
      <TerminalPanel
        target={{ kind: 'repo', repoId }}
        directory={terminalDirectory ?? repo.fullPath}
        isOpen={dialog === 'terminal'}
        onClose={closeOnClick(closeDialog, 'terminal')}
      />
      <PreviewPanel
        isOpen={dialog === 'preview'}
        onClose={closeOnClick(closeDialog, 'preview')}
        directory={repo.fullPath}
      />
      <ResetPermissionsDialog
        open={dialog === 'resetPermissions'}
        onOpenChange={closeOnOpenChange(closeDialog, 'resetPermissions')}
        repoId={repoId}
      />
      <RepoActionsDialog
        repoId={repoId}
        directory={repo.fullPath}
        open={dialog === 'actions'}
        onOpenChange={closeOnOpenChange(closeDialog, 'actions')}
      />
      <MultiRunSheet
        target={{ kind: 'repo', repoId }}
        directory={repo.fullPath}
        defaultBaseRef={currentBranch}
        open={dialog === 'multiRun'}
        onOpenChange={closeOnOpenChange(closeDialog, 'multiRun')}
      />
    </>
  )
}

function ServerProjectTools({ serverId, directory, dialog, terminalDirectory, closeDialog }: ServerProjectToolsProps) {
  return (
    <>
      <RepoMcpDialog
        open={dialog === 'mcp'}
        onOpenChange={closeOnOpenChange(closeDialog, 'mcp')}
        directory={directory}
      />
      <RepoSkillsDialog
        open={dialog === 'skills'}
        onOpenChange={closeOnOpenChange(closeDialog, 'skills')}
        directory={directory}
      />
      <RemoteSourceControlPanel
        serverId={serverId}
        directory={directory}
        isOpen={dialog === 'sourceControl'}
        onClose={closeOnClick(closeDialog, 'sourceControl')}
      />
      <TerminalPanel
        target={{ kind: 'server', serverId }}
        directory={terminalDirectory ?? directory}
        isOpen={dialog === 'terminal'}
        onClose={closeOnClick(closeDialog, 'terminal')}
      />
    </>
  )
}

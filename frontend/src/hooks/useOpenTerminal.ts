import { useCallback } from 'react'
import { openDialogParam, useDialogParam, useRouteDialogParam } from './useDialogParam'
import { useUrlParams } from './useUrlParams'

const TERMINAL_DIALOG = 'terminal'
const TERMINAL_DIALOG_PARAMS = ['terminal', 'terminalDirectory'] as const

export function useTerminalDialogParam(): [boolean, (open: boolean) => void] {
  return useDialogParam(TERMINAL_DIALOG, TERMINAL_DIALOG_PARAMS)
}

export function useRouteTerminalDialogParam(): [boolean, (open: boolean) => void] {
  return useRouteDialogParam(TERMINAL_DIALOG, TERMINAL_DIALOG_PARAMS)
}

/**
 * The directory the terminal dialog was opened for, such as a repo worktree; null means the repo itself.
 */
export function useTerminalDirectoryParam(): string | null {
  const { searchParams } = useUrlParams()
  return searchParams.get('terminalDirectory')
}

export function useOpenTerminal(): (
  terminalId: string | null,
  extraParams?: Record<string, string>,
) => void {
  const { updateParams } = useUrlParams()

  return useCallback(
    (terminalId: string | null, extraParams?: Record<string, string>) => {
      openDialogParam(updateParams, TERMINAL_DIALOG, { ...(terminalId ? { terminal: terminalId } : {}), ...extraParams })
    },
    [updateParams],
  )
}

import { useCallback } from 'react'
import { openDialogParam, useDialogParam } from './useDialogParam'
import { useUrlParams } from './useUrlParams'

const TERMINAL_DIALOG = 'terminal'
const TERMINAL_DIALOG_PARAMS = ['terminal', 'terminalDirectory'] as const

export function useTerminalDialogParam(): [boolean, (open: boolean) => void] {
  return useDialogParam(TERMINAL_DIALOG, TERMINAL_DIALOG_PARAMS)
}

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
      const params: Record<string, string> = terminalId
        ? { terminal: terminalId, ...extraParams }
        : { ...extraParams }
      openDialogParam(updateParams, TERMINAL_DIALOG, params)
    },
    [updateParams],
  )
}

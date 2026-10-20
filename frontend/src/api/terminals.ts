import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateTerminalRequest, ResizeTerminalRequest, TerminalInfo } from '@opencode-manager/shared/types'
import { API_BASE_URL } from '@/config'
import { terminalCollectionPath, terminalItemPath, terminalTargetScope, type TerminalTarget } from '@/lib/terminal-target'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

function terminalsQueryKey(target: TerminalTarget, directory: string | undefined) {
  return ['terminals', terminalTargetScope(target), directory ?? null] as const
}

function terminalsScopeQueryKey(target: TerminalTarget) {
  return ['terminals', terminalTargetScope(target)] as const
}

async function listTerminals(target: TerminalTarget, directory?: string): Promise<TerminalInfo[]> {
  const data = await fetchWrapper<{ terminals: TerminalInfo[] }>(
    `${API_BASE_URL}${terminalCollectionPath(target)}`,
    { params: { directory } },
  )
  return data.terminals
}

async function createTerminal(target: TerminalTarget, body: CreateTerminalRequest): Promise<TerminalInfo> {
  return fetchWrapper<TerminalInfo>(`${API_BASE_URL}${terminalCollectionPath(target)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function resizeTerminal(
  target: TerminalTarget,
  ptyID: string,
  body: ResizeTerminalRequest,
): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}${terminalItemPath(target, ptyID)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function removeTerminal(target: TerminalTarget, ptyID: string, directory?: string): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}${terminalItemPath(target, ptyID)}`, {
    method: 'DELETE',
    params: { directory },
  })
}

interface UseTerminalsOptions {
  enabled: boolean
  refetchInterval?: number | false
}

export function useTerminals(target: TerminalTarget, directory: string | undefined, options: UseTerminalsOptions) {
  return useQuery({
    queryKey: terminalsQueryKey(target, directory),
    queryFn: () => listTerminals(target, directory),
    enabled: options.enabled,
    refetchInterval: options.refetchInterval,
  })
}

export function useCreateTerminal(target: TerminalTarget) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateTerminalRequest) => createTerminal(target, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: terminalsScopeQueryKey(target) })
    },
  })
}

interface RemoveTerminalVariables {
  ptyID: string
  directory?: string
}

export function useRemoveTerminal(target: TerminalTarget) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ptyID, directory }: RemoveTerminalVariables) => removeTerminal(target, ptyID, directory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: terminalsScopeQueryKey(target) })
    },
  })
}

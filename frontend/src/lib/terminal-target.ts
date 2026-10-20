export type TerminalTarget =
  | { kind: 'repo'; repoId: number }
  | { kind: 'server'; serverId: string }

export function terminalTargetScope(target: TerminalTarget): number | string {
  return target.kind === 'repo' ? target.repoId : target.serverId
}

export function terminalTargetKey(target: TerminalTarget): string {
  return target.kind === 'repo' ? `repo:${target.repoId}` : `server:${target.serverId}`
}

export function terminalCollectionPath(target: TerminalTarget): string {
  return target.kind === 'repo'
    ? `/api/repos/${target.repoId}/terminals`
    : `/api/opencode-servers/${encodeURIComponent(target.serverId)}/terminals`
}

export function terminalItemPath(target: TerminalTarget, ptyID: string): string {
  return `${terminalCollectionPath(target)}/${encodeURIComponent(ptyID)}`
}

export function terminalConnectPath(target: TerminalTarget, ptyID: string): string {
  return `${terminalItemPath(target, ptyID)}/connect`
}

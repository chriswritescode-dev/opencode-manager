export type TerminalTarget =
  | { kind: 'repo'; repoId: number }
  | { kind: 'server'; serverId: string }
  | { kind: 'chat'; chatId: string }

export function terminalTargetScope(target: TerminalTarget): number | string {
  switch (target.kind) {
    case 'repo':
      return target.repoId
    case 'server':
      return target.serverId
    case 'chat':
      return target.chatId
  }
}

export function terminalTargetKey(target: TerminalTarget): string {
  switch (target.kind) {
    case 'repo':
      return `repo:${target.repoId}`
    case 'server':
      return `server:${target.serverId}`
    case 'chat':
      return `chat:${target.chatId}`
  }
}

export function terminalCollectionPath(target: TerminalTarget): string {
  switch (target.kind) {
    case 'repo':
      return `/api/repos/${target.repoId}/terminals`
    case 'server':
      return `/api/opencode-servers/${encodeURIComponent(target.serverId)}/terminals`
    case 'chat':
      return `/api/chats/${encodeURIComponent(target.chatId)}/terminals`
  }
}

export function terminalItemPath(target: TerminalTarget, ptyID: string): string {
  return `${terminalCollectionPath(target)}/${encodeURIComponent(ptyID)}`
}

export function terminalConnectPath(target: TerminalTarget, ptyID: string): string {
  return `${terminalItemPath(target, ptyID)}/connect`
}

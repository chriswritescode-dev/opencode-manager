import { openCodeErrorStatus } from '@opencode-manager/shared/opencode'
import { formatTerminalTitle, parseTerminalTitle } from '@opencode-manager/shared/utils'
import type { TerminalInfo, TerminalKind } from '@opencode-manager/shared/types'
import type { OpenCodeClient } from './opencode/client'
import type { CredentialProvider } from './credential-provider'
import { toWebSocketUrl } from './opencode/upstream'
import { bridgeWebSocket, type WebSocketBridge, type WebSocketPeer } from '../utils/websocket-bridge'
import { TerminalHub, TerminalHubRegistry } from './terminal-hub'

type OpenCodePty = Awaited<ReturnType<OpenCodeClient['api']['pty']['list']>>['data'][number]
type OpenCodePersistentPty = Awaited<ReturnType<OpenCodeClient['api']['experimental']['persistentPty']['list']>>[number]

export interface CreateTerminalInput {
  kind: TerminalKind
  name: string
  actionId?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
}

export interface TerminalSize {
  cols: number
  rows: number
}

export interface TerminalTarget {
  client: OpenCodeClient
  baseUrl: () => string
  includeLocalCredentials: boolean
}

export class TerminalNotFoundError extends Error {
  constructor(ptyID: string) {
    super(`Terminal not found: ${ptyID}`)
    this.name = 'TerminalNotFoundError'
  }
}

const DEFERRED_START_SHELL = '/bin/sh'
const DEFERRED_START_SCRIPT = 'sleep 0.3; exec "$@"'
const DEFERRED_START_HANDLE = 'ocm-terminal'
const DEFERRED_START_KINDS: ReadonlySet<TerminalKind> = new Set(['action', 'setup'])

function deferCommandStart(command: string, args: readonly string[]): { command: string; args: string[] } {
  return {
    command: DEFERRED_START_SHELL,
    args: ['-c', DEFERRED_START_SCRIPT, DEFERRED_START_HANDLE, command, ...args],
  }
}

export class TerminalService {
  constructor(
    private readonly target: TerminalTarget,
    private readonly credentialProvider: CredentialProvider,
    private readonly openSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
    private readonly hubs: TerminalHubRegistry = new TerminalHubRegistry(),
  ) {}

  forTarget(target: TerminalTarget): TerminalService {
    return new TerminalService(target, this.credentialProvider, this.openSocket, this.hubs)
  }

  async list(directory: string): Promise<TerminalInfo[]> {
    const result = await this.target.client.api.pty.list({ location: { directory } })
    return result.data.map((pty) => this.toTerminalInfo(pty))
  }

  async create(directory: string, input: CreateTerminalInput): Promise<TerminalInfo> {
    const deferred =
      input.command !== undefined && DEFERRED_START_KINDS.has(input.kind) && process.platform !== 'win32'
        ? deferCommandStart(input.command, input.args ?? [])
        : undefined
    const result = await this.target.client.api.pty.create({
      location: { directory },
      title: formatTerminalTitle({ kind: input.kind, name: input.name, actionId: input.actionId }),
      ...(deferred
        ? { command: deferred.command, args: deferred.args }
        : {
            ...(input.command !== undefined ? { command: input.command } : {}),
            ...(input.args !== undefined ? { args: input.args } : {}),
          }),
      env: {
        ...(this.target.includeLocalCredentials ? this.credentialProvider.getGhCliEnv({ cwd: directory }) : {}),
        ...input.env,
      },
    })
    const terminal = this.toTerminalInfo(result.data)
    this.recordTerminal(directory, terminal.id)
    return terminal
  }

  private recordTerminal(directory: string, ptyID: string): void {
    const key = this.hubKey(directory, ptyID)
    if (this.hubs.get(key)) return
    const hub = new TerminalHub({ openUpstream: () => this.openUpstreamSocket(directory, ptyID, 0) })
    this.hubs.register(key, hub)
    void hub.start()
  }

  private hubKey(directory: string, ptyID: string): string {
    return `${this.target.baseUrl()}\u0000${directory}\u0000${ptyID}`
  }

  async requireTerminal(directory: string, ptyID: string): Promise<TerminalInfo> {
    const terminals = await this.list(directory)
    const terminal = terminals.find((entry) => entry.id === ptyID)
    if (!terminal) {
      throw new TerminalNotFoundError(ptyID)
    }
    return terminal
  }

  async resize(directory: string, ptyID: string, size: TerminalSize): Promise<void> {
    await this.target.client.api.pty.update({ ptyID, location: { directory }, size })
  }

  async remove(directory: string, ptyID: string): Promise<void> {
    try {
      await this.target.client.api.pty.remove({ ptyID, location: { directory } })
    } finally {
      this.hubs.dispose(this.hubKey(directory, ptyID))
    }
  }

  async removeAll(directory: string): Promise<void> {
    const terminals = await this.list(directory)
    for (const terminal of terminals) {
      try {
        await this.remove(directory, terminal.id)
      } catch (error: unknown) {
        if (openCodeErrorStatus(error) === 404) continue
        throw error
      }
    }
    await this.removePersistentTerminals(directory)
  }

  async connect(
    directory: string,
    ptyID: string,
    cursor: number | undefined,
    peer: WebSocketPeer,
  ): Promise<WebSocketBridge> {
    await this.requireTerminal(directory, ptyID)

    const key = this.hubKey(directory, ptyID)
    const hub = this.hubs.get(key)
    if (hub?.isAvailable()) return hub.attach(peer, cursor)
    if (hub) this.hubs.dispose(key)

    return bridgeWebSocket(await this.openUpstreamSocket(directory, ptyID, cursor), peer)
  }

  private async openUpstreamSocket(
    directory: string,
    ptyID: string,
    cursor: number | undefined,
  ): Promise<WebSocket> {
    const result = await this.target.client.api.pty.connect.token({
      ptyID,
      location: { directory },
      'x-opencode-ticket': '1',
    })

    const base = new URL(this.target.baseUrl())
    if (!base.pathname.endsWith('/')) base.pathname += '/'
    const socketUrl = new URL(`api/pty/${encodeURIComponent(ptyID)}/connect`, base)
    socketUrl.searchParams.set('ticket', result.data.ticket)
    socketUrl.searchParams.set('location[directory]', directory)
    if (cursor !== undefined) socketUrl.searchParams.set('cursor', String(cursor))

    return this.openSocket(toWebSocketUrl(socketUrl.toString()))
  }

  private async removePersistentTerminals(directory: string): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.target.client.api.session.list({ directory, cursor })
      for (const session of page.data) {
        await this.removeSessionPersistentTerminals(session.id)
      }
      cursor = page.cursor.next ?? undefined
    } while (cursor !== undefined)
  }

  private async removeSessionPersistentTerminals(sessionID: string): Promise<void> {
    let terminals: OpenCodePersistentPty[]
    try {
      terminals = await this.target.client.api.experimental.persistentPty.list({ sessionID })
    } catch (error: unknown) {
      if (openCodeErrorStatus(error) === 404) return
      throw error
    }

    for (const terminal of terminals) {
      try {
        await this.target.client.api.experimental.persistentPty.remove({ ptyID: terminal.id })
      } catch (error: unknown) {
        if (openCodeErrorStatus(error) === 404) continue
        throw error
      }
    }
  }

  private toTerminalInfo(pty: OpenCodePty): TerminalInfo {
    const parsed = parseTerminalTitle(pty.title)
    return {
      id: pty.id,
      title: parsed.title,
      kind: parsed.kind,
      ...(parsed.actionId ? { actionId: parsed.actionId } : {}),
      cwd: pty.cwd,
      status: pty.status,
      ...(pty.exitCode !== undefined ? { exitCode: pty.exitCode } : {}),
    }
  }
}

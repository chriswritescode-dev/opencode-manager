import { openCodeErrorStatus } from '@opencode-manager/shared/opencode'
import { formatTerminalTitle, parseTerminalTitle } from '@opencode-manager/shared/utils'
import type { TerminalInfo, TerminalKind } from '@opencode-manager/shared/types'
import type { OpenCodeClient } from './opencode/client'
import type { CredentialProvider } from './credential-provider'
import { toWebSocketUrl } from './opencode/upstream'
import { bridgeWebSocket, type WebSocketBridge, type WebSocketPeer } from '../utils/websocket-bridge'

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

export class TerminalNotFoundError extends Error {
  constructor(ptyID: string) {
    super(`Terminal not found: ${ptyID}`)
    this.name = 'TerminalNotFoundError'
  }
}

export class TerminalService {
  constructor(
    private readonly openCodeClient: OpenCodeClient,
    private readonly credentialProvider: CredentialProvider,
    private readonly upstreamBaseUrl: () => string,
    private readonly openSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}

  async list(directory: string): Promise<TerminalInfo[]> {
    const result = await this.openCodeClient.api.pty.list({ location: { directory } })
    return result.data.map((pty) => this.toTerminalInfo(pty))
  }

  async create(directory: string, input: CreateTerminalInput): Promise<TerminalInfo> {
    const result = await this.openCodeClient.api.pty.create({
      location: { directory },
      title: formatTerminalTitle({ kind: input.kind, name: input.name, actionId: input.actionId }),
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.args !== undefined ? { args: input.args } : {}),
      env: { ...this.credentialProvider.getGhCliEnv({ cwd: directory }), ...input.env },
    })
    return this.toTerminalInfo(result.data)
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
    await this.openCodeClient.api.pty.update({ ptyID, location: { directory }, size })
  }

  async remove(directory: string, ptyID: string): Promise<void> {
    await this.openCodeClient.api.pty.remove({ ptyID, location: { directory } })
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

    const result = await this.openCodeClient.api.pty.connect.token({
      ptyID,
      location: { directory },
      'x-opencode-ticket': '1',
    })

    const base = new URL(this.upstreamBaseUrl())
    if (!base.pathname.endsWith('/')) base.pathname += '/'
    const socketUrl = new URL(`api/pty/${encodeURIComponent(ptyID)}/connect`, base)
    socketUrl.searchParams.set('ticket', result.data.ticket)
    socketUrl.searchParams.set('location[directory]', directory)
    if (cursor !== undefined) socketUrl.searchParams.set('cursor', String(cursor))

    return bridgeWebSocket(this.openSocket(toWebSocketUrl(socketUrl.toString())), peer)
  }

  private async removePersistentTerminals(directory: string): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.openCodeClient.api.session.list({ directory, cursor })
      for (const session of page.data) {
        await this.removeSessionPersistentTerminals(session.id)
      }
      cursor = page.cursor.next ?? undefined
    } while (cursor !== undefined)
  }

  private async removeSessionPersistentTerminals(sessionID: string): Promise<void> {
    let terminals: OpenCodePersistentPty[]
    try {
      terminals = await this.openCodeClient.api.experimental.persistentPty.list({ sessionID })
    } catch (error: unknown) {
      if (openCodeErrorStatus(error) === 404) return
      throw error
    }

    for (const terminal of terminals) {
      try {
        await this.openCodeClient.api.experimental.persistentPty.remove({ ptyID: terminal.id })
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

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { TerminalService, TerminalNotFoundError } from '../../src/services/terminal'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { CredentialProvider } from '../../src/services/credential-provider'
import { createStubOpenCodeClient, sessionInfo, type OpenCodeApiOverrides } from '../helpers/stub-opencode-client'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'
import { FakePeer, FakeWebSocket } from '../helpers/fake-websocket'

type PtyApi = OpenCodeClient['api']['pty']
type PersistentPtyApi = OpenCodeClient['api']['experimental']['persistentPty']
type SessionApi = OpenCodeClient['api']['session']
type OpenCodePty = Awaited<ReturnType<PtyApi['list']>>['data'][number]
type PersistentPty = Awaited<ReturnType<PersistentPtyApi['list']>>[number]
type PtyCreateInput = Parameters<PtyApi['create']>[0]
type SessionInfo = Awaited<ReturnType<SessionApi['list']>>['data'][number]

function createPty(overrides: Partial<OpenCodePty> = {}): OpenCodePty {
  return { id: 'pty-1', title: 'Terminal', command: 'sh', args: [], cwd: '/repo', status: 'running', pid: 1, ...overrides }
}

function createPersistentPty(id: string, sessionID: string): PersistentPty {
  return {
    id,
    sessionID,
    title: 'Terminal',
    command: 'sh',
    args: [],
    cwd: '/repo',
    status: 'running',
    pid: 1,
    userTitle: null,
    foregroundProcess: null,
    size: { cols: 80, rows: 24 },
    output: { head: 0, tail: 0 },
  }
}

const DEFERRED_SCRIPT = 'stty -echo 2>/dev/null; IFS= read -r _; stty echo 2>/dev/null; exec "$@"'

function deferredArgs(command: string, args: string[]): string[] {
  return ['-c', DEFERRED_SCRIPT, 'ocm-terminal', command, ...args]
}

function createClient(pty: OpenCodeApiOverrides['pty'] = {}, api: OpenCodeApiOverrides = {}): OpenCodeClient {
  return createStubOpenCodeClient({
    api: {
      ...api,
      pty: {
        connect: {
          token: vi.fn<PtyApi['connect']['token']>(async () => ({
            location: { directory: '/repo' },
            data: { ticket: 'hub-ticket', expires_in: 60 },
          })),
        },
        ...pty,
      },
    },
  })
}

interface SocketFactory {
  openSocket: (url: string) => WebSocket
  sockets: FakeWebSocket[]
}

function createSocketFactory(): SocketFactory {
  const sockets: FakeWebSocket[] = []
  return {
    sockets,
    openSocket: (url) => {
      const socket = new FakeWebSocket(url)
      sockets.push(socket)
      return socket
    },
  }
}

function createCredentialProvider(shellEnv: Record<string, string> = {}): Pick<CredentialProvider, 'getGhCliEnv'> {
  return { getGhCliEnv: vi.fn(() => shellEnv) }
}

function stubPersistentPtys(client: OpenCodeClient, overrides: Partial<PersistentPtyApi>): OpenCodeClient {
  Object.assign(client.api.experimental.persistentPty, overrides)
  return client
}

function createTerminalService(
  client: OpenCodeClient,
  provider: Pick<CredentialProvider, 'getGhCliEnv'>,
  openSocket: (url: string) => WebSocket = createSocketFactory().openSocket,
  baseUrl = 'http://127.0.0.1:5551',
  includeLocalEnv = true,
): TerminalService {
  return new TerminalService(
    { client, baseUrl: () => baseUrl, includeLocalEnv },
    provider,
    createStubRepoEnvService(),
    openSocket,
  )
}

const MetaFrameSchema = z.object({ cursor: z.number() })

function metaCursor(chunk: string | Uint8Array<ArrayBuffer> | undefined): number {
  if (!(chunk instanceof Uint8Array)) {
    throw new Error('Expected a binary terminal meta frame')
  }
  expect(chunk[0]).toBe(0)
  return MetaFrameSchema.parse(JSON.parse(new TextDecoder().decode(chunk.subarray(1)))).cursor
}

describe('TerminalService', () => {
  describe('list', () => {
    it('passes the location and decodes each terminal title', async () => {
      const list = vi.fn<PtyApi['list']>(async () => ({
        location: { directory: '/repo' },
        data: [
          createPty({ id: 'a', title: 'Terminal' }),
          createPty({ id: 'b', title: 'ocm:setup:Worktree setup' }),
          createPty({ id: 'c', title: 'ocm:action:build:Build', status: 'exited', exitCode: 0 }),
        ],
      }))
      const service = createTerminalService(createClient({ list }), createCredentialProvider())

      const result = await service.list('/repo')

      expect(list).toHaveBeenCalledWith({ location: { directory: '/repo' } })
      expect(result).toEqual([
        { id: 'a', title: 'Terminal', kind: 'shell', cwd: '/repo', status: 'running' },
        { id: 'b', title: 'Worktree setup', kind: 'setup', cwd: '/repo', status: 'running' },
        { id: 'c', title: 'Build', kind: 'action', actionId: 'build', cwd: '/repo', status: 'exited', exitCode: 0 },
      ])
    })
  })

  describe('create', () => {
    it('sends the location, encoded title and merged environment', async () => {
      const create = vi.fn<PtyApi['create']>(async () => ({
        location: { directory: '/repo' },
        data: createPty({ id: 'pty-new', title: 'ocm:action:dev:Dev server' }),
      }))
      const credentialProvider = createCredentialProvider({ GH_TOKEN: 'gh' })
      const service = createTerminalService(createClient({ create }), credentialProvider)

      const result = await service.create('/repo', {
        kind: 'action',
        actionId: 'dev',
        name: 'Dev server',
        command: '/bin/sh',
        args: ['-c', 'npm run dev'],
        env: { FOO: 'bar' },
      })

      expect(credentialProvider.getGhCliEnv).toHaveBeenCalledWith({ cwd: '/repo' })
      expect(create).toHaveBeenCalledWith({
        location: { directory: '/repo' },
        title: 'ocm:action:dev:Dev server',
        command: '/bin/sh',
        args: deferredArgs('/bin/sh', ['-c', 'npm run dev']),
        env: { GH_TOKEN: 'gh', FOO: 'bar' },
      })
      expect(result).toEqual({
        id: 'pty-new',
        title: 'Dev server',
        kind: 'action',
        actionId: 'dev',
        cwd: '/repo',
        status: 'running',
      })
    })

    it('omits command and args for a plain shell', async () => {
      let captured: PtyCreateInput | undefined
      const create = vi.fn<PtyApi['create']>(async (input) => {
        captured = input
        return {
          location: { directory: '/repo' },
          data: createPty({ id: 'pty-1', title: 'Terminal' }),
        }
      })
      const service = createTerminalService(createClient({ create }), createCredentialProvider())

      await service.create('/repo', { kind: 'shell', name: 'Terminal' })

      expect(captured).toMatchObject({ title: 'Terminal' })
      expect(captured).not.toHaveProperty('command')
      expect(captured).not.toHaveProperty('args')
      expect(captured?.env).toEqual({})
    })

    it('defers a setup command until the manager has attached to the new PTY', async () => {
      const create = vi.fn<PtyApi['create']>(async () => ({
        location: { directory: '/repo' },
        data: createPty({ id: 'pty-setup', title: 'ocm:setup:Worktree setup' }),
      }))
      const service = createTerminalService(createClient({ create }), createCredentialProvider())

      await service.create('/repo', {
        kind: 'setup',
        name: 'Worktree setup',
        command: '/bin/sh',
        args: ['-c', 'set -e\npnpm install'],
      })

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          command: '/bin/sh',
          args: deferredArgs('/bin/sh', ['-c', 'set -e\npnpm install']),
        }),
      )
    })

    it('keeps a plain shell command without deferring it', async () => {
      let captured: PtyCreateInput | undefined
      const create = vi.fn<PtyApi['create']>(async (input) => {
        captured = input
        return { location: { directory: '/repo' }, data: createPty({ id: 'pty-1', title: 'Terminal' }) }
      })
      const service = createTerminalService(createClient({ create }), createCredentialProvider())

      await service.create('/repo', { kind: 'shell', name: 'Terminal', command: '/bin/zsh', args: ['-l'] })

      expect(captured).toMatchObject({ command: '/bin/zsh', args: ['-l'] })
    })

    it('merges the repository env between the GitHub env and the input env', async () => {
      const create = vi.fn<PtyApi['create']>(async () => ({
        location: { directory: '/repo' },
        data: createPty({ id: 'pty-new', title: 'Terminal' }),
      }))
      const credentialProvider = createCredentialProvider({ GH_TOKEN: 'gh', SHARED: 'gh' })
      const repoEnvService = createStubRepoEnvService({ REPO_VAR: 'repo', SHARED: 'repo' })
      const service = new TerminalService(
        { client: createClient({ create }), baseUrl: () => 'http://127.0.0.1:5551', includeLocalEnv: true },
        credentialProvider,
        repoEnvService,
      )

      await service.create('/repo', { kind: 'shell', name: 'Terminal', env: { FOO: 'bar', SHARED: 'input' } })

      expect(repoEnvService.resolveForDirectory).toHaveBeenCalledWith('/repo')
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ env: { GH_TOKEN: 'gh', REPO_VAR: 'repo', FOO: 'bar', SHARED: 'input' } }),
      )
    })
  })

  describe('hub capture', () => {
    function createCapturingService(actionTerminal = createPty({ id: 'pty-action', title: 'ocm:action:say:Say hi' })) {
      const create = vi.fn<PtyApi['create']>(async () => ({ location: { directory: '/repo' }, data: actionTerminal }))
      const list = vi.fn<PtyApi['list']>(async () => ({ location: { directory: '/repo' }, data: [actionTerminal] }))
      const factory = createSocketFactory()
      const service = createTerminalService(
        createClient({ create, list }),
        createCredentialProvider(),
        factory.openSocket,
      )
      return { service, sockets: factory.sockets }
    }

    function createSingleTerminalService(terminal: OpenCodePty) {
      const create = vi.fn<PtyApi['create']>(async () => ({ location: { directory: '/repo' }, data: terminal }))
      const list = vi.fn<PtyApi['list']>(async () => ({ location: { directory: '/repo' }, data: [terminal] }))
      const factory = createSocketFactory()
      const service = createTerminalService(
        createClient({ create, list }),
        createCredentialProvider(),
        factory.openSocket,
      )
      return { service, sockets: factory.sockets }
    }

    async function openHub(sockets: FakeWebSocket[]): Promise<FakeWebSocket> {
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      sockets[0]!.open()
      return sockets[0]!
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const actionInput = {
      kind: 'action' as const,
      actionId: 'say',
      name: 'Say hi',
      command: '/bin/sh',
      args: ['-c', 'echo hi'],
    }

    it('opens the upstream at creation so output is captured before the first client attaches', async () => {
      const { service, sockets } = createCapturingService()

      await service.create('/repo', actionInput)
      const socket = await openHub(sockets)

      const url = new URL(socket.url)
      expect(url.pathname).toBe('/api/pty/pty-action/connect')
      expect(url.searchParams.get('cursor')).toBe('0')
    })

    it('captures a setup terminal and releases its deferred command', async () => {
      const setup = createPty({ id: 'pty-setup', title: 'ocm:setup:Worktree setup' })
      const { service, sockets } = createSingleTerminalService(setup)

      await service.create('/repo', { kind: 'setup', name: 'Worktree setup', command: '/bin/sh', args: ['-c', 'pnpm install'] })
      const socket = await openHub(sockets)

      expect(socket.sent).toEqual(['\n'])
    })

    it('bridges a plain shell without a hub', async () => {
      const shell = createPty({ id: 'pty-shell', title: 'Terminal' })
      const { service, sockets } = createSingleTerminalService(shell)

      await service.create('/repo', { kind: 'shell', name: 'Terminal' })
      expect(sockets).toHaveLength(0)

      await service.connect('/repo', 'pty-shell', 12, new FakePeer())

      expect(sockets).toHaveLength(1)
      expect(new URL(sockets[0]!.url).searchParams.get('cursor')).toBe('12')
    })

    it('replays captured output and the exit close frame to a late client', async () => {
      const exited = createPty({ id: 'pty-action', title: 'ocm:action:say:Say hi', status: 'exited', exitCode: 0 })
      const { service, sockets } = createCapturingService(exited)

      await service.create('/repo', actionInput)
      const socket = await openHub(sockets)
      socket.emitMessage('hi\r\n')
      socket.emitClose(1000)

      const peer = new FakePeer()
      await service.connect('/repo', 'pty-action', undefined, peer)

      expect(peer.sent[0]).toBe('hi\r\n')
      expect(peer.sent[1]).toBeInstanceOf(Uint8Array)
      expect(metaCursor(peer.sent[1])).toBe(4)
      expect(peer.closeCalls).toEqual([{ code: 1000, reason: undefined }])
      expect(sockets).toHaveLength(1)
    })

    it('forwards late-client input through the captured upstream', async () => {
      const { service, sockets } = createCapturingService()

      await service.create('/repo', actionInput)
      const socket = await openHub(sockets)
      const peer = new FakePeer()
      const bridge = await service.connect('/repo', 'pty-action', undefined, peer)

      bridge.send('ls\r')

      expect(socket.sent).toEqual(['\n', 'ls\r'])
    })

    it('streams live output to an attached client without duplicating the replay', async () => {
      const { service, sockets } = createCapturingService()

      await service.create('/repo', actionInput)
      const socket = await openHub(sockets)
      socket.emitMessage('old')
      const peer = new FakePeer()
      await service.connect('/repo', 'pty-action', undefined, peer)

      socket.emitMessage('new')

      expect(peer.sent[0]).toBe('old')
      expect(peer.sent[2]).toBe('new')
    })

    it('falls back to the bridge with the client cursor after an abnormal hub close', async () => {
      const { service, sockets } = createCapturingService()

      await service.create('/repo', actionInput)
      const socket = await openHub(sockets)
      const attached = new FakePeer()
      await service.connect('/repo', 'pty-action', undefined, attached)

      socket.emitClose(1006)

      expect(attached.closeCalls).toEqual([{ code: 1011, reason: undefined }])

      const peer = new FakePeer()
      await service.connect('/repo', 'pty-action', 7, peer)

      expect(sockets).toHaveLength(2)
      expect(new URL(sockets[1]!.url).searchParams.get('cursor')).toBe('7')
      sockets[1]!.open()
      expect(sockets[1]!.sent).toEqual([])
    })

    it('delivers the deferred release through the fallback bridge when the hub fails first', async () => {
      const { service, sockets } = createCapturingService()

      await service.create('/repo', actionInput)
      await vi.waitFor(() => expect(sockets).toHaveLength(1))
      sockets[0]!.emitClose(1006)
      await vi.advanceTimersByTimeAsync(100)
      expect(sockets).toHaveLength(2)
      sockets[1]!.emitClose(1006)
      await vi.advanceTimersByTimeAsync(100)
      expect(sockets).toHaveLength(3)
      sockets[2]!.emitClose(1006)

      const peer = new FakePeer()
      await service.connect('/repo', 'pty-action', undefined, peer)
      expect(sockets).toHaveLength(4)
      sockets[3]!.open()
      expect(sockets[3]!.sent).toEqual(['\n'])

      await service.connect('/repo', 'pty-action', undefined, new FakePeer())
      expect(sockets).toHaveLength(5)
      sockets[4]!.open()
      expect(sockets[4]!.sent).toEqual([])
    })

    it('drops the captured upstream when the terminal is removed', async () => {
      const removed = createPty({ id: 'pty-action', title: 'Terminal', status: 'exited', exitCode: 0 })
      const remove = vi.fn<PtyApi['remove']>(async () => undefined)
      const factory = createSocketFactory()
      const service = createTerminalService(
        createClient({
          create: vi.fn<PtyApi['create']>(async () => ({ location: { directory: '/repo' }, data: removed })),
          list: vi.fn<PtyApi['list']>(async () => ({ location: { directory: '/repo' }, data: [removed] })),
          remove,
        }),
        createCredentialProvider(),
        factory.openSocket,
      )

      await service.create('/repo', actionInput)
      await openHub(factory.sockets)
      await service.remove('/repo', 'pty-action')

      const peer = new FakePeer()
      await service.connect('/repo', 'pty-action', undefined, peer)

      expect(remove).toHaveBeenCalledWith({ ptyID: 'pty-action', location: { directory: '/repo' } })
      expect(factory.sockets).toHaveLength(2)
      expect(new URL(factory.sockets[1]!.url).searchParams.has('cursor')).toBe(false)
    })
  })

  describe('remote target', () => {
    it('does not inject local GitHub credentials or repository environment when creating a terminal', async () => {
      const create = vi.fn<PtyApi['create']>(async () => ({
        location: { directory: '/repo' },
        data: createPty({ id: 'pty-remote', title: 'Terminal' }),
      }))
      const credentialProvider = createCredentialProvider({ GH_TOKEN: 'gh' })
      const repoEnvService = createStubRepoEnvService({ REPO_VAR: 'repo' })
      const service = new TerminalService(
        { client: createClient({ create }), baseUrl: () => 'https://remote.internal', includeLocalEnv: false },
        credentialProvider,
        repoEnvService,
      )

      await service.create('/repo', { kind: 'shell', name: 'Terminal', env: { FOO: 'bar' } })

      expect(credentialProvider.getGhCliEnv).not.toHaveBeenCalled()
      expect(repoEnvService.resolveForDirectory).not.toHaveBeenCalled()
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ env: { FOO: 'bar' } }))
    })

    it('keeps a remote shell environment empty without input env', async () => {
      let captured: PtyCreateInput | undefined
      const create = vi.fn<PtyApi['create']>(async (input) => {
        captured = input
        return { location: { directory: '/repo' }, data: createPty() }
      })
      const service = createTerminalService(
        createClient({ create }),
        createCredentialProvider({ GH_TOKEN: 'gh' }),
        undefined,
        'https://remote.internal',
        false,
      )

      await service.create('/repo', { kind: 'shell', name: 'Terminal' })

      expect(captured?.env).toEqual({})
    })

    it('builds the connect URL from the target base URL', async () => {
      const list = vi.fn<PtyApi['list']>(async (input) => ({
        location: { directory: input?.location?.directory ?? '/repo' },
        data: [createPty({ id: 'pty-1' })],
      }))
      const token = vi.fn<PtyApi['connect']['token']>(async () => ({
        location: { directory: '/repo' },
        data: { ticket: 'remote-ticket', expires_in: 60 },
      }))
      const remoteClient = createClient({ list, connect: { token } })
      let opened: FakeWebSocket | undefined
      const service = createTerminalService(
        createClient({}),
        createCredentialProvider(),
        (url) => {
          opened = new FakeWebSocket(url)
          return opened
        },
        'https://local.internal',
      )
      const remote = service.forTarget({
        client: remoteClient,
        baseUrl: () => 'https://remote.internal',
        includeLocalEnv: false,
      })

      await remote.connect('/repo', 'pty-1', undefined, new FakePeer())

      expect(list).toHaveBeenCalledWith({ location: { directory: '/repo' } })
      if (!opened) throw new Error('Expected the remote connect to open a socket')
      const url = new URL(opened.url)
      expect(url.protocol).toBe('wss:')
      expect(url.host).toBe('remote.internal')
      expect(url.pathname).toBe('/api/pty/pty-1/connect')
      expect(url.searchParams.get('ticket')).toBe('remote-ticket')
    })
  })

  describe('requireTerminal', () => {
    it('returns the terminal when the id exists in the directory', async () => {
      const list = vi.fn<PtyApi['list']>(async () => ({
        location: { directory: '/repo' },
        data: [createPty({ id: 'pty-1' })],
      }))
      const service = createTerminalService(createClient({ list }), createCredentialProvider())

      await expect(service.requireTerminal('/repo', 'pty-1')).resolves.toMatchObject({ id: 'pty-1' })
    })

    it('rejects a PTY id from another directory', async () => {
      const list = vi.fn<PtyApi['list']>(async (input) => ({
        location: { directory: input?.location?.directory ?? '/other' },
        data: input?.location?.directory === '/repo' ? [createPty({ id: 'pty-1' })] : [],
      }))
      const service = createTerminalService(createClient({ list }), createCredentialProvider())

      await expect(service.requireTerminal('/other', 'pty-1')).rejects.toBeInstanceOf(TerminalNotFoundError)
    })
  })

  describe('resize', () => {
    it('updates the terminal size with the location', async () => {
      const update = vi.fn<PtyApi['update']>(async () => ({
        location: { directory: '/repo' },
        data: createPty(),
      }))
      const service = createTerminalService(createClient({ update }), createCredentialProvider())

      await service.resize('/repo', 'pty-1', { cols: 120, rows: 40 })

      expect(update).toHaveBeenCalledWith({ ptyID: 'pty-1', location: { directory: '/repo' }, size: { cols: 120, rows: 40 } })
    })
  })

  describe('remove', () => {
    it('removes the terminal with the location', async () => {
      const remove = vi.fn<PtyApi['remove']>(async () => undefined)
      const service = createTerminalService(createClient({ remove }), createCredentialProvider())

      await service.remove('/repo', 'pty-1')

      expect(remove).toHaveBeenCalledWith({ ptyID: 'pty-1', location: { directory: '/repo' } })
    })
  })

  describe('removeAll', () => {
    function createSessionApi(pages: Array<{ data: SessionInfo[]; next: string | null }>) {
      let index = 0
      const list = vi.fn<SessionApi['list']>(async () => {
        const page = pages[index] ?? { data: [], next: null }
        index += 1
        return { data: page.data, cursor: { next: page.next } }
      })
      return { list }
    }

    it('removes every terminal and tolerates a 404', async () => {
      const list = vi.fn<PtyApi['list']>(async () => ({
        location: { directory: '/repo' },
        data: [createPty({ id: 'a' }), createPty({ id: 'b' })],
      }))
      const notFound = Object.assign(new Error('not found'), { _tag: 'PtyNotFoundError' as const })
      const remove = vi.fn<PtyApi['remove']>(async ({ ptyID }) => {
        if (ptyID === 'a') throw notFound
      })
      const { list: sessionList } = createSessionApi([])
      const client = createClient({ list, remove }, { session: { list: sessionList } })
      const service = createTerminalService(client, createCredentialProvider())

      await expect(service.removeAll('/repo')).resolves.toBeUndefined()
      expect(remove).toHaveBeenCalledTimes(2)
      expect(remove).toHaveBeenCalledWith({ ptyID: 'a', location: { directory: '/repo' } })
      expect(remove).toHaveBeenCalledWith({ ptyID: 'b', location: { directory: '/repo' } })
    })

    it('propagates a non-404 removal failure', async () => {
      const list = vi.fn<PtyApi['list']>(async () => ({
        location: { directory: '/repo' },
        data: [createPty({ id: 'a' })],
      }))
      const remove = vi.fn<PtyApi['remove']>(async () => {
        throw new Error('boom')
      })
      const { list: sessionList } = createSessionApi([])
      const client = createClient({ list, remove }, { session: { list: sessionList } })
      const service = createTerminalService(client, createCredentialProvider())

      await expect(service.removeAll('/repo')).rejects.toThrow('boom')
      expect(sessionList).not.toHaveBeenCalled()
    })

    it('removes every persistent PTY across paginated sessions', async () => {
      const list = vi.fn<PtyApi['list']>(async () => ({ location: { directory: '/repo' }, data: [] }))
      const remove = vi.fn<PtyApi['remove']>(async () => undefined)
      const { list: sessionList } = createSessionApi([
        { data: [sessionInfo({ id: 'ses-1' })], next: 'page-2' },
        { data: [sessionInfo({ id: 'ses-2' })], next: null },
      ])
      const persistentList = vi.fn<PersistentPtyApi['list']>(async ({ sessionID }) => [
        createPersistentPty(`${sessionID}-a`, sessionID),
        createPersistentPty(`${sessionID}-b`, sessionID),
      ])
      const persistentRemove = vi.fn<PersistentPtyApi['remove']>(async () => undefined)
      const client = stubPersistentPtys(createClient({ list, remove }, { session: { list: sessionList } }), {
        list: persistentList,
        remove: persistentRemove,
      })
      const service = createTerminalService(client, createCredentialProvider())

      await expect(service.removeAll('/repo')).resolves.toBeUndefined()

      expect(sessionList).toHaveBeenNthCalledWith(1, { directory: '/repo' })
      expect(sessionList).toHaveBeenNthCalledWith(2, { directory: '/repo', cursor: 'page-2' })
      expect(persistentList).toHaveBeenCalledWith({ sessionID: 'ses-1' })
      expect(persistentList).toHaveBeenCalledWith({ sessionID: 'ses-2' })
      expect(persistentRemove).toHaveBeenCalledTimes(4)
      expect(persistentRemove).toHaveBeenCalledWith({ ptyID: 'ses-1-a' })
      expect(persistentRemove).toHaveBeenCalledWith({ ptyID: 'ses-1-b' })
      expect(persistentRemove).toHaveBeenCalledWith({ ptyID: 'ses-2-a' })
      expect(persistentRemove).toHaveBeenCalledWith({ ptyID: 'ses-2-b' })
    })

    it('treats a 404 from listing persistent PTYs as none', async () => {
      const list = vi.fn<PtyApi['list']>(async () => ({ location: { directory: '/repo' }, data: [] }))
      const remove = vi.fn<PtyApi['remove']>(async () => undefined)
      const { list: sessionList } = createSessionApi([{ data: [sessionInfo({ id: 'ses-1' })], next: null }])
      const notFound = Object.assign(new Error('not found'), { _tag: 'PtyNotFoundError' as const })
      const persistentList = vi.fn<PersistentPtyApi['list']>(async () => {
        throw notFound
      })
      const persistentRemove = vi.fn<PersistentPtyApi['remove']>(async () => undefined)
      const client = stubPersistentPtys(createClient({ list, remove }, { session: { list: sessionList } }), {
        list: persistentList,
        remove: persistentRemove,
      })
      const service = createTerminalService(client, createCredentialProvider())

      await expect(service.removeAll('/repo')).resolves.toBeUndefined()
      expect(persistentRemove).not.toHaveBeenCalled()
    })

    it('tolerates a 404 while removing a persistent PTY', async () => {
      const list = vi.fn<PtyApi['list']>(async () => ({ location: { directory: '/repo' }, data: [] }))
      const remove = vi.fn<PtyApi['remove']>(async () => undefined)
      const { list: sessionList } = createSessionApi([{ data: [sessionInfo({ id: 'ses-1' })], next: null }])
      const notFound = Object.assign(new Error('not found'), { _tag: 'PtyNotFoundError' as const })
      const persistentList = vi.fn<PersistentPtyApi['list']>(async ({ sessionID }) => [
        createPersistentPty('pp-1', sessionID),
        createPersistentPty('pp-2', sessionID),
      ])
      const persistentRemove = vi.fn<PersistentPtyApi['remove']>(async ({ ptyID }) => {
        if (ptyID === 'pp-1') throw notFound
      })
      const client = stubPersistentPtys(createClient({ list, remove }, { session: { list: sessionList } }), {
        list: persistentList,
        remove: persistentRemove,
      })
      const service = createTerminalService(client, createCredentialProvider())

      await expect(service.removeAll('/repo')).resolves.toBeUndefined()
      expect(persistentRemove).toHaveBeenCalledTimes(2)
      expect(persistentRemove).toHaveBeenCalledWith({ ptyID: 'pp-1' })
      expect(persistentRemove).toHaveBeenCalledWith({ ptyID: 'pp-2' })
    })

    it('propagates a non-404 failure from listing persistent PTYs', async () => {
      const list = vi.fn<PtyApi['list']>(async () => ({ location: { directory: '/repo' }, data: [] }))
      const remove = vi.fn<PtyApi['remove']>(async () => undefined)
      const { list: sessionList } = createSessionApi([{ data: [sessionInfo({ id: 'ses-1' })], next: null }])
      const persistentList = vi.fn<PersistentPtyApi['list']>(async () => {
        throw new Error('boom')
      })
      const client = stubPersistentPtys(createClient({ list, remove }, { session: { list: sessionList } }), {
        list: persistentList,
      })
      const service = createTerminalService(client, createCredentialProvider())

      await expect(service.removeAll('/repo')).rejects.toThrow('boom')
    })

    it('propagates a non-404 failure from removing a persistent PTY', async () => {
      const list = vi.fn<PtyApi['list']>(async () => ({ location: { directory: '/repo' }, data: [] }))
      const remove = vi.fn<PtyApi['remove']>(async () => undefined)
      const { list: sessionList } = createSessionApi([{ data: [sessionInfo({ id: 'ses-1' })], next: null }])
      const persistentList = vi.fn<PersistentPtyApi['list']>(async ({ sessionID }) => [createPersistentPty('pp-1', sessionID)])
      const persistentRemove = vi.fn<PersistentPtyApi['remove']>(async () => {
        throw new Error('boom')
      })
      const client = stubPersistentPtys(createClient({ list, remove }, { session: { list: sessionList } }), {
        list: persistentList,
        remove: persistentRemove,
      })
      const service = createTerminalService(client, createCredentialProvider())

      await expect(service.removeAll('/repo')).rejects.toThrow('boom')
    })
  })

  describe('connect', () => {
    function createConnectClient(options: { ticket?: string; terminals?: OpenCodePty[] } = {}) {
      const list = vi.fn<PtyApi['list']>(async (input) => ({
        location: { directory: input?.location?.directory ?? '/repo' },
        data: options.terminals ?? [createPty({ id: 'pty-1' })],
      }))
      const token = vi.fn<PtyApi['connect']['token']>(async () => ({
        location: { directory: '/repo' },
        data: { ticket: options.ticket ?? 'ticket-abc', expires_in: 60 },
      }))
      return { client: createClient({ list, connect: { token } }), list, token }
    }

    it('resolves the terminal, requests a ticket, and bridges the upstream socket', async () => {
      const { client, list, token } = createConnectClient()
      let opened: FakeWebSocket | undefined
      const service = createTerminalService(client, createCredentialProvider(), (url) => {
        opened = new FakeWebSocket(url)
        return opened
      })
      const peer = new FakePeer()

      const bridge = await service.connect('/repo', 'pty-1', 12, peer)

      expect(list).toHaveBeenCalledWith({ location: { directory: '/repo' } })
      expect(token).toHaveBeenCalledWith({
        ptyID: 'pty-1',
        location: { directory: '/repo' },
        'x-opencode-ticket': '1',
      })

      if (!opened) throw new Error('Expected connect to open a socket')
      const url = new URL(opened.url)
      expect(url.protocol).toBe('ws:')
      expect(url.pathname).toBe('/api/pty/pty-1/connect')
      expect(url.searchParams.get('ticket')).toBe('ticket-abc')
      expect(url.searchParams.get('location[directory]')).toBe('/repo')
      expect(url.searchParams.get('cursor')).toBe('12')

      opened.open()
      bridge.send('hello')
      expect(opened.sent).toEqual(['hello'])

      opened.emitMessage(new Uint8Array([7]).buffer)
      expect(peer.sent).toEqual([new Uint8Array([7])])
    })

    it('omits the cursor parameter when no cursor is provided', async () => {
      const { client } = createConnectClient()
      let opened: FakeWebSocket | undefined
      const service = createTerminalService(client, createCredentialProvider(), (url) => {
        opened = new FakeWebSocket(url)
        return opened
      })

      await service.connect('/repo', 'pty-1', undefined, new FakePeer())

      if (!opened) throw new Error('Expected connect to open a socket')
      const url = new URL(opened.url)
      expect(url.searchParams.has('cursor')).toBe(false)
    })

    it('uses wss when the upstream base is https', async () => {
      const { client } = createConnectClient()
      let opened: FakeWebSocket | undefined
      const service = createTerminalService(
        client,
        createCredentialProvider(),
        (url) => {
          opened = new FakeWebSocket(url)
          return opened
        },
        'https://opencode.internal',
      )

      await service.connect('/repo', 'pty-1', undefined, new FakePeer())

      if (!opened) throw new Error('Expected connect to open a socket')
      const url = new URL(opened.url)
      expect(url.protocol).toBe('wss:')
      expect(url.pathname).toBe('/api/pty/pty-1/connect')
    })

    it('rejects an unknown terminal before requesting a ticket', async () => {
      const { client, token } = createConnectClient({ terminals: [] })
      const service = createTerminalService(client, createCredentialProvider())

      await expect(service.connect('/repo', 'missing', undefined, new FakePeer())).rejects.toBeInstanceOf(TerminalNotFoundError)
      expect(token).not.toHaveBeenCalled()
    })
  })
})

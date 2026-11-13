import { EventEmitter } from 'node:events'
import { chmodSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { vi, type Mock } from 'vitest'
import { z } from 'zod'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import type { Database } from 'bun:sqlite'
import {
  OpenCodeServerManager,
  type OpenCodeServerChild,
  type OpenCodeServerManagerDeps,
  type OpenCodeServerSandboxRuntime,
  type OpenCodeServerSpawnOptions,
} from '../../src/services/opencode-single-server'
import type { ProcessGroupMember, ProcessIdentityProvider, ProcessStat } from '../../src/services/opencode/process-identity'
import { ENV } from '@opencode-manager/shared/config/env'
import { createTestDatabase } from './test-database'
import { createTempWorkspace, type TempWorkspace } from './test-env'
import { createStubOpenCodeClient } from './stub-opencode-client'

export type OpenCodeServerInfo = Awaited<ReturnType<OpenCodeApi['server']['info']>>

export const DEFAULT_SERVER_INFO: OpenCodeServerInfo = {
  version: '2.2.5',
  pid: 1234,
  urls: ['http://127.0.0.1:5551'],
  paths: { tmp: '/tmp' },
}

export function errnoError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

export class ShellCommandError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface FakeServerChildOptions {
  stdout?: PassThrough | undefined
  stderr?: PassThrough | undefined
}

export class FakeServerChild extends EventEmitter implements OpenCodeServerChild {
  pid?: number
  readonly stdout: PassThrough | null
  readonly stderr: PassThrough | null

  constructor(pid: number | undefined = 1234, options: FakeServerChildOptions = {}) {
    super()
    this.pid = pid
    this.stdout = options.stdout ?? null
    this.stderr = options.stderr ?? null
  }

  exitChild(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal)
  }

  emitError(error: Error): void {
    this.emit('error', error)
  }

  emitClose(): void {
    this.emit('close')
  }

  writeStdout(text: string): void {
    this.stdout?.write(text)
  }

  writeStderr(text: string): void {
    this.stderr?.write(text)
  }

  writeStderrBytes(bytes: Uint8Array): void {
    this.stderr?.write(bytes)
  }

  endStdout(): void {
    this.stdout?.end()
  }

  endStderr(): void {
    this.stderr?.end()
  }
}

export class FakeProcessIdentity implements ProcessIdentityProvider {
  attested = true
  private readonly processes = new Map<number, ProcessStat>()

  setProcess(pid: number, stat: ProcessStat): void {
    this.processes.set(pid, stat)
  }

  removeProcess(pid: number): void {
    this.processes.delete(pid)
  }

  readProcessStat(pid: number): ProcessStat | null {
    return this.processes.get(pid) ?? null
  }

  readProcessGroupMembers(pgid: number): ProcessGroupMember[] {
    const members: ProcessGroupMember[] = []
    for (const [pid, stat] of this.processes) {
      if (stat.pgrp === pgid) members.push({ pid, startToken: stat.startToken })
    }
    return members
  }
}

export interface FakeSandboxRuntimeState {
  enabled: boolean
  enabledError: Error | null
  stopAllSandboxesForToggle: Mock<() => Promise<void>>
  prepareSandboxOnBoot: Mock<() => Promise<void>>
}

export interface OpenCodeServerHarness {
  manager: OpenCodeServerManager
  deps: OpenCodeServerManagerDeps
  spawnServer: Mock<OpenCodeServerManagerDeps['spawnServer']>
  runCommand: Mock<OpenCodeServerManagerDeps['runCommand']>
  readVersionOutput: Mock<OpenCodeServerManagerDeps['readVersionOutput']>
  signalProcess: Mock<OpenCodeServerManagerDeps['signalProcess']>
  createOpenCodeClient: Mock<OpenCodeServerManagerDeps['createOpenCodeClient']>
  installManagedPlugins: Mock<OpenCodeServerManagerDeps['installManagedPlugins']>
  restoreQuarantinedOpenCodePlugins: Mock<OpenCodeServerManagerDeps['restoreQuarantinedOpenCodePlugins']>
  health: Mock<OpenCodeApi['server']['info']>
  identity: FakeProcessIdentity
  sandbox: FakeSandboxRuntimeState
  children: FakeServerChild[]
  setChildFactory: (factory: () => FakeServerChild) => void
  lastChild: () => FakeServerChild
  spawnArgs: (index?: number) => string[]
  spawnOptions: (index?: number) => OpenCodeServerSpawnOptions
  spawnEnv: (index?: number) => NodeJS.ProcessEnv
  ownPortAfterSpawn: (pid?: number) => void
  markProcessAlive: (pid: number) => void
  markProcessDead: (pid: number) => void
  markGroupAlive: (pgid: number) => void
  markGroupDead: (pgid: number) => void
}

export function createOpenCodeServerHarness(): OpenCodeServerHarness {
  const identity = new FakeProcessIdentity()
  identity.setProcess(1234, { pgrp: 3, startToken: '42' })
  const children: FakeServerChild[] = []
  const alivePids = new Set<number>()
  const aliveGroups = new Set<number>()
  let childFactory: () => FakeServerChild = () => new FakeServerChild()

  const spawnServer = vi.fn<OpenCodeServerManagerDeps['spawnServer']>(() => {
    const child = childFactory()
    children.push(child)
    return child
  })

  const runCommand = vi.fn<OpenCodeServerManagerDeps['runCommand']>(() => '')
  const readVersionOutput = vi.fn<OpenCodeServerManagerDeps['readVersionOutput']>(() => ({ stdout: '', stderr: '' }))

  const signalProcess = vi.fn<OpenCodeServerManagerDeps['signalProcess']>((target, signal) => {
    const isGroup = target < 0
    const id = isGroup ? -target : target
    const alive = isGroup ? aliveGroups.has(id) : alivePids.has(id)
    if (signal === 0) {
      if (!alive) throw errnoError('ESRCH', `kill ESRCH ${target}`)
      return
    }
    if (isGroup) aliveGroups.delete(id)
    else alivePids.delete(id)
  })

  const health = vi.fn<OpenCodeApi['server']['info']>(async () => DEFAULT_SERVER_INFO)
  const createOpenCodeClient = vi.fn<OpenCodeServerManagerDeps['createOpenCodeClient']>(() =>
    createStubOpenCodeClient({ api: { server: { info: health } } }),
  )

  const sandbox: FakeSandboxRuntimeState = {
    enabled: false,
    enabledError: null,
    stopAllSandboxesForToggle: vi.fn(async () => undefined),
    prepareSandboxOnBoot: vi.fn(async () => undefined),
  }

  const installManagedPlugins = vi.fn<OpenCodeServerManagerDeps['installManagedPlugins']>(async () => undefined)
  const restoreQuarantinedOpenCodePlugins = vi.fn<OpenCodeServerManagerDeps['restoreQuarantinedOpenCodePlugins']>(async () => undefined)

  const sandboxRuntime: OpenCodeServerSandboxRuntime = {
    isEnabled: () => {
      const failure = sandbox.enabledError
      if (failure !== null) throw failure
      return sandbox.enabled
    },
    stopAllSandboxesForToggle: sandbox.stopAllSandboxesForToggle,
    prepareSandboxOnBoot: sandbox.prepareSandboxOnBoot,
  }

  const deps: OpenCodeServerManagerDeps = {
    timings: { sigtermGraceMs: 50, sigkillConfirmMs: 50, exitPollMs: 5 },
    spawnServer,
    runCommand,
    readVersionOutput,
    signalProcess,
    processIdentity: () => identity,
    createOpenCodeClient,
    createSandboxRuntime: () => sandboxRuntime,
    installManagedPlugins,
    restoreQuarantinedOpenCodePlugins,
  }

  const manager = new OpenCodeServerManager(deps)

  return {
    manager,
    deps,
    spawnServer,
    runCommand,
    readVersionOutput,
    signalProcess,
    createOpenCodeClient,
    installManagedPlugins,
    restoreQuarantinedOpenCodePlugins,
    health,
    identity,
    sandbox,
    children,
    setChildFactory: (factory) => {
      childFactory = factory
    },
    lastChild: () => {
      const child = children.at(-1)
      if (child === undefined) throw new Error('no OpenCode server child has been spawned')
      return child
    },
    spawnArgs: (index = 0) => {
      const call = spawnServer.mock.calls[index]
      if (call === undefined) throw new Error(`no spawn call at index ${index}`)
      return call[1]
    },
    spawnOptions: (index = 0) => {
      const call = spawnServer.mock.calls[index]
      if (call === undefined) throw new Error(`no spawn call at index ${index}`)
      return call[2]
    },
    spawnEnv: (index = 0) => {
      const call = spawnServer.mock.calls[index]
      if (call === undefined) throw new Error(`no spawn call at index ${index}`)
      return call[2].env
    },
    ownPortAfterSpawn: (pid = 1234) => {
      runCommand.mockImplementation(() => (children.length > 0 ? `${pid}\n` : ''))
    },
    markProcessAlive: (pid) => {
      alivePids.add(pid)
    },
    markProcessDead: (pid) => {
      alivePids.delete(pid)
    },
    markGroupAlive: (pgid) => {
      aliveGroups.add(pgid)
    },
    markGroupDead: (pgid) => {
      aliveGroups.delete(pgid)
    },
  }
}

export interface OpenCodeServerTestContext {
  workspace: TempWorkspace
  db: Database
  harness: OpenCodeServerHarness
  executablePath: string
  dispose: () => void
}

export const ChildStateMarkerSchema = z.object({
  pid: z.number(),
  pgid: z.number().nullable(),
  enforced: z.boolean(),
  startToken: z.string(),
  generation: z.number(),
  groupMembers: z.array(z.object({ pid: z.number(), startToken: z.string() })),
})

export type ChildStateMarkerSnapshot = z.infer<typeof ChildStateMarkerSchema>

export function childStateMarkerPath(workspacePath: string): string {
  return path.join(workspacePath, '.opencode', 'state', 'opencode-server-child.json')
}

export async function readChildStateMarkerFile(workspacePath: string): Promise<ChildStateMarkerSnapshot | null> {
  try {
    return ChildStateMarkerSchema.parse(JSON.parse(await readFile(childStateMarkerPath(workspacePath), 'utf-8')))
  } catch {
    return null
  }
}

export async function writeChildStateMarkerFile(workspacePath: string, marker: ChildStateMarkerSnapshot): Promise<void> {
  const markerPath = childStateMarkerPath(workspacePath)
  await mkdir(path.dirname(markerPath), { recursive: true })
  await writeFile(markerPath, JSON.stringify(marker), 'utf-8')
}

export function createOpenCodeServerTestContext(options: { nodeEnv?: string } = {}): OpenCodeServerTestContext {
  const workspace = createTempWorkspace('ocm-opencode-server-')
  const executablePath = path.join(workspace.path, 'opencode-bin')
  writeFileSync(executablePath, '#!/bin/sh\nexit 0\n', 'utf-8')
  chmodSync(executablePath, 0o755)

  const previousBin = process.env.OPENCODE_BIN
  const previousNodeEnv = ENV.SERVER.NODE_ENV
  const previousLogLevel = process.env.LOG_LEVEL
  process.env.OPENCODE_BIN = executablePath
  process.env.LOG_LEVEL = 'error'
  Object.defineProperty(ENV.SERVER, 'NODE_ENV', {
    value: options.nodeEnv ?? 'production',
    configurable: true,
    writable: true,
  })

  const db = createTestDatabase()
  const harness = createOpenCodeServerHarness()

  return {
    workspace,
    db,
    harness,
    executablePath,
    dispose: () => {
      harness.manager.stopChildStateMarkerRefresh()
      db.close()
      if (previousBin === undefined) delete process.env.OPENCODE_BIN
      else process.env.OPENCODE_BIN = previousBin
      if (previousLogLevel === undefined) delete process.env.LOG_LEVEL
      else process.env.LOG_LEVEL = previousLogLevel
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: previousNodeEnv, configurable: true, writable: true })
      workspace.restore()
    },
  }
}

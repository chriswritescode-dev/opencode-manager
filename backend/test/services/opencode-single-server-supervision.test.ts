import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ENV } from '@opencode-manager/shared/config/env'
import { OpenCodeServerManager } from '../../src/services/opencode-single-server'
import { errnoError } from '../helpers/opencode-server-harness'
import {
  childStateMarkerPath,
  readChildStateMarkerFile,
  writeChildStateMarkerFile,
  createOpenCodeServerTestContext,
  type ChildStateMarkerSnapshot,
  type OpenCodeServerHarness,
  type OpenCodeServerTestContext,
} from '../helpers/opencode-server-harness'

const originalHost = ENV.OPENCODE.HOST
const originalPassword = ENV.OPENCODE.SERVER_PASSWORD

function setOpenCodeEnv(values: { host?: string; password?: string }): void {
  if (values.host !== undefined) {
    Object.defineProperty(ENV.OPENCODE, 'HOST', { value: values.host, configurable: true, writable: true })
  }
  if (values.password !== undefined) {
    Object.defineProperty(ENV.OPENCODE, 'SERVER_PASSWORD', { value: values.password, configurable: true, writable: true })
  }
}

function marker(overrides: Partial<ChildStateMarkerSnapshot> = {}): ChildStateMarkerSnapshot {
  return {
    pid: 1234,
    pgid: null,
    enforced: false,
    startToken: '42',
    generation: 0,
    groupMembers: [],
    ...overrides,
  }
}

function surviveEverySignal(harness: OpenCodeServerHarness): void {
  harness.signalProcess.mockImplementation((_target, signal) => {
    if (signal === 0) return
  })
}

function esrch(): NodeJS.ErrnoException {
  return errnoError('ESRCH', 'No such process')
}

async function writeRawChildStateMarker(workspacePath: string, contents: string): Promise<void> {
  const markerPath = childStateMarkerPath(workspacePath)
  await mkdir(path.dirname(markerPath), { recursive: true })
  await writeFile(markerPath, contents, 'utf-8')
}

describe('OpenCodeServerManager - sandbox enforcement', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createOpenCodeServerTestContext()
    context.harness.manager.setDatabase(context.db)
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('exposes the running child sandbox enforcement state for worktree placement', async () => {
    expect(context.harness.manager.isSandboxEnforced()).toBe(false)

    context.harness.sandbox.enabled = true
    context.harness.ownPortAfterSpawn()
    await context.harness.manager.start()

    expect(context.harness.manager.isSandboxEnforced()).toBe(true)
  })

  it('aborts startup when the sandbox enforcement state cannot be determined', async () => {
    context.harness.sandbox.enabledError = new Error('database unavailable')

    await expect(context.harness.manager.start()).rejects.toThrow('database unavailable')
    expect(context.harness.spawnServer).not.toHaveBeenCalled()
  })

  it('fails closed and terminates a surviving server when the sandbox enforcement state cannot be determined', async () => {
    context.harness.sandbox.enabledError = new Error('database unavailable')
    context.harness.runCommand.mockReturnValue('9999\n')
    context.harness.markProcessAlive(9999)

    await expect(context.harness.manager.start()).rejects.toThrow('database unavailable')

    expect(context.harness.manager.isSandboxEnforced()).toBe(true)
    expect(context.harness.spawnServer).not.toHaveBeenCalled()
    expect(context.harness.runCommand).toHaveBeenCalledWith('lsof -nP -t -iTCP:5551 -sTCP:LISTEN')
    expect(context.harness.signalProcess).toHaveBeenCalledWith(9999, 'SIGKILL')
    expect(context.harness.manager.isLastStartupErrorNonRecoverable()).toBe(true)
  })

  it('propagates the predecessor termination failure as non-recoverable when the enforcement state cannot be determined', async () => {
    context.harness.sandbox.enabledError = new Error('database unavailable')
    context.harness.runCommand.mockReturnValue('9999\n')
    surviveEverySignal(context.harness)

    await expect(context.harness.manager.start()).rejects.toThrow('could not be proven terminated')

    expect(context.harness.spawnServer).not.toHaveBeenCalled()
    expect(context.harness.manager.isSandboxEnforced()).toBe(true)
    expect(context.harness.manager.isLastStartupErrorNonRecoverable()).toBe(true)
    expect(context.harness.manager.getLastStartupError()).toContain('database unavailable')
    expect(context.harness.manager.getLastStartupError()).toContain('9999')
  })

  it('stops the workspace sandbox when a restart disables enforcement', async () => {
    context.harness.sandbox.enabled = true
    context.harness.ownPortAfterSpawn()
    await context.harness.manager.start()

    context.harness.sandbox.enabled = false
    await context.harness.manager.restart()

    expect(context.harness.sandbox.stopAllSandboxesForToggle).toHaveBeenCalledTimes(1)
    expect(context.harness.spawnEnv(1).OCM_SANDBOX_ENFORCED).toBe('false')
    expect(context.harness.manager.isSandboxEnforced()).toBe(false)
  })

  it('does not stop the workspace sandbox when the restarted server stays enforced', async () => {
    context.harness.sandbox.enabled = true
    context.harness.ownPortAfterSpawn()
    await context.harness.manager.start()

    await context.harness.manager.restart()

    expect(context.harness.sandbox.stopAllSandboxesForToggle).not.toHaveBeenCalled()
    expect(context.harness.spawnEnv(1).OCM_SANDBOX_ENFORCED).toBe('true')
  })

  it('aborts the disabled restart when the workspace sandbox cannot be stopped', async () => {
    context.harness.sandbox.enabled = true
    context.harness.ownPortAfterSpawn()
    await context.harness.manager.start()

    context.harness.sandbox.enabled = false
    context.harness.sandbox.stopAllSandboxesForToggle.mockRejectedValueOnce(
      new Error('msb stop failed; the managed microVM is still running'),
    )

    await expect(context.harness.manager.restart()).rejects.toThrow('Failed to stop the workspace sandbox while disabling enforcement')

    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
    expect(context.harness.manager.isSandboxEnforced()).toBe(true)
    expect(context.harness.manager.isLastStartupErrorNonRecoverable()).toBe(true)
  })

  it('replaces an existing healthy process in production when enforcement is enabled', async () => {
    context.harness.sandbox.enabled = true
    context.harness.identity.setProcess(9999, { pgrp: 9999, startToken: '42' })
    context.harness.runCommand.mockImplementation(() => (context.harness.children.length > 0 ? '1234\n' : '9999\n'))

    await context.harness.manager.start()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(-9999, 'SIGKILL')
    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
    expect(context.harness.spawnEnv().OCM_SANDBOX_ENFORCED).toBe('true')
  })

  it('fails closed when enforcement is on and process identity attestation is unavailable', async () => {
    context.harness.sandbox.enabled = true
    context.harness.identity.attested = false

    await expect(context.harness.manager.start()).rejects.toThrow(
      'process identity attestation, which is unavailable on this platform',
    )

    expect(context.harness.spawnServer).not.toHaveBeenCalled()
    expect(context.harness.manager.isSandboxEnforced()).toBe(true)
    expect(context.harness.manager.isLastStartupErrorNonRecoverable()).toBe(true)
  })
})

describe('OpenCodeServerManager - child state marker', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createOpenCodeServerTestContext()
    context.harness.manager.setDatabase(context.db)
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('writes a durable child state marker with pid, enforcement, identity, and generation', async () => {
    await context.harness.manager.start()

    expect(await readChildStateMarkerFile(context.workspace.path)).toEqual(marker())
  })

  it('stops the child state marker refresh when the tracked child exits', async () => {
    await context.harness.manager.start()
    expect(context.harness.manager.isChildStateMarkerRefreshActive()).toBe(true)

    context.harness.lastChild().exitChild(1)

    expect(context.harness.manager.isChildStateMarkerRefreshActive()).toBe(false)
  })

  it('does not record reused process-group members after the tracked child exits', async () => {
    context.harness.identity.setProcess(1234, { pgrp: 1234, startToken: '42' })
    await context.harness.manager.start()
    const before = await readChildStateMarkerFile(context.workspace.path)

    context.harness.identity.removeProcess(1234)
    context.harness.identity.setProcess(7777, { pgrp: 1234, startToken: '77' })
    await context.harness.manager.refreshChildStateMarkerMembers()

    expect(await readChildStateMarkerFile(context.workspace.path)).toEqual(before)
    expect(context.harness.manager.isChildStateMarkerRefreshActive()).toBe(false)
  })

  it('does not refresh the child state marker when the tracked leader PID is reused with a different identity', async () => {
    context.harness.identity.setProcess(1234, { pgrp: 1234, startToken: '42' })
    await context.harness.manager.start()
    const before = await readChildStateMarkerFile(context.workspace.path)

    context.harness.identity.setProcess(1234, { pgrp: 1234, startToken: 'reused-token' })
    await context.harness.manager.refreshChildStateMarkerMembers()

    expect(await readChildStateMarkerFile(context.workspace.path)).toEqual(before)
    expect(context.harness.manager.isChildStateMarkerRefreshActive()).toBe(false)
  })

  it('updates the child state marker with live attested group members while the tracked child is running', async () => {
    context.harness.identity.setProcess(1234, { pgrp: 1234, startToken: '42' })
    await context.harness.manager.start()

    context.harness.identity.setProcess(1235, { pgrp: 1234, startToken: '77' })
    await context.harness.manager.refreshChildStateMarkerMembers()

    expect(await readChildStateMarkerFile(context.workspace.path)).toEqual(marker({
      pgid: 1234,
      groupMembers: [
        { pid: 1234, startToken: '42' },
        { pid: 1235, startToken: '77' },
      ],
    }))
    expect(context.harness.manager.isChildStateMarkerRefreshActive()).toBe(true)
  })

  it('fails production startup and terminates the spawned child when the child state marker cannot be persisted', async () => {
    await mkdir(childStateMarkerPath(context.workspace.path), { recursive: true })

    await expect(context.harness.manager.start()).rejects.toThrow(
      'Failed to persist the OpenCode child state marker',
    )

    expect(context.harness.signalProcess).toHaveBeenCalledWith(1234, 'SIGTERM')
    expect(context.harness.manager.isServerHealthy()).toBe(false)
    expect(context.harness.manager.getServerPid()).toBeNull()
    expect(context.harness.manager.getLastStartupError()).toContain('Failed to persist the OpenCode child state marker')
  })

  it('adopts an existing healthy process in production when enforcement is off and the child state is attested as unenforced', async () => {
    context.harness.identity.setProcess(9999, { pgrp: 3, startToken: '42' })
    context.harness.runCommand.mockReturnValue('9999\n')
    await writeChildStateMarkerFile(context.workspace.path, marker({ pid: 9999 }))

    await context.harness.manager.start()

    expect(context.harness.spawnServer).not.toHaveBeenCalled()
    expect(context.harness.manager.isSandboxEnforced()).toBe(false)
    expect(context.harness.manager.getServerPid()).toBe(9999)
    expect(context.harness.manager.isServerHealthy()).toBe(true)
  })

  it('adopts an attested unenforced process when the marker carries a non-numeric pgid', async () => {
    context.harness.identity.setProcess(9999, { pgrp: 3, startToken: '42' })
    context.harness.runCommand.mockReturnValue('9999\n')
    await writeRawChildStateMarker(
      context.workspace.path,
      JSON.stringify({ ...marker({ pid: 9999 }), pgid: 'not-a-process-group' }),
    )

    await context.harness.manager.start()

    expect(context.harness.spawnServer).not.toHaveBeenCalled()
    expect(context.harness.manager.getServerPid()).toBe(9999)
    expect(context.harness.manager.isServerHealthy()).toBe(true)
  })

  it.each([
    { description: 'whose child state identity does not match the surviving process', startToken: 'new-token' },
    { description: 'carrying a legacy child state marker without an identity', startToken: '' },
  ])('terminates a healthy existing process $description', async ({ startToken }) => {
    context.harness.identity.setProcess(9999, { pgrp: 3, startToken: 'new-token' })
    context.harness.runCommand.mockImplementation(() => (context.harness.children.length > 0 ? '1234\n' : '9999\n'))
    await writeChildStateMarkerFile(context.workspace.path, marker({ pid: 9999, startToken: 'old-token' }))
    if (startToken === '') {
      await writeChildStateMarkerFile(context.workspace.path, marker({ pid: 9999, startToken: '' }))
    }

    await context.harness.manager.start()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(9999, 'SIGKILL')
    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
    expect(await readChildStateMarkerFile(context.workspace.path)).toEqual(marker())
  })

  it('terminates a healthy surviving child when a restart-sensitive change was persisted after the marker was written', async () => {
    context.harness.runCommand.mockImplementation(() => (context.harness.children.length > 0 ? '1234\n' : '9999\n'))
    const firstManager = new OpenCodeServerManager(context.harness.deps)
    firstManager.setDatabase(context.db)

    await firstManager.start()
    expect(await readChildStateMarkerFile(context.workspace.path)).toEqual(marker())

    firstManager.markRestartPending()
    const secondManager = new OpenCodeServerManager(context.harness.deps)
    secondManager.setDatabase(context.db)

    await secondManager.start()

    expect(context.harness.spawnServer).toHaveBeenCalledTimes(2)
    expect(context.harness.signalProcess).toHaveBeenCalledWith(1234, 'SIGKILL')
    expect(await readChildStateMarkerFile(context.workspace.path)).toEqual(marker({ generation: 1 }))
  })

  it.each([
    { description: 'stamped as enforced', recordedMarker: { enforced: true } },
    { description: 'whose enforcement stamp cannot be attested', recordedMarker: { enforced: true, startToken: '' } },
  ])('terminates a healthy existing process $description when the sandbox preference is off', async ({ recordedMarker }) => {
    context.harness.runCommand.mockImplementation(() => (context.harness.children.length > 0 ? '1234\n' : '9999\n'))
    await writeChildStateMarkerFile(context.workspace.path, marker({ pid: 9999, ...recordedMarker }))

    await context.harness.manager.start()

    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
    expect(context.harness.spawnEnv().OCM_SANDBOX_ENFORCED).toBe('false')
    expect(context.harness.manager.isSandboxEnforced()).toBe(false)
  })

  it('removes the child state marker after a confirmed stop', async () => {
    await context.harness.manager.start()
    expect(await readChildStateMarkerFile(context.workspace.path)).not.toBeNull()

    await context.harness.manager.stop()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(1234, 'SIGTERM')
    expect(await readChildStateMarkerFile(context.workspace.path)).toBeNull()
  })

  it('terminates an attested surviving process group when the tracked leader has already exited and removes the marker', async () => {
    context.harness.identity.setProcess(1234, { pgrp: 1234, startToken: '42' })
    context.harness.identity.setProcess(1235, { pgrp: 1234, startToken: '77' })
    await context.harness.manager.start()
    expect(await readChildStateMarkerFile(context.workspace.path)).toEqual(marker({
      pgid: 1234,
      groupMembers: [
        { pid: 1234, startToken: '42' },
        { pid: 1235, startToken: '77' },
      ],
    }))

    context.harness.identity.removeProcess(1234)
    context.harness.markGroupAlive(1234)
    context.harness.lastChild().exitChild(0)
    expect(context.harness.manager.getServerPid()).toBeNull()

    await context.harness.manager.stop()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(-1234, 'SIGTERM')
    expect(await readChildStateMarkerFile(context.workspace.path)).toBeNull()
    expect(context.harness.manager.getServerPid()).toBeNull()
  })

  it('reconciles an attested surviving descendant group before an unenforced replacement start', async () => {
    context.harness.identity.setProcess(1235, { pgrp: 9999, startToken: '77' })
    context.harness.markGroupAlive(9999)
    await writeChildStateMarkerFile(context.workspace.path, marker({
      pid: 9999,
      pgid: 9999,
      startToken: 'old-token',
      groupMembers: [
        { pid: 9999, startToken: 'old-token' },
        { pid: 1235, startToken: '77' },
      ],
    }))

    await context.harness.manager.start()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(-9999, 'SIGTERM')
    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
  })

  it('fails closed and refuses to replace the child state marker when the surviving group cannot be proven to be the predecessor', async () => {
    context.harness.identity.setProcess(1235, { pgrp: 9999, startToken: '77' })
    context.harness.markGroupAlive(9999)
    await writeChildStateMarkerFile(context.workspace.path, marker({
      pid: 9999,
      pgid: 9999,
      startToken: 'old-token',
      groupMembers: [{ pid: 9999, startToken: 'old-token' }],
    }))

    await expect(context.harness.manager.start()).rejects.toThrow(
      'refusing to replace the child state marker while live processes may survive',
    )

    expect(context.harness.spawnServer).not.toHaveBeenCalled()
    expect(await readChildStateMarkerFile(context.workspace.path)).not.toBeNull()
    expect(context.harness.manager.getLastStartupError()).toContain('9999')
  })
})

describe('OpenCodeServerManager - process termination', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createOpenCodeServerTestContext()
    context.harness.manager.setDatabase(context.db)
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('terminates the whole process group when stopping a detached production child', async () => {
    context.harness.identity.setProcess(1234, { pgrp: 1234, startToken: '42' })
    context.harness.markGroupAlive(1234)
    await context.harness.manager.start()

    await context.harness.manager.stop()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(-1234, 'SIGTERM')
    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(1234, 'SIGTERM')
  })

  it('starts and stops an unenforced production server without /proc attestation', async () => {
    context.harness.identity.attested = false
    context.harness.identity.removeProcess(1234)

    await context.harness.manager.start()

    expect(context.harness.spawnOptions().detached).toBe(true)
    expect(context.harness.manager.isSandboxEnforced()).toBe(false)

    await context.harness.manager.stop()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(1234, 'SIGTERM')
    expect(context.harness.manager.getServerPid()).toBeNull()
    expect(context.harness.manager.isServerHealthy()).toBe(false)
  })

  it('refuses to signal a reused PID whose identity no longer matches the child state marker on stop', async () => {
    await context.harness.manager.start()
    context.harness.signalProcess.mockClear()

    context.harness.identity.setProcess(1234, { pgrp: 3, startToken: 'reused-token' })
    await context.harness.manager.stop()

    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(1234, 'SIGTERM')
    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(-1234, 'SIGTERM')
    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(1234, 'SIGKILL')
    expect(await readChildStateMarkerFile(context.workspace.path)).not.toBeNull()
    expect(context.harness.manager.isServerHealthy()).toBe(false)
  })

  it('reconciles the attested child marker on stop once the tracked child has exited', async () => {
    await context.harness.manager.start()

    context.harness.lastChild().exitChild(0)
    expect(context.harness.manager.getServerPid()).toBeNull()
    expect(context.harness.manager.isServerHealthy()).toBe(false)

    context.harness.signalProcess.mockClear()
    await context.harness.manager.stop()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(1234, 'SIGTERM')
    expect(await readChildStateMarkerFile(context.workspace.path)).toBeNull()
    expect(context.harness.manager.getServerPid()).toBeNull()
  })

  it.each(['stop', 'restart'])(
    'keeps the child state marker and fails the %s when the process group survives SIGKILL',
    async (operation) => {
      context.harness.identity.setProcess(1234, { pgrp: 1234, startToken: '42' })
      context.harness.markGroupAlive(1234)
      await context.harness.manager.start()

      context.harness.signalProcess.mockImplementation((target, signal) => {
        if (signal === 0 && target === -1234) return
        if (signal === 0) throw esrch()
      })

      if (operation === 'stop') {
        await expect(context.harness.manager.stop()).rejects.toThrow('refusing to complete the stop')
      } else {
        await expect(context.harness.manager.restart()).rejects.toThrow('refusing to complete the stop')
      }

      expect(await readChildStateMarkerFile(context.workspace.path)).not.toBeNull()
      expect(context.harness.manager.getServerPid()).not.toBeNull()
      expect(context.harness.manager.isServerHealthy()).toBe(false)
      expect(context.harness.manager.getLastStartupError()).toContain('1234')
    },
  )

  it('keeps the child state marker and fails the stop when the leader has exited but an attested group member survives', async () => {
    context.harness.identity.setProcess(1234, { pgrp: 1234, startToken: '42' })
    context.harness.identity.setProcess(1235, { pgrp: 1234, startToken: '77' })
    await context.harness.manager.start()
    expect(await readChildStateMarkerFile(context.workspace.path)).toEqual(marker({
      pgid: 1234,
      groupMembers: [
        { pid: 1234, startToken: '42' },
        { pid: 1235, startToken: '77' },
      ],
    }))

    context.harness.identity.removeProcess(1234)
    context.harness.markGroupAlive(1234)
    surviveEverySignal(context.harness)

    await expect(context.harness.manager.stop()).rejects.toThrow('refusing to complete the stop')

    expect(context.harness.signalProcess).toHaveBeenCalledWith(-1234, 'SIGTERM')
    expect(context.harness.signalProcess).toHaveBeenCalledWith(-1234, 'SIGKILL')
    expect(await readChildStateMarkerFile(context.workspace.path)).not.toBeNull()
    expect(context.harness.manager.getServerPid()).not.toBeNull()
    expect(context.harness.manager.isServerHealthy()).toBe(false)
  })
})

describe('OpenCodeServerManager - port ownership', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createOpenCodeServerTestContext()
    context.harness.manager.setDatabase(context.db)
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('restricts port-owner inspection to listening TCP sockets', async () => {
    await context.harness.manager.start()

    expect(context.harness.runCommand).toHaveBeenCalledWith('lsof -nP -t -iTCP:5551 -sTCP:LISTEN')
  })

  it('fails an enforced start when the port owner inspection cannot run', async () => {
    context.harness.sandbox.enabled = true
    context.harness.runCommand.mockImplementation(() => {
      throw new Error('lsof is not installed')
    })

    await expect(context.harness.manager.start()).rejects.toThrow('Cannot inspect port 5551 ownership')
    expect(context.harness.spawnServer).not.toHaveBeenCalled()
    expect(context.harness.manager.isLastStartupErrorNonRecoverable()).toBe(true)
  })

  it('aborts an enforced replacement when an existing port owner survives the termination attempts', async () => {
    context.harness.sandbox.enabled = true
    context.harness.runCommand.mockReturnValue('9998\n')
    context.harness.signalProcess.mockImplementation((target, signal) => {
      if (target !== 9998 && target !== -9998) throw esrch()
      if (signal === 0) return
      throw errnoError('EPERM', 'Operation not permitted')
    })

    await expect(context.harness.manager.start()).rejects.toThrow('still own the port')
    expect(context.harness.manager.getLastStartupError()).toContain('9998')
    expect(context.harness.spawnServer).not.toHaveBeenCalled()
  })

  it('refuses to mark a replacement healthy when the new process does not own the port', async () => {
    context.harness.sandbox.enabled = true
    context.harness.runCommand.mockReturnValue('9997\n')

    await expect(context.harness.manager.start()).rejects.toThrow('does not own the OpenCode port')
    expect(context.harness.manager.getLastStartupError()).toContain('1234')
    expect(context.harness.manager.getLastStartupError()).toContain('9997')
  })

  it('refuses an enforced fresh start when the spawned process does not own the port', async () => {
    context.harness.sandbox.enabled = true
    context.harness.runCommand.mockImplementation(() => (context.harness.children.length > 0 ? '8888\n' : ''))

    await expect(context.harness.manager.start()).rejects.toThrow('does not own the OpenCode port')
    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
    expect(context.harness.manager.getLastStartupError()).toContain('1234')
    expect(context.harness.manager.getLastStartupError()).toContain('8888')
    expect(context.harness.manager.isServerHealthy()).toBe(false)
  })
})

describe('OpenCodeServerManager - predecessor process groups', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createOpenCodeServerTestContext()
    context.harness.manager.setDatabase(context.db)
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('terminates the attested predecessor process group before an enforced start', async () => {
    context.harness.sandbox.enabled = true
    context.harness.identity.setProcess(9999, { pgrp: 9999, startToken: '42' })
    context.harness.markGroupAlive(9999)
    context.harness.runCommand.mockImplementation(() => (context.harness.children.length > 0 ? '1234\n' : '9999\n'))
    await writeChildStateMarkerFile(context.workspace.path, marker({ pid: 9999, pgid: 9999 }))

    await context.harness.manager.start()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(-9999, 'SIGTERM')
    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
    expect(context.harness.spawnEnv().OCM_SANDBOX_ENFORCED).toBe('true')
  })

  it('terminates the predecessor process group via the persisted group id when the leader has exited', async () => {
    context.harness.sandbox.enabled = true
    context.harness.identity.setProcess(10001, { pgrp: 9999, startToken: '77' })
    context.harness.markGroupAlive(9999)
    context.harness.ownPortAfterSpawn()
    await writeChildStateMarkerFile(context.workspace.path, marker({
      pid: 9999,
      pgid: 9999,
      groupMembers: [{ pid: 10001, startToken: '77' }],
    }))

    await context.harness.manager.start()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(-9999, 'SIGTERM')
    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(9999, 'SIGTERM')
    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
  })

  it('terminates an attested predecessor group when the marker carries a malformed group member', async () => {
    context.harness.sandbox.enabled = true
    context.harness.identity.setProcess(10001, { pgrp: 9999, startToken: '77' })
    context.harness.markGroupAlive(9999)
    context.harness.ownPortAfterSpawn()
    await writeRawChildStateMarker(
      context.workspace.path,
      JSON.stringify({
        pid: 9999,
        pgid: 9999,
        enforced: false,
        startToken: '42',
        generation: 0,
        groupMembers: [
          { pid: 'not-a-pid', startToken: '77' },
          { pid: 10001, startToken: '77' },
        ],
      }),
    )

    await context.harness.manager.start()

    expect(context.harness.signalProcess).toHaveBeenCalledWith(-9999, 'SIGTERM')
    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
  })

  it('refuses an enforced start when a reused process group cannot be proven to belong to the exited leader', async () => {
    context.harness.sandbox.enabled = true
    context.harness.identity.setProcess(9999, { pgrp: 9999, startToken: '77' })
    context.harness.identity.setProcess(10001, { pgrp: 9999, startToken: '88' })
    context.harness.markGroupAlive(9999)
    await writeChildStateMarkerFile(context.workspace.path, marker({ pid: 9999, pgid: 9999 }))

    await expect(context.harness.manager.start()).rejects.toThrow('cannot be proven to belong to it')

    expect(context.harness.manager.getLastStartupError()).toContain('9999')
    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(-9999, 'SIGTERM')
    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(-9999, 'SIGKILL')
    expect(context.harness.spawnServer).not.toHaveBeenCalled()
  })

  it('never signals a reused PID whose identity does not match the child state marker', async () => {
    context.harness.sandbox.enabled = true
    context.harness.identity.setProcess(9999, { pgrp: 3, startToken: '77' })
    context.harness.ownPortAfterSpawn()
    await writeChildStateMarkerFile(context.workspace.path, marker({ pid: 9999, pgid: 9999 }))

    await context.harness.manager.start()

    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(9999, 'SIGTERM')
    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(9999, 'SIGKILL')
    expect(context.harness.signalProcess).not.toHaveBeenCalledWith(-9999, 'SIGTERM')
    expect(context.harness.spawnEnv().OCM_SANDBOX_ENFORCED).toBe('true')
  })

  it('refuses an enforced start when the attested predecessor process group retains live members', async () => {
    context.harness.sandbox.enabled = true
    context.harness.identity.setProcess(9999, { pgrp: 9999, startToken: '42' })
    context.harness.markGroupAlive(9999)
    surviveEverySignal(context.harness)
    context.harness.runCommand.mockReturnValue('9999\n')
    await writeChildStateMarkerFile(context.workspace.path, marker({ pid: 9999 }))

    await expect(context.harness.manager.start()).rejects.toThrow('refusing to start an enforced server')

    expect(context.harness.manager.getLastStartupError()).toContain('9999')
    expect(context.harness.spawnServer).not.toHaveBeenCalled()
  })
})

describe('OpenCodeServerManager - marker path helpers', () => {
  it('resolves the child state marker inside the workspace state directory', () => {
    expect(childStateMarkerPath('/tmp/workspace')).toBe(
      path.join('/tmp/workspace', '.opencode', 'state', 'opencode-server-child.json'),
    )
  })
})

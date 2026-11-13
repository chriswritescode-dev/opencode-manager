import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  detectSandboxCapability,
  resetSandboxCapabilityCache,
  sandboxCapabilityProbes,
  type SandboxCapabilityProbes,
} from '../../../src/services/sandbox/capability'
import { overrideSandboxExecutableTrustValidator } from '../../../src/services/sandbox/command'
import { expectLoggedMessage } from '../../helpers/log-assertions'
import { applyTestEnv } from '../../helpers/test-env'

function createProbes(overrides: Partial<SandboxCapabilityProbes> = {}): SandboxCapabilityProbes {
  return {
    isKvmAccessible: () => true,
    readMsbVersion: () => ({ status: 0, stdout: 'msb 0.3.1\n', stderr: '' }),
    resolveExecUserUid: () => null,
    currentUid: () => 1000,
    currentGid: () => 1000,
    ...overrides,
  }
}

function createFakeMsbBinary(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'ocm-msb-bin-'))
  const binary = path.join(directory, 'msb')
  writeFileSync(binary, '#!/bin/sh\necho "msb 0.3.1"\n', { mode: 0o755 })
  chmodSync(binary, 0o755)
  return directory
}

describe('detectSandboxCapability', () => {
  let restoreEnv: (() => void) | undefined
  let binDirectory: string | undefined

  beforeEach(() => {
    resetSandboxCapabilityCache()
    overrideSandboxExecutableTrustValidator(() => true)
  })

  afterEach(() => {
    resetSandboxCapabilityCache()
    overrideSandboxExecutableTrustValidator(null)
    restoreEnv?.()
    restoreEnv = undefined
    if (binDirectory) {
      rmSync(binDirectory, { recursive: true, force: true })
      binDirectory = undefined
    }
  })

  it('reports unavailable when /dev/kvm is not accessible or writable', () => {
    const readMsbVersion = vi.fn(createProbes().readMsbVersion)
    binDirectory = createFakeMsbBinary()
    restoreEnv = applyTestEnv({ PATH: binDirectory })

    const result = detectSandboxCapability(createProbes({ isKvmAccessible: () => false, readMsbVersion }))

    expect(result.available).toBe(false)
    expect(result.reason).toContain('/dev/kvm')
    expect(readMsbVersion).not.toHaveBeenCalled()
    expectLoggedMessage('/dev/kvm')
  })

  it('reports unavailable when msb --version exits with a non-zero status', () => {
    binDirectory = createFakeMsbBinary()
    restoreEnv = applyTestEnv({ PATH: binDirectory })

    const result = detectSandboxCapability(createProbes({
      readMsbVersion: () => ({ status: 1, stdout: '', stderr: 'msb: not found' }),
    }))

    expect(result.available).toBe(false)
    expect(result.reason).toContain('msb CLI version probe failed')
    expect(result.reason).toContain('msb: not found')
  })

  it('reports unavailable when msb --version fails to spawn', () => {
    binDirectory = createFakeMsbBinary()
    restoreEnv = applyTestEnv({ PATH: binDirectory })

    const result = detectSandboxCapability(createProbes({
      readMsbVersion: () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn ENOENT') }),
    }))

    expect(result.available).toBe(false)
    expect(result.reason).toContain('msb CLI version probe failed')
    expect(result.reason).toContain('spawn ENOENT')
  })

  it('reports available with the trimmed msb version when both probes succeed', () => {
    binDirectory = createFakeMsbBinary()
    restoreEnv = applyTestEnv({ PATH: binDirectory })

    const result = detectSandboxCapability(createProbes())

    expect(result).toEqual({ available: true, msbVersion: 'msb 0.3.1' })
  })

  it('probes the version of a real executable', () => {
    binDirectory = createFakeMsbBinary()
    restoreEnv = applyTestEnv({ PATH: binDirectory })

    const result = detectSandboxCapability(createProbes({
      readMsbVersion: sandboxCapabilityProbes.readMsbVersion,
    }))

    expect(result).toEqual({ available: true, msbVersion: 'msb 0.3.1' })
  })

  it('reports unavailable when an explicit exec user uid does not match the manager uid', () => {
    const readMsbVersion = vi.fn(createProbes().readMsbVersion)
    binDirectory = createFakeMsbBinary()
    restoreEnv = applyTestEnv({ PATH: binDirectory })

    const result = detectSandboxCapability(createProbes({
      resolveExecUserUid: () => 2000,
      currentUid: () => 1000,
      readMsbVersion,
    }))

    expect(result.available).toBe(false)
    expect(result.reason).toContain('SANDBOX_EXEC_USER')
    expect(result.reason).toContain('1000')
    expect(readMsbVersion).not.toHaveBeenCalled()
    expectLoggedMessage('SANDBOX_EXEC_USER')
  })

  it('memoizes the probe result until the cache is reset', () => {
    const readMsbVersion = vi.fn(createProbes().readMsbVersion)
    binDirectory = createFakeMsbBinary()
    restoreEnv = applyTestEnv({ PATH: binDirectory })
    const probes = createProbes({ readMsbVersion })

    const first = detectSandboxCapability(probes)
    const second = detectSandboxCapability(probes)

    expect(readMsbVersion).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)

    resetSandboxCapabilityCache()

    const third = detectSandboxCapability(probes)

    expect(readMsbVersion).toHaveBeenCalledTimes(2)
    expect(third).toEqual(first)
  })

  it('resolves a relative MSB_PATH against PATH to one absolute executable before probing the version', () => {
    binDirectory = createFakeMsbBinary()
    restoreEnv = applyTestEnv({ PATH: binDirectory })
    const readMsbVersion = vi.fn(createProbes().readMsbVersion)

    const result = detectSandboxCapability(createProbes({ readMsbVersion }))

    expect(result.available).toBe(true)
    expect(readMsbVersion).toHaveBeenCalledWith(path.join(binDirectory, 'msb'))
  })

  it('reports unavailable when a relative MSB_PATH cannot be resolved on PATH', () => {
    restoreEnv = applyTestEnv({ PATH: '/nonexistent-ocm-bin' })
    const readMsbVersion = vi.fn(createProbes().readMsbVersion)

    const result = detectSandboxCapability(createProbes({ readMsbVersion }))

    expect(result.available).toBe(false)
    expect(result.reason).toBe('msb CLI not found or not executable')
    expect(readMsbVersion).not.toHaveBeenCalled()
  })
})

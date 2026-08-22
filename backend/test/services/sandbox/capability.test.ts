import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accessSync, realpathSync, statSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectSandboxCapability, resetSandboxCapabilityCache } from '../../../src/services/sandbox/capability'
import { logger } from '../../../src/utils/logger'

vi.mock('fs', () => ({
  accessSync: vi.fn(),
  realpathSync: vi.fn((candidate: string) => candidate),
  statSync: vi.fn(() => ({ uid: 0, gid: 0, mode: 0o755 })),
  constants: {
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
  },
}))

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}))

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

const mockAccessSync = accessSync as unknown as ReturnType<typeof vi.fn>
const mockSpawnSync = spawnSync as unknown as ReturnType<typeof vi.fn>
const mockRealpathSync = realpathSync as unknown as ReturnType<typeof vi.fn>
const mockStatSync = statSync as unknown as ReturnType<typeof vi.fn>

describe('detectSandboxCapability', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRealpathSync.mockImplementation((candidate: string) => candidate)
    mockStatSync.mockReturnValue({ uid: 0, gid: 0, mode: 0o755 })
    resetSandboxCapabilityCache()
  })
  afterEach(() => {
    resetSandboxCapabilityCache()
  })

  it('reports unavailable when /dev/kvm is not accessible or writable', () => {
    mockAccessSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = detectSandboxCapability()

    expect(result.available).toBe(false)
    expect(result.reason).toContain('/dev/kvm')
    expect(mockSpawnSync).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('/dev/kvm'))
  })

  it('reports unavailable when msb --version exits with a non-zero status', () => {
    mockAccessSync.mockImplementation(() => {})
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'msb: not found' })

    const result = detectSandboxCapability()

    expect(result.available).toBe(false)
    expect(result.reason).toContain('msb CLI version probe failed')
    expect(result.reason).toContain('msb: not found')
  })

  it('reports unavailable when msb --version fails to spawn', () => {
    mockAccessSync.mockImplementation(() => {})
    mockSpawnSync.mockReturnValue({ status: null, stdout: '', stderr: '', error: new Error('spawn ENOENT') })

    const result = detectSandboxCapability()

    expect(result.available).toBe(false)
    expect(result.reason).toContain('msb CLI version probe failed')
    expect(result.reason).toContain('spawn ENOENT')
  })

  it('reports available with the trimmed msb version when both probes succeed', () => {
    mockAccessSync.mockImplementation(() => {})
    mockSpawnSync.mockReturnValue({ status: 0, stdout: 'msb 0.3.1\n', stderr: '' })

    const result = detectSandboxCapability()

    expect(result).toEqual({ available: true, msbVersion: 'msb 0.3.1' })
  })

  it('reports unavailable when an explicit exec user uid does not match the manager uid', async () => {
    process.env.SANDBOX_EXEC_USER = '2000'
    try {
      vi.resetModules()
      const { detectSandboxCapability, resetSandboxCapabilityCache } = await import(
        '../../../src/services/sandbox/capability'
      )
      const { logger } = await import('../../../src/utils/logger')
      const { spawnSync } = await import('child_process')
      const { accessSync } = await import('fs')
      ;(accessSync as ReturnType<typeof vi.fn>).mockImplementation(() => {})
      const proc = process as unknown as { getuid: () => number; getgid: () => number }
      const getuid = vi.spyOn(proc, 'getuid').mockReturnValue(1000)
      const getgid = vi.spyOn(proc, 'getgid').mockReturnValue(1000)
      resetSandboxCapabilityCache()

      const result = detectSandboxCapability()

      expect(result.available).toBe(false)
      expect(result.reason).toContain('SANDBOX_EXEC_USER')
      expect(result.reason).toContain('1000')
      expect(spawnSync).not.toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('SANDBOX_EXEC_USER'))
      expect(getuid).toHaveBeenCalled()
      expect(getgid).toHaveBeenCalled()
    } finally {
      delete process.env.SANDBOX_EXEC_USER
      vi.restoreAllMocks()
    }
  })

  it('memoizes the probe result until the cache is reset', () => {
    mockAccessSync.mockImplementation(() => {})
    mockSpawnSync.mockReturnValue({ status: 0, stdout: 'msb 0.3.1\n', stderr: '' })

    const first = detectSandboxCapability()
    const second = detectSandboxCapability()

    expect(mockSpawnSync).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)

    resetSandboxCapabilityCache()

    const third = detectSandboxCapability()

    expect(mockSpawnSync).toHaveBeenCalledTimes(2)
    expect(third).toEqual(first)
  })

  it('resolves a relative MSB_PATH against PATH to one absolute executable before probing the version', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await vi.importActual<typeof import('fs')>('fs')
    const fakeBin = mkdtempSync(path.join(tmpdir(), 'ocm-msb-bin-'))
    writeFileSync(path.join(fakeBin, 'msb'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const originalPath = process.env.PATH
    process.env.PATH = fakeBin
    try {
      vi.resetModules()
      const { detectSandboxCapability, resetSandboxCapabilityCache } = await import(
        '../../../src/services/sandbox/capability'
      )
      const { spawnSync } = await import('child_process')
      const { accessSync } = await import('fs')
      ;(accessSync as ReturnType<typeof vi.fn>).mockImplementation(() => {})
      ;(spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0, stdout: 'msb 0.3.1\n', stderr: '' })
      resetSandboxCapabilityCache()

      const result = detectSandboxCapability()

      expect(result.available).toBe(true)
      expect(spawnSync).toHaveBeenCalledWith(
        path.join(fakeBin, 'msb'),
        ['--version'],
        expect.objectContaining({ encoding: 'utf8' }),
      )
    } finally {
      process.env.PATH = originalPath
      rmSync(fakeBin, { recursive: true, force: true })
    }
  })

  it('reports unavailable when a relative MSB_PATH cannot be resolved on PATH', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = '/nonexistent-ocm-bin'
    try {
      vi.resetModules()
      const { detectSandboxCapability, resetSandboxCapabilityCache } = await import(
        '../../../src/services/sandbox/capability'
      )
      const { spawnSync } = await import('child_process')
      const { accessSync } = await import('fs')
      ;(accessSync as ReturnType<typeof vi.fn>).mockImplementation((target: string) => {
        if (target === '/dev/kvm') return
        throw new Error('ENOENT')
      })
      ;(spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0, stdout: 'msb 0.3.1\n', stderr: '' })
      resetSandboxCapabilityCache()

      const result = detectSandboxCapability()

      expect(result.available).toBe(false)
      expect(result.reason).toBe('msb CLI not found or not executable')
      expect(spawnSync).not.toHaveBeenCalled()
    } finally {
      process.env.PATH = originalPath
    }
  })
})

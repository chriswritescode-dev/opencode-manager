import { describe, it, expect } from 'vitest'
import os from 'os'
import { ENV } from '@opencode-manager/shared/config/env'
import { parseMemoryMib } from '../../../src/services/sandbox/command'
import {
  envSandboxResources,
  resolveSandboxResources,
  sandboxResourceLimitError,
} from '../../../src/services/sandbox/resources'

describe('sandbox resources', () => {
  const hostCpus = os.availableParallelism()
  const hostMemoryMib = Math.floor(os.totalmem() / 1048576)

  it('reads the environment sandbox resources', () => {
    expect(envSandboxResources()).toEqual({
      cpus: ENV.SANDBOX.CPUS,
      memoryMib: parseMemoryMib(ENV.SANDBOX.MEMORY),
    })
  })

  it('falls back to the environment when no preferences or override are set', () => {
    expect(resolveSandboxResources(undefined, null)).toEqual(envSandboxResources())
  })

  it('prefers preference values over the environment', () => {
    expect(resolveSandboxResources({ enabled: false, cpus: 6, memoryMib: 2048 }, null)).toEqual({
      cpus: 6,
      memoryMib: 2048,
    })
  })

  it('prefers the per-session override over preferences and the environment', () => {
    expect(
      resolveSandboxResources({ enabled: false, cpus: 6, memoryMib: 2048 }, { cpus: 2, memoryMib: 1024 }),
    ).toEqual({ cpus: 2, memoryMib: 1024 })
  })

  it('fills each field independently from preferences and the environment', () => {
    const env = envSandboxResources()
    expect(resolveSandboxResources({ enabled: false, cpus: 6 }, null)).toEqual({ cpus: 6, memoryMib: env.memoryMib })
    expect(resolveSandboxResources({ enabled: false, memoryMib: 2048 }, null)).toEqual({ cpus: env.cpus, memoryMib: 2048 })
  })

  it('accepts requests within the host limits', () => {
    expect(sandboxResourceLimitError({})).toBeNull()
    expect(sandboxResourceLimitError({ cpus: hostCpus })).toBeNull()
    expect(sandboxResourceLimitError({ memoryMib: hostMemoryMib })).toBeNull()
  })

  it('rejects a cpu request above the host limit', () => {
    const error = sandboxResourceLimitError({ cpus: hostCpus + 1 })

    expect(error).toContain(String(hostCpus + 1))
    expect(error).toContain(String(hostCpus))
  })

  it('rejects a memory request above the host limit', () => {
    const error = sandboxResourceLimitError({ memoryMib: hostMemoryMib + 1 })

    expect(error).toContain(String(hostMemoryMib + 1))
    expect(error).toContain(String(hostMemoryMib))
  })
})

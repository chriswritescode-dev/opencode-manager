import os from 'os'
import type { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import type { SandboxPreferences, SessionSandboxResources } from '@opencode-manager/shared/schemas'
import { getRepoByExactDirectory, getRepoSandboxResources } from '../../db/queries'
import { resolveMainCheckoutPath, resolveRepoForDirectory } from '../repo'
import { SettingsService } from '../settings'
import { parseMemoryMib } from './command'

export function envSandboxResources(): SessionSandboxResources {
  const cpus = ENV.SANDBOX.CPUS
  if (!Number.isInteger(cpus) || cpus <= 0) {
    throw new Error(`sandbox cpus must be a positive integer, received ${String(cpus)}`)
  }

  const memoryMib = parseMemoryMib(ENV.SANDBOX.MEMORY)
  if (memoryMib === null || memoryMib <= 0) {
    throw new Error(`sandbox memory must be a positive size, received ${JSON.stringify(ENV.SANDBOX.MEMORY)}`)
  }

  return { cpus, memoryMib }
}

export function resolveSandboxResources(
  preferences: SandboxPreferences | undefined,
  override: SessionSandboxResources | null,
): SessionSandboxResources {
  const env = envSandboxResources()
  return {
    cpus: override?.cpus ?? preferences?.cpus ?? env.cpus,
    memoryMib: override?.memoryMib ?? preferences?.memoryMib ?? env.memoryMib,
  }
}

export function sandboxResourceLimitError(resources: Partial<SessionSandboxResources>): string | null {
  const maxCpus = os.availableParallelism()
  if (resources.cpus !== undefined && resources.cpus > maxCpus) {
    return `Requested ${resources.cpus} CPUs exceeds the host limit of ${maxCpus}`
  }

  const maxMemoryMib = Math.floor(os.totalmem() / 1048576)
  if (resources.memoryMib !== undefined && resources.memoryMib > maxMemoryMib) {
    return `Requested ${resources.memoryMib} MiB of memory exceeds the host limit of ${maxMemoryMib} MiB`
  }

  return null
}

const checkoutRunResources = new Map<string, SessionSandboxResources>()

export function setCheckoutRunResources(checkoutKey: string, resources: SessionSandboxResources): void {
  checkoutRunResources.set(checkoutKey, resources)
}

export function clearCheckoutRunResources(checkoutKey: string): void {
  checkoutRunResources.delete(checkoutKey)
}

export function resetCheckoutRunResources(): void {
  checkoutRunResources.clear()
}

async function resolveRepoSandboxResources(db: Database, checkoutKey: string): Promise<SessionSandboxResources | null> {
  const repo = await resolveRepoForDirectory(db, checkoutKey)
  if (repo === null) return null
  const resources = getRepoSandboxResources(db, repo.id)
  if (resources !== null || !repo.isWorktree) return resources
  const mainCheckout = await resolveMainCheckoutPath(repo.fullPath)
  if (mainCheckout === null) return null
  const mainRepo = getRepoByExactDirectory(db, mainCheckout)
  return mainRepo === null ? null : getRepoSandboxResources(db, mainRepo.id)
}

export async function resolveCheckoutSandboxResources(
  db: Database,
  checkoutKey: string,
): Promise<SessionSandboxResources> {
  const override = checkoutRunResources.get(checkoutKey) ?? await resolveRepoSandboxResources(db, checkoutKey)
  return resolveSandboxResources(new SettingsService(db).getSettings('default').preferences.sandbox, override)
}

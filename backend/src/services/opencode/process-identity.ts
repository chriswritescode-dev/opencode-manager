import { readFileSync, readdirSync } from 'fs'

export type ProcessStat = {
  pgrp: number
  startToken: string
}

export type ProcessGroupMember = {
  pid: number
  startToken: string
}

export type ProcessIdentityProvider = {
  attested: boolean
  readProcessStat(pid: number): ProcessStat | null
  readProcessGroupMembers(pgid: number): ProcessGroupMember[]
}

function parseProcessStat(stat: string): ProcessStat | null {
  const commEnd = stat.lastIndexOf(')')
  if (commEnd === -1) return null
  const fields = stat.slice(commEnd + 2).split(' ')
  const pgrp = Number(fields[2])
  const startToken = fields[19]
  if (!Number.isInteger(pgrp) || pgrp <= 0) return null
  if (startToken === undefined || startToken === '') return null
  return { pgrp, startToken }
}

const LINUX_PROCESS_IDENTITY_PROVIDER: ProcessIdentityProvider = {
  attested: true,
  readProcessStat(pid) {
    try {
      return parseProcessStat(readFileSync(`/proc/${pid}/stat`, 'utf-8'))
    } catch {
      return null
    }
  },
  readProcessGroupMembers(pgid) {
    const members: ProcessGroupMember[] = []
    let entries: string[]
    try {
      entries = readdirSync('/proc')
    } catch {
      return members
    }
    if (!Array.isArray(entries)) return members
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue
      const pid = Number(entry)
      const stat = this.readProcessStat(pid)
      if (stat !== null && stat.pgrp === pgid) {
        members.push({ pid, startToken: stat.startToken })
      }
    }
    return members
  },
}

const DIRECT_CHILD_PROCESS_IDENTITY_PROVIDER: ProcessIdentityProvider = {
  attested: false,
  readProcessStat() {
    return null
  },
  readProcessGroupMembers() {
    return []
  },
}

let cachedProvider: ProcessIdentityProvider | null = null
let forcedProvider: ProcessIdentityProvider | null = null

export function resolveProcessIdentityProvider(): ProcessIdentityProvider {
  if (cachedProvider !== null) return cachedProvider
  cachedProvider = forcedProvider ??
    (process.platform === 'linux' ? LINUX_PROCESS_IDENTITY_PROVIDER : DIRECT_CHILD_PROCESS_IDENTITY_PROVIDER)
  return cachedProvider
}

export function getProcessIdentityAttestationError(): string | null {
  return resolveProcessIdentityProvider().attested
    ? null
    : 'process identity attestation is unavailable on this platform (Linux /proc is required)'
}

export function resetProcessIdentityProvider(): void {
  cachedProvider = null
}

export function forceProcessAttestation(attested: boolean | null): void {
  forcedProvider = attested === null ? null : attested ? LINUX_PROCESS_IDENTITY_PROVIDER : DIRECT_CHILD_PROCESS_IDENTITY_PROVIDER
  cachedProvider = null
}

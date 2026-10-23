import { readFile, readdir, readlink } from 'node:fs/promises'
import { ENV } from '@opencode-manager/shared/config/env'
import type { PreviewPort } from '@opencode-manager/shared/schemas'
import { executeCommand } from '../../utils/process'

export type PreviewPortEntry = Omit<PreviewPort, 'inDirectory'>

export interface ParsedProcNetSocket {
  port: number
  address: string
  inode: string
}

export interface LsofListener {
  port: number
  address: string
  pid: number | null
  command: string | null
}

export interface PortDiscoveryDeps {
  platform: NodeJS.Platform
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  readdir: (path: string) => Promise<string[]>
  readlink: (path: string) => Promise<string>
  runLsof: () => Promise<string>
  runLsofCwd: (pids: number[]) => Promise<string>
}

interface LsofFieldRecord {
  pid: number | null
  command: string | null
  name: string
}

const PROC_NET_FILES: ReadonlyArray<readonly [string, 4 | 6]> = [
  ['/proc/net/tcp', 4],
  ['/proc/net/tcp6', 6],
]

const WILDCARD_V4 = '0.0.0.0'
const WILDCARD_V6 = '::'

function decodeIpv4Hex(hex: string): string | null {
  if (hex.length !== 8) return null
  const octets: number[] = []
  for (let index = 6; index >= 0; index -= 2) {
    const octet = Number.parseInt(hex.slice(index, index + 2), 16)
    if (Number.isNaN(octet)) return null
    octets.push(octet)
  }
  return octets.join('.')
}

function formatIpv6(groups: string[]): string {
  const normalized = groups.map((group) => group.replace(/^0+/, '') || '0')
  let bestStart = -1
  let bestLength = 0
  let currentStart = -1
  let currentLength = 0
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === '0') {
      if (currentStart === -1) {
        currentStart = index
        currentLength = 0
      }
      currentLength += 1
      if (currentLength > bestLength) {
        bestLength = currentLength
        bestStart = currentStart
      }
    } else {
      currentStart = -1
      currentLength = 0
    }
  }
  if (bestLength < 2) return normalized.join(':')
  const head = normalized.slice(0, bestStart).join(':')
  const tail = normalized.slice(bestStart + bestLength).join(':')
  return `${head}::${tail}`
}

function decodeIpv6Hex(hex: string): string | null {
  if (hex.length !== 32) return null
  const groups: string[] = []
  for (let index = 0; index < 32; index += 8) {
    const word = hex.slice(index, index + 8)
    const reversed = `${word.slice(6, 8)}${word.slice(4, 6)}${word.slice(2, 4)}${word.slice(0, 2)}`
    groups.push(reversed.slice(0, 4), reversed.slice(4, 8))
  }
  return formatIpv6(groups)
}

function isAllowedAddress(address: string): boolean {
  return (
    address === WILDCARD_V4 ||
    address === WILDCARD_V6 ||
    address === '::1' ||
    address === '127.0.0.1'
  )
}

export function isReservedPreviewPort(port: number): boolean {
  return port === ENV.SERVER.PORT || port === ENV.OPENCODE.PORT || port === ENV.PREVIEW.PORT
}

export function parseProcNetTcp(text: string, family: 4 | 6): ParsedProcNetSocket[] {
  const sockets: ParsedProcNetSocket[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('sl')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 10) continue
    if (parts[3] !== '0A') continue
    const local = parts[1]
    if (!local) continue
    const separator = local.lastIndexOf(':')
    if (separator === -1) continue
    const addressHex = local.slice(0, separator)
    const portHex = local.slice(separator + 1)
    const port = Number.parseInt(portHex, 16)
    if (Number.isNaN(port)) continue
    const address = family === 4 ? decodeIpv4Hex(addressHex) : decodeIpv6Hex(addressHex)
    if (!address || !isAllowedAddress(address)) continue
    sockets.push({ port, address, inode: parts[9] ?? '' })
  }
  return sockets
}

function parseLsofName(value: string): { address: string; port: number } | null {
  let address: string
  let portText: string
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end === -1) return null
    address = value.slice(1, end)
    const rest = value.slice(end + 1)
    if (!rest.startsWith(':')) return null
    portText = rest.slice(1)
  } else {
    const separator = value.lastIndexOf(':')
    if (separator === -1) return null
    address = value.slice(0, separator)
    portText = value.slice(separator + 1)
  }
  if (address === '*') address = WILDCARD_V4
  const port = Number.parseInt(portText, 10)
  if (Number.isNaN(port)) return null
  return { address, port }
}

function* iterateLsofFields(output: string): Generator<LsofFieldRecord> {
  let pid: number | null = null
  let command: string | null = null
  for (const rawLine of output.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line) continue
    const type = line[0]
    const value = line.slice(1)
    if (type === 'p') {
      const parsed = Number.parseInt(value, 10)
      pid = Number.isNaN(parsed) ? null : parsed
    } else if (type === 'c') {
      command = value
    } else if (type === 'n') {
      yield { pid, command, name: value }
    }
  }
}

export function parseLsofListen(output: string): LsofListener[] {
  const listeners: LsofListener[] = []
  for (const record of iterateLsofFields(output)) {
    const parsed = parseLsofName(record.name)
    if (parsed) listeners.push({ ...parsed, pid: record.pid, command: record.command })
  }
  return listeners
}

export function parseLsofCwds(output: string): Map<number, string> {
  const cwds = new Map<number, string>()
  for (const record of iterateLsofFields(output)) {
    if (record.pid === null || record.name === '') continue
    cwds.set(record.pid, record.name)
  }
  return cwds
}

function toHost(address: string): '127.0.0.1' | '::1' {
  return address === '::1' ? '::1' : '127.0.0.1'
}

function dedupeByPort(entries: PreviewPortEntry[]): PreviewPortEntry[] {
  const byPort = new Map<number, PreviewPortEntry[]>()
  for (const entry of entries) {
    const existing = byPort.get(entry.port)
    if (existing) {
      existing.push(entry)
    } else {
      byPort.set(entry.port, [entry])
    }
  }
  const result: PreviewPortEntry[] = []
  for (const group of byPort.values()) {
    const first = group[0]!
    const onlyIpv6Loopback = group.every((entry) => entry.host === '::1')
    result.push({ ...first, host: onlyIpv6Loopback ? '::1' : '127.0.0.1' })
  }
  return result
}

async function mapInodesToPids(deps: PortDiscoveryDeps, wantedInodes: ReadonlySet<string>): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (wantedInodes.size === 0) return map
  let entries: string[]
  try {
    entries = await deps.readdir('/proc')
  } catch {
    return map
  }
  for (const entry of entries) {
    if (map.size >= wantedInodes.size) break
    if (!/^\d+$/.test(entry)) continue
    const fdDir = `/proc/${entry}/fd`
    let fds: string[]
    try {
      fds = await deps.readdir(fdDir)
    } catch {
      continue
    }
    for (const fd of fds) {
      let target: string
      try {
        target = await deps.readlink(`${fdDir}/${fd}`)
      } catch {
        continue
      }
      const match = /^socket:\[(\d+)\]$/.exec(target)
      const inode = match?.[1]
      if (inode && wantedInodes.has(inode)) map.set(inode, Number.parseInt(entry, 10))
    }
  }
  return map
}

async function readOptional(deps: PortDiscoveryDeps, file: string): Promise<string | null> {
  try {
    return (await deps.readFile(file, 'utf8')).trim() || null
  } catch {
    return null
  }
}

async function readLinkOptional(deps: PortDiscoveryDeps, file: string): Promise<string | null> {
  try {
    return await deps.readlink(file)
  } catch {
    return null
  }
}

async function listLinuxPorts(deps: PortDiscoveryDeps): Promise<PreviewPortEntry[]> {
  const sockets: ParsedProcNetSocket[] = []
  for (const [file, family] of PROC_NET_FILES) {
    let text: string
    try {
      text = await deps.readFile(file, 'utf8')
    } catch {
      continue
    }
    sockets.push(...parseProcNetTcp(text, family))
  }
  if (sockets.length === 0) return []

  const wantedInodes = new Set<string>()
  for (const socket of sockets) {
    if (socket.inode) wantedInodes.add(socket.inode)
  }
  const inodeToPid = await mapInodesToPids(deps, wantedInodes)
  const processMeta = new Map<number, { command: string | null; cwd: string | null }>()
  const entries: PreviewPortEntry[] = []
  for (const socket of sockets) {
    const pid = inodeToPid.get(socket.inode) ?? null
    let command: string | null = null
    let cwd: string | null = null
    if (pid !== null) {
      const cached = processMeta.get(pid)
      if (cached) {
        command = cached.command
        cwd = cached.cwd
      } else {
        command = await readOptional(deps, `/proc/${pid}/comm`)
        cwd = await readLinkOptional(deps, `/proc/${pid}/cwd`)
        processMeta.set(pid, { command, cwd })
      }
    }
    entries.push({ port: socket.port, host: toHost(socket.address), pid, command, cwd })
  }
  return entries
}

async function listMacPorts(deps: PortDiscoveryDeps): Promise<PreviewPortEntry[]> {
  let output: string
  try {
    output = await deps.runLsof()
  } catch {
    return []
  }
  const listeners = parseLsofListen(output).filter((listener) => isAllowedAddress(listener.address))
  const pids = [...new Set(listeners.map((listener) => listener.pid).filter((pid): pid is number => pid !== null))]
  let cwds = new Map<number, string>()
  if (pids.length > 0) {
    try {
      cwds = parseLsofCwds(await deps.runLsofCwd(pids))
    } catch {
      cwds = new Map()
    }
  }
  return listeners.map((listener) => ({
    port: listener.port,
    host: toHost(listener.address),
    pid: listener.pid,
    command: listener.command,
    cwd: listener.pid === null ? null : (cwds.get(listener.pid) ?? null),
  }))
}

export async function listListeningPorts(deps: PortDiscoveryDeps = defaultPortDeps): Promise<PreviewPortEntry[]> {
  const entries =
    deps.platform === 'linux'
      ? await listLinuxPorts(deps)
      : deps.platform === 'darwin'
        ? await listMacPorts(deps)
        : []

  return dedupeByPort(entries)
    .filter((entry) => entry.port >= 1024 && !isReservedPreviewPort(entry.port))
    .sort((left, right) => left.port - right.port)
}

function unwrapCommandResult(result: string | { exitCode: number; stdout: string; stderr: string }): string {
  return typeof result === 'string' ? result : result.stdout
}

const defaultPortDeps: PortDiscoveryDeps = {
  platform: process.platform,
  readFile: (path, encoding) => readFile(path, encoding),
  readdir: (path) => readdir(path),
  readlink: (path) => readlink(path),
  runLsof: async () =>
    unwrapCommandResult(
      await executeCommand(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], {
        ignoreExitCode: true,
      }),
    ),
  runLsofCwd: async (pids) =>
    unwrapCommandResult(
      await executeCommand(['lsof', '-a', '-d', 'cwd', '-p', pids.join(','), '-F', 'pn'], {
        ignoreExitCode: true,
      }),
    ),
}

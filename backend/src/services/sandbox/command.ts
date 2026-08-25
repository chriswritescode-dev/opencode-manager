import path from 'path'
import { accessSync, constants, realpathSync, statSync } from 'fs'
import { realpath } from 'fs/promises'
import { ENV, getReposPath, getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'

export const WORKSPACE_SANDBOX_NAME = 'ocm-workspace'

export const SANDBOX_UNAVAILABLE_PREFIX = 'Sandbox enforcement is on but the sandbox is unavailable: '

const SANDBOX_PLAN_REQUEST_MARGIN_MS = 30000

const MSB_METRICS_SAMPLE_INTERVAL_MS = 1000

export function sandboxPlanTimeoutMs(): number {
  return ENV.SANDBOX.START_TIMEOUT_MS + SANDBOX_PLAN_REQUEST_MARGIN_MS
}

let cachedExecutablePath: string | null | undefined
let executableTrustValidator: ((candidate: string) => boolean) | null = null

export function overrideSandboxExecutableTrustValidator(validator: ((candidate: string) => boolean) | null): void {
  executableTrustValidator = validator
  resetSandboxExecutableCache()
}

export function isPathWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isWritableByManager(stat: { uid: number; gid: number; mode: number }): boolean {
  if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
    if (stat.uid === process.getuid() && (stat.mode & 0o200) !== 0) return true
    if (stat.gid === process.getgid() && (stat.mode & 0o020) !== 0) return true
  }
  return (stat.mode & 0o002) !== 0
}

function pathPrefixes(target: string): string[] {
  const resolved = path.resolve(target)
  const parts = resolved.split(path.sep).filter((part) => part !== '')
  const prefixes: string[] = []
  let current = path.parse(resolved).root
  for (const part of parts) {
    current = path.join(current, part)
    prefixes.push(current)
  }
  return prefixes
}

function isTrustedExecutablePath(candidate: string): boolean {
  if (executableTrustValidator !== null) {
    return executableTrustValidator(candidate)
  }
  let canonical: string
  try {
    canonical = realpathSync(candidate)
  } catch {
    return false
  }
  const roots = sandboxMountRoots()
  for (const target of [candidate, canonical]) {
    if (roots.some((root) => isPathWithinRoot(root, target))) {
      return false
    }
  }
  for (const target of new Set([candidate, canonical])) {
    for (const prefix of pathPrefixes(target)) {
      try {
        if (isWritableByManager(statSync(prefix))) {
          return false
        }
      } catch {
        return false
      }
    }
  }
  return true
}

function computeSandboxExecutablePath(): string | null {
  const configured = ENV.SANDBOX.MSB_PATH.trim()
  const candidates: string[] = []
  if (path.isAbsolute(configured)) {
    candidates.push(configured)
  } else {
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
      if (directory === '') continue
      candidates.push(path.join(directory, configured))
    }
  }
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
    } catch {
      continue
    }
    if (isTrustedExecutablePath(candidate)) {
      return candidate
    }
  }
  return null
}

export function resolveSandboxExecutable(): string | null {
  if (cachedExecutablePath !== undefined) return cachedExecutablePath
  cachedExecutablePath = computeSandboxExecutablePath()
  return cachedExecutablePath
}

export function sandboxExecutablePath(): string {
  return resolveSandboxExecutable() ?? ENV.SANDBOX.MSB_PATH
}

export function resetSandboxExecutableCache(): void {
  cachedExecutablePath = undefined
}

export function buildSandboxVersionArgs(): string[] {
  return ['--version']
}

export function sandboxMountRoots(): string[] {
  return [getReposPath(), getScheduleWorktreesPath()]
}

export function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildSandboxCreateArgs(): string[] {
  return [
    'run',
    '-d',
    '--name',
    WORKSPACE_SANDBOX_NAME,
    '--label',
    'ocm.managed=true',
    '--label',
    `ocm.net=${ENV.SANDBOX.NET}`,
    '-m',
    ENV.SANDBOX.MEMORY,
    '-c',
    String(ENV.SANDBOX.CPUS),
    '--net',
    ENV.SANDBOX.NET,
    '-u',
    resolveSandboxExecUser(),
    ...sandboxMountRoots().flatMap((root) => ['--mount-dir', `${root}:${root}`]),
    '-w',
    getReposPath(),
    '--entrypoint',
    '/usr/bin/env',
    ENV.SANDBOX.IMAGE,
    '--',
    'sleep',
    'infinity',
  ]
}

export function buildSandboxInspectArgs(): string[] {
  return ['inspect', WORKSPACE_SANDBOX_NAME, '--format', 'json']
}

export function buildSandboxRemoveArgs(): string[] {
  return ['rm', '--force', WORKSPACE_SANDBOX_NAME]
}

export function buildSandboxListArgs(): string[] {
  return ['ls', '--format', 'json']
}

export function buildSandboxStartArgs(): string[] {
  return ['start', WORKSPACE_SANDBOX_NAME]
}

export function buildSandboxStopManagedArgs(): string[] {
  return ['stop', '--label', 'ocm.managed=true']
}

export type SandboxNetworkPolicyRule = {
  direction: string
  destination: Record<string, unknown> | string
  protocols: unknown[]
  ports: unknown[]
  action: string
}

export type SandboxNetworkPolicy = {
  default_egress: string
  default_ingress: string
  rules: SandboxNetworkPolicyRule[]
}

const SUPPORTED_SANDBOX_NETWORK_PROFILES = ['public', 'private', 'host'] as const
const TERMINAL_SANDBOX_NETWORK_PROFILES = new Set(['all', 'none'])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`
  }
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function resolveExpectedSandboxNetworkPolicy(netProfile: string): SandboxNetworkPolicy | null {
  const tokens = netProfile.split(',').map((token) => token.trim()).filter((token) => token !== '')
  if (tokens.length === 0) {
    return null
  }
  const groups: string[] = []
  for (const token of tokens) {
    if (TERMINAL_SANDBOX_NETWORK_PROFILES.has(token)) {
      return null
    }
    if (!(SUPPORTED_SANDBOX_NETWORK_PROFILES as readonly string[]).includes(token)) {
      return null
    }
    if (!groups.includes(token)) {
      groups.push(token)
    }
  }
  return {
    default_egress: 'deny',
    default_ingress: 'allow',
    rules: [
      { direction: 'egress', destination: { group: 'host' }, protocols: ['udp', 'tcp'], ports: [{ start: 53, end: 53 }], action: 'allow' },
      ...groups.map((group) => ({ direction: 'egress', destination: { group }, protocols: [], ports: [], action: 'allow' })),
    ],
  }
}

function canonicalSandboxNetworkRuleKey(rule: unknown): string | null {
  if (!isPlainRecord(rule)) return null
  if (typeof rule.direction !== 'string' || typeof rule.action !== 'string') return null
  if (!Array.isArray(rule.protocols) || !Array.isArray(rule.ports)) return null
  const protocols = [...rule.protocols].map(String).sort().join(',')
  const ports = [...rule.ports].map(String).sort().join(',')
  return `${rule.direction}|${stableJson(rule.destination)}|${protocols}|${ports}|${rule.action}`
}

export function sandboxNetworkPolicyMismatch(inspected: unknown, expected: SandboxNetworkPolicy): string | null {
  if (!isPlainRecord(inspected) || typeof inspected.default_egress !== 'string' || typeof inspected.default_ingress !== 'string') {
    return 'sandbox network policy is missing or malformed'
  }
  if (inspected.default_egress !== expected.default_egress) {
    return `sandbox network default_egress ${inspected.default_egress} does not match the deny policy required by the configured network profile; unrestricted egress is not allowed`
  }
  if (inspected.default_ingress !== expected.default_ingress) {
    return `sandbox network default_ingress ${inspected.default_ingress} does not match the configured network profile`
  }
  if (!Array.isArray(inspected.rules)) {
    return 'sandbox network policy is missing or malformed'
  }
  const inspectedKeys: string[] = []
  for (const rule of inspected.rules) {
    const key = canonicalSandboxNetworkRuleKey(rule)
    if (key === null) {
      return 'sandbox network policy contains a rule that does not match the configured network profile'
    }
    inspectedKeys.push(key)
  }
  const expectedKeys = expected.rules.map((rule) => {
    const key = canonicalSandboxNetworkRuleKey(rule)
    return key === null ? `unexpected:${stableJson(rule)}` : key
  })
  if (inspectedKeys.length !== expectedKeys.length) {
    return `sandbox network policy rules do not match the configured network profile (expected ${expectedKeys.length}, found ${inspectedKeys.length})`
  }
  const sortedInspected = [...inspectedKeys].sort()
  const sortedExpected = [...expectedKeys].sort()
  for (let index = 0; index < sortedExpected.length; index++) {
    if (sortedInspected[index] !== sortedExpected[index]) {
      return 'sandbox network policy contains a rule that does not match the configured network profile'
    }
  }
  return null
}

function parseMemoryMib(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)([gGmM])?$/.exec(value.trim())
  if (match === null) return null
  const number = Number(match[1])
  if (!Number.isFinite(number) || number < 0) return null
  const unit = match[2]
  if (unit === undefined || unit === 'M' || unit === 'm') return Math.floor(number)
  return Math.floor(number * 1024)
}

export function resolveSandboxRuntimeTmpfsSizeMib(memoryMib: unknown): number | null {
  if (typeof memoryMib !== 'number' || !Number.isFinite(memoryMib) || memoryMib <= 0) return null
  return Math.min(512, Math.max(1, Math.floor(memoryMib / 4)))
}

function parseSandboxCreateArgs(args: string[]): {
  name: string
  labels: Record<string, string>
  memory: string
  cpus: number
  user: string
  mountDirs: string[]
  workdir: string
  entrypoint: string[]
  image: string
  cmd: string[]
} {
  const labels: Record<string, string> = {}
  const mountDirs: string[] = []
  let name = ''
  let memory = ''
  let cpus = 0
  let user = ''
  let workdir = ''
  let entrypoint: string[] = []
  let image = ''
  let cmd: string[] = []
  for (let i = 1; i < args.length; i++) {
    const token = args[i]!
    if (token === '--') {
      cmd = args.slice(i + 1)
      break
    }
    const value = args[i + 1]
    switch (token) {
      case '--name': name = value ?? ''; i += 1; break
      case '--label': {
        if (value !== undefined) {
          const separator = value.indexOf('=')
          if (separator >= 0) labels[value.slice(0, separator)] = value.slice(separator + 1)
        }
        i += 1
        break
      }
      case '-m': memory = value ?? ''; i += 1; break
      case '-c': cpus = Number(value); i += 1; break
      case '--net': i += 1; break
      case '-u': user = value ?? ''; i += 1; break
      case '--mount-dir': if (value !== undefined) mountDirs.push(value); i += 1; break
      case '-w': workdir = value ?? ''; i += 1; break
      case '--entrypoint': if (value !== undefined) entrypoint = [value]; i += 1; break
      case '-d': break
      default:
        if (image === '' && !token.startsWith('-')) image = token
    }
  }
  return { name, labels, memory, cpus, user, mountDirs, workdir, entrypoint, image, cmd }
}

export function buildCanonicalSandboxSpec(): Record<string, unknown> {
  const args = parseSandboxCreateArgs(buildSandboxCreateArgs())
  const memoryMib = parseMemoryMib(args.memory)
  const bindMounts = args.mountDirs.map((spec) => {
    const separator = spec.indexOf(':')
    const host = separator >= 0 ? spec.slice(0, separator) : spec
    const guest = separator >= 0 ? spec.slice(separator + 1) : spec
    return {
      type: 'Bind',
      host,
      guest,
      options: { readonly: false, noexec: false, nosuid: false, nodev: false },
      stat_virtualization: 'strict',
      host_permissions: 'private',
      follow_root_symlinks: false,
      quota_mib: null,
    }
  })
  return {
    name: args.name,
    image: {
      Oci: {
        reference: args.image,
      },
    },
    resources: {
      cpus: args.cpus,
      memory_mib: memoryMib,
      max_cpus: args.cpus,
      max_memory_mib: memoryMib,
    },
    runtime: {
      workdir: args.workdir,
      shell: null,
      scripts: {},
      entrypoint: args.entrypoint,
      cmd: args.cmd,
      hostname: null,
      user: args.user,
      log_level: null,
      metrics_sample_interval_ms: MSB_METRICS_SAMPLE_INTERVAL_MS,
      disable_metrics_sample: false,
    },
    env: [],
    labels: args.labels,
    rlimits: [],
    mounts: bindMounts,
    patches: [],
    network: { enabled: true, ports: [] },
    init: null,
    pull_policy: 'IfMissing',
    security_profile: 'default',
    lifecycle: { ephemeral: false, max_duration_secs: null, idle_timeout_secs: null },
  }
}

export async function resolveSandboxWorkDirectory(directory: string): Promise<string | null> {
  let resolvedDirectory: string
  try {
    resolvedDirectory = await realpath(directory)
  } catch {
    return null
  }

  for (const root of sandboxMountRoots()) {
    let resolvedRoot: string
    try {
      resolvedRoot = await realpath(root)
    } catch {
      continue
    }
    const relative = path.relative(resolvedRoot, resolvedDirectory)
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return path.join(root, relative)
    }
  }

  return null
}

export function resolveSandboxExecUser(): string {
  const configured = ENV.SANDBOX.EXEC_USER.trim()
  if (/^\d+$/.test(configured)) {
    return typeof process.getgid === 'function' ? `${configured}:${process.getgid()}` : configured
  }
  if (/^\d+:\d+$/.test(configured)) {
    return configured
  }
  if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
    return `${process.getuid()}:${process.getgid()}`
  }
  return configured
}

export function resolveSandboxExecUserUid(): number | null {
  const uid = resolveSandboxExecUser().split(':')[0]
  if (uid === undefined || !/^\d+$/.test(uid)) return null
  return Number(uid)
}


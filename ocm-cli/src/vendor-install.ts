import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser/lib/esm/main.js'
import { removeQuietly } from './json-store.js'

export const OCM_PLUGIN_NAME = 'ocm-cli'
export const OCM_PLUGIN_SPEC = './plugin/ocm-cli/dist'

const CLI_CONFIG_SCHEMA = 'https://opencode.ai/v2/cli.json'
const COPIED_ENTRIES = ['dist', 'package.json', 'README.md', 'LICENSE'] as const

export class InstallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallError'
  }
}

export interface VendorPaths {
  pluginDir: string
  pluginDistDir: string
  cliConfigFile: string
  binDir: string
  binLink: string
}

export interface InstallOptions {
  sourceDistDir: string
  configDir: string
  home?: string
  force?: boolean
  link?: boolean
}

export interface InstallResult {
  pluginDir: string
  copied: string[]
  configFile: string
  configChanged: boolean
  binLink: string | null
  binLinkChanged: boolean
  pathMissing: boolean
}

export function resolveOpenCodeConfigDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.OPENCODE_CONFIG_DIR?.trim()
  if (override) return override
  const base = env.XDG_CONFIG_HOME?.trim() || join(home, '.config')
  return join(base, 'opencode')
}

export function resolveVendorPaths(configDir: string, home = homedir()): VendorPaths {
  const pluginDir = join(configDir, 'plugin', OCM_PLUGIN_NAME)
  const binDir = join(home, '.local', 'bin')
  return {
    pluginDir,
    pluginDistDir: join(pluginDir, 'dist'),
    cliConfigFile: join(configDir, 'cli.json'),
    binDir,
    binLink: join(binDir, 'ocm'),
  }
}

function realPath(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch {
    return resolve(filePath)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pluginEntrySpec(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0]
  return undefined
}

export function addPluginToCliConfig(text: string | null, spec = OCM_PLUGIN_SPEC): { text: string; changed: boolean } {
  if (!text || text.trim() === '') {
    return { text: `${JSON.stringify({ $schema: CLI_CONFIG_SCHEMA, plugins: [spec] }, null, 2)}\n`, changed: true }
  }

  const errors: ParseError[] = []
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0 || !isRecord(parsed)) {
    throw new InstallError('cli.json is not valid JSONC; add the plugin entry manually')
  }

  const plugins = parsed.plugins
  if (plugins !== undefined && !Array.isArray(plugins)) {
    throw new InstallError('cli.json "plugins" is not an array; add the plugin entry manually')
  }
  if (Array.isArray(plugins) && plugins.some((entry) => pluginEntrySpec(entry) === spec)) {
    return { text, changed: false }
  }

  const index = Array.isArray(plugins) ? plugins.length : 0
  const edits = modify(text, ['plugins', index], spec, { formattingOptions: { tabSize: 2, insertSpaces: true } })
  return { text: applyEdits(text, edits), changed: true }
}

function copyEntry(from: string, to: string): boolean {
  if (!existsSync(from)) return false
  if (realPath(from) === realPath(to)) return false
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
  return true
}

function writeTextAtomic(filePath: string, text: string): void {
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  let mode: number | undefined
  try {
    mode = statSync(filePath).mode
  } catch {
    mode = undefined
  }
  try {
    writeFileSync(tmp, text, { encoding: 'utf-8', ...(mode === undefined ? {} : { mode }) })
    renameSync(tmp, filePath)
  } catch (err) {
    removeQuietly(tmp)
    throw err
  }
}

function linkBinary(paths: VendorPaths, force: boolean): { changed: boolean; pathMissing: boolean } {
  const target = join(paths.pluginDistDir, 'ocm.js')
  if (!existsSync(target)) {
    throw new InstallError(`vendored ocm.js missing at ${target}; re-run the install`)
  }
  chmodSync(target, 0o755)
  mkdirSync(paths.binDir, { recursive: true })

  let changed = false
  let existing: ReturnType<typeof lstatSync> | undefined
  try {
    existing = lstatSync(paths.binLink)
  } catch {
    existing = undefined
  }

  if (existing?.isSymbolicLink()) {
    if (realPath(paths.binLink) !== realPath(target)) {
      unlinkSync(paths.binLink)
      symlinkSync(target, paths.binLink)
      changed = true
    }
  } else if (existing) {
    if (!force) {
      throw new InstallError(`${paths.binLink} exists and is not a symlink; re-run with --force to replace it`)
    }
    rmSync(paths.binLink, { force: true })
    symlinkSync(target, paths.binLink)
    changed = true
  } else {
    symlinkSync(target, paths.binLink)
    changed = true
  }

  const path = process.env.PATH ?? ''
  return { changed, pathMissing: !path.split(':').includes(paths.binDir) }
}

export function installVendoredOcm(options: InstallOptions): InstallResult {
  const home = options.home ?? homedir()
  const force = options.force === true
  const link = options.link !== false
  const paths = resolveVendorPaths(options.configDir, home)
  const sourceDistDir = resolve(options.sourceDistDir)

  if (!existsSync(join(sourceDistDir, 'ocm.js')) || !existsSync(join(sourceDistDir, 'tui.js'))) {
    throw new InstallError(`package build not found at ${sourceDistDir}; build or unpack the package first`)
  }

  const sourceRoot = dirname(sourceDistDir)
  const copied: string[] = []
  for (const entry of COPIED_ENTRIES) {
    const from = entry === 'dist' ? sourceDistDir : join(sourceRoot, entry)
    if (copyEntry(from, join(paths.pluginDir, entry))) copied.push(entry)
  }

  const cliConfigFile = paths.cliConfigFile
  let current: string | null = null
  if (existsSync(cliConfigFile)) {
    current = readFileSync(cliConfigFile, 'utf-8')
  }
  const patched = addPluginToCliConfig(current)
  if (patched.changed) writeTextAtomic(cliConfigFile, patched.text)

  const bin = link ? linkBinary(paths, force) : { changed: false, pathMissing: false }

  return {
    pluginDir: paths.pluginDir,
    copied,
    configFile: cliConfigFile,
    configChanged: patched.changed,
    binLink: link ? paths.binLink : null,
    binLinkChanged: bin.changed,
    pathMissing: bin.pathMissing,
  }
}

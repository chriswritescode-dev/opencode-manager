#!/usr/bin/env node
import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, readlinkSync, chmodSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'dist', 'ocm.js')

if (!existsSync(target)) {
  // dist not built yet — silently skip
  process.exit(0)
}

try {
  chmodSync(target, 0o755)
} catch {
  // best effort
}

// If installed via `npm i -g` / `bun add -g`, the binary is already linked
// by the package manager via the `bin` field. Only do the ~/.local/bin
// symlink for local workspace installs.
if (process.env.npm_config_global === 'true' || process.env.npm_config_global === true) {
  process.exit(0)
}

const binDir = join(homedir(), '.local', 'bin')
const link = join(binDir, 'ocm')
const noticeDir = join(homedir(), '.config', 'opencode-manager')
const noticeFile = join(noticeDir, 'install-notice.json')

function writeInstallNotice(pathMissing) {
  try {
    mkdirSync(noticeDir, { recursive: true })
    writeFileSync(noticeFile, JSON.stringify({ link, binDir, pathMissing }, null, 2), { mode: 0o600 })
  } catch {
  }
}

try {
  mkdirSync(binDir, { recursive: true })
} catch {
  process.exit(0)
}

try {
  const stat = lstatSync(link)
  if (stat.isSymbolicLink()) {
    if (readlinkSync(link) === target) {
      process.exit(0)
    }
    unlinkSync(link)
  } else {
    process.exit(0)
  }
} catch {
  // missing — fine
}

try {
  symlinkSync(target, link)
} catch {
  process.exit(0)
}

const path = process.env.PATH ?? ''
writeInstallNotice(!path.split(':').includes(binDir))

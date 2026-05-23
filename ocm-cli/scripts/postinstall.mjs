#!/usr/bin/env node
import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, readlinkSync, chmodSync } from 'node:fs'
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

try {
  mkdirSync(binDir, { recursive: true })
} catch (err) {
  process.stderr.write(`ocm-cli: cannot create ${binDir}: ${err.message}\n`)
  process.exit(0)
}

const link = join(binDir, 'ocm')

try {
  const stat = lstatSync(link)
  if (stat.isSymbolicLink()) {
    if (readlinkSync(link) === target) {
      process.exit(0)
    }
    unlinkSync(link)
  } else {
    process.stderr.write(`ocm-cli: ${link} exists and is not a symlink; leaving alone\n`)
    process.exit(0)
  }
} catch {
  // missing — fine
}

try {
  symlinkSync(target, link)
} catch (err) {
  process.stderr.write(`ocm-cli: failed to symlink ${link}: ${err.message}\n`)
  process.exit(0)
}

process.stdout.write(`ocm installed at ${link}\n`)

const path = process.env.PATH ?? ''
if (!path.split(':').includes(binDir)) {
  process.stdout.write(`note: ${binDir} is not on your PATH. Add to your shell rc:\n`)
  process.stdout.write(`  export PATH="${binDir}:$PATH"\n`)
}

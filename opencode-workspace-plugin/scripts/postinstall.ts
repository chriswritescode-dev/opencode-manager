#!/usr/bin/env bun
import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, readlinkSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

const root = resolve(import.meta.dir, '..')
const target = join(root, 'dist', 'ocm')

if (!existsSync(target)) {
  // dist not built yet (e.g. fresh clone before `pnpm build`) — silently skip
  process.exit(0)
}

const binDir = join(homedir(), '.local', 'bin')
mkdirSync(binDir, { recursive: true })

const link = join(binDir, 'ocm')

try {
  const stat = lstatSync(link)
  if (stat.isSymbolicLink()) {
    if (readlinkSync(link) === target) {
      process.exit(0)
    }
    unlinkSync(link)
  } else {
    // a real file we shouldn't clobber
    process.stderr.write(`postinstall: ${link} exists and is not a symlink; not replacing.\n`)
    process.exit(0)
  }
} catch {
  // missing — fine
}

symlinkSync(target, link)
process.stdout.write(`ocm installed at ${link}\n`)

const path = process.env.PATH ?? ''
if (!path.split(':').includes(binDir)) {
  process.stdout.write(`note: ${binDir} is not on your PATH. Add to your shell rc:\n`)
  process.stdout.write(`  export PATH="${binDir}:$PATH"\n`)
}

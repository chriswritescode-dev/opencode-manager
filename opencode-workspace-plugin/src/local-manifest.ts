import { spawnSync } from 'child_process'
import { readlinkSync, statSync } from 'fs'
import { join } from 'path'
import type { PushManifestEntry } from './manager-api.js'

interface PorcelainEntry {
  path: string
  status: 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | 'typechange' | 'unmerged'
  mode?: string
  oldPath?: string
}

function parsePorcelainV2(raw: string): PorcelainEntry[] {
  const out: PorcelainEntry[] = []
  const tokens = raw.split('\0')
  let i = 0
  while (i < tokens.length) {
    const line = tokens[i] ?? ''
    if (!line) {
      i += 1
      continue
    }
    const kind = line[0]
    if (kind === '1') {
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const modeWorktree = parts[4] ?? '000000'
      const path = parts.slice(8).join(' ')
      const wt = xy[1]
      if (wt === 'D') out.push({ status: 'deleted', path })
      else if (wt === 'A') out.push({ status: 'added', path, mode: modeWorktree })
      else if (wt === 'M' || wt === 'm' || wt === '.') out.push({ status: 'modified', path, mode: modeWorktree })
      else if (wt === 'T') out.push({ status: 'typechange', path })
      else if (wt === 'U' || xy.includes('U')) out.push({ status: 'unmerged', path })
      i += 1
    } else if (kind === '2') {
      const parts = line.split(' ')
      const modeWorktree = parts[4] ?? '000000'
      const path = parts.slice(9).join(' ')
      const oldPath = tokens[i + 1] ?? ''
      out.push({ status: 'renamed', path, oldPath, mode: modeWorktree })
      i += 2
    } else if (kind === '?') {
      out.push({ status: 'untracked', path: line.slice(2), mode: '100644' })
      i += 1
    } else if (kind === 'u') {
      const parts = line.split(' ')
      out.push({ status: 'unmerged', path: parts.slice(10).join(' ') })
      i += 1
    } else {
      i += 1
    }
  }
  return out
}

export interface BuildLocalManifestResult {
  entries: PushManifestEntry[]
  skipped: PorcelainEntry[]
}

export function buildLocalManifest(repoRoot: string, opts: { includeDeletions?: boolean } = {}): BuildLocalManifestResult {
  const includeDeletions = opts.includeDeletions ?? true
  const res = spawnSync('git', ['-C', repoRoot, 'status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=no'], {
    encoding: 'utf-8',
  })
  if (res.status !== 0) {
    throw new Error(`git status failed: ${res.stderr}`)
  }
  const parsed = parsePorcelainV2(res.stdout ?? '')

  const entries: PushManifestEntry[] = []
  const skipped: PorcelainEntry[] = []
  for (const p of parsed) {
    if (p.status === 'unmerged' || p.status === 'typechange') {
      skipped.push(p)
      continue
    }
    if (p.status === 'deleted' && !includeDeletions) {
      skipped.push(p)
      continue
    }

    const entry: PushManifestEntry = {
      path: p.path,
      status: p.status,
      mode: p.mode,
      oldPath: p.oldPath,
    }

    if (p.status !== 'deleted') {
      const full = join(repoRoot, p.path)
      try {
        const st = statSync(full)
        if (st.isSymbolicLink()) {
          entry.symlinkTarget = readlinkSync(full)
        } else if (st.isFile()) {
          entry.size = st.size
        }
      } catch {
        skipped.push(p)
        continue
      }
    }
    entries.push(entry)
  }
  return { entries, skipped }
}

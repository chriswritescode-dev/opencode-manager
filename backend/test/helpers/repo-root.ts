import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'

export function findRepoRoot(start: string): string {
  let dir = start
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error('repo root not found')
    dir = parent
  }
  return dir
}

export const repoRoot = findRepoRoot(resolve(process.cwd()))

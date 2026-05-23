import { resolve, normalize, isAbsolute, sep } from 'path'
import { executeCommand } from '../../utils/process'

export async function gitOut(repoPath: string, args: string[]): Promise<string> {
  return executeCommand(['git', '-C', repoPath, ...args], { silent: true })
}

export async function safeGitOut(repoPath: string, args: string[]): Promise<string | null> {
  try {
    return await gitOut(repoPath, args)
  } catch {
    return null
  }
}

export function isSafeRelativePath(repoPath: string, relPath: string): string | null {
  if (!relPath || relPath.startsWith('/') || relPath.includes('\0')) return null
  const normalized = normalize(relPath)
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`) || normalized === '..') return null
  if (isAbsolute(normalized)) return null
  const full = resolve(repoPath, normalized)
  const root = resolve(repoPath) + sep
  if (full !== resolve(repoPath) && !full.startsWith(root)) return null
  return full
}

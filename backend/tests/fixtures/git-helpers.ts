import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { executeCommand } from '../../src/utils/process'

export function gitReuseDir(name: string): string {
  const base = process.env.TMPDIR || '/tmp'
  return join(base, `opencode-test-${name}`)
}

export async function setupGitTestRepo(repoPath: string): Promise<void> {
  try {
    await rm(repoPath, { recursive: true, force: true })
  } catch {
    // Ignore if dir doesn't exist
  }
  
  await mkdir(repoPath, { recursive: true })
  await executeCommand(['git', 'init'], { cwd: repoPath })
  await executeCommand(['git', 'config', 'user.name', 'Test User'], { cwd: repoPath })
  await executeCommand(['git', 'config', 'user.email', 'test@example.com'], { cwd: repoPath })
  await executeCommand(['git', 'config', 'commit.gpgSign', 'false'], { cwd: repoPath })
}

export async function cleanupTestRepo(repoPath: string): Promise<void> {
  try {
    await rm(repoPath, { recursive: true, force: true })
  } catch {
    // Ignore
  }
}

export async function createTestFile(repoPath: string, fileName: string, content: string): Promise<void> {
  const filePath = join(repoPath, fileName)
  const dir = join(repoPath, fileName.split('/').slice(0, -1).join('/'))
  
  if (dir !== repoPath) {
    await mkdir(dir, { recursive: true })
  }
  
  await writeFile(filePath, content, 'utf-8')
}

export async function stageAndCommitTestFile(repoPath: string, fileName: string): Promise<void> {
  await executeCommand(['git', 'add', fileName], { cwd: repoPath })
  await executeCommand(['git', 'commit', '-m', `Add ${fileName}`], { cwd: repoPath })
}

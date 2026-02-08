import { spawn, type ChildProcess } from 'child_process'
import { logger } from './logger'

interface ExecuteCommandOptions {
  cwd?: string
  silent?: boolean
  env?: Record<string, string>
  ignoreExitCode?: boolean
  timeout?: number
}

export async function executeCommand(
  args: string[],
  cwdOrOptions?: string | ExecuteCommandOptions
): Promise<string>
export async function executeCommand(
  args: string[],
  cwdOrOptions: string | (ExecuteCommandOptions & { ignoreExitCode: true })
): Promise<string | { exitCode: number; stdout: string; stderr: string }>
export async function executeCommand(
  args: string[],
  cwdOrOptions?: string | ExecuteCommandOptions
): Promise<string | { exitCode: number; stdout: string; stderr: string }> {
  const options: ExecuteCommandOptions = typeof cwdOrOptions === 'string' 
    ? { cwd: cwdOrOptions } 
    : cwdOrOptions || {}
  
  return new Promise((resolve, reject) => {
    const [command, ...cmdArgs] = args
    
    const effectiveEnv = { ...process.env, ...options.env }
    
    // Log key git-related environment variables
    if (command === 'git') {
      logger.info(`executeCommand: ${args.join(' ')}`)
      logger.info(`  GIT_ASKPASS: ${effectiveEnv.GIT_ASKPASS || '(not set)'}`)
      logger.info(`  VSCODE_GIT_IPC_HANDLE: ${effectiveEnv.VSCODE_GIT_IPC_HANDLE || '(not set)'}`)
      logger.info(`  GIT_TERMINAL_PROMPT: ${effectiveEnv.GIT_TERMINAL_PROMPT || '(not set)'}`)
      logger.info(`  GIT_SSH_COMMAND: ${effectiveEnv.GIT_SSH_COMMAND || '(not set)'}`)
      logger.info(`  VSCODE_GIT_SSH_HOST_KEY: ${effectiveEnv.VSCODE_GIT_SSH_HOST_KEY || '(not set)'}`)
    }
    
    const proc: ChildProcess = spawn(command || '', cmdArgs, {
      cwd: options.cwd,
      shell: false,
      env: effectiveEnv
    })

    let stdout = ''
    let stderr = ''
    let isResolved = false

    const timeoutId = options.timeout ? setTimeout(() => {
      if (!isResolved) {
        isResolved = true
        proc.kill('SIGKILL')
        reject(new Error(`Command timed out after ${options.timeout}ms: ${args.join(' ')}`))
      }
    }, options.timeout) : undefined

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('error', (error: Error) => {
      if (!isResolved) {
        isResolved = true
        if (timeoutId) clearTimeout(timeoutId)
        if (!options.silent) {
          logger.error(`Command failed: ${args.join(' ')}`, error)
        }
        reject(error)
      }
    })

    proc.on('close', (code: number | null) => {
      if (isResolved) return
      
      isResolved = true
      if (timeoutId) clearTimeout(timeoutId)
      
      if (options.ignoreExitCode) {
        resolve({ exitCode: code || 0, stdout, stderr })
      } else if (code === 0) {
        resolve(stdout)
      } else {
        const error = new Error(`Command failed with code ${code}: ${stderr || stdout}`)
        if (!options.silent) {
          logger.error(`Command failed: ${args.join(' ')}`, error)
        }
        reject(error)
      }
    })
  })
}

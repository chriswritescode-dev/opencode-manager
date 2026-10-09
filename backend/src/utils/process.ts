import { spawn, type ChildProcess } from 'child_process'
import { logger } from './logger'

interface ExecuteCommandOptions {
  cwd?: string
  silent?: boolean
  env?: Record<string, string>
  ignoreExitCode?: boolean
  timeout?: number
  maxOutputChars?: number
}

export interface ExecuteCommandResult {
  exitCode: number
  stdout: string
  stderr: string
  truncated?: boolean
}

type ExecuteCommandReturn<O> = O extends { ignoreExitCode: true } ? ExecuteCommandResult : string

export async function executeCommand<O extends ExecuteCommandOptions = ExecuteCommandOptions>(
  args: string[],
  cwdOrOptions?: string | O
): Promise<ExecuteCommandReturn<O>> {
  const options: ExecuteCommandOptions = typeof cwdOrOptions === 'string' 
    ? { cwd: cwdOrOptions } 
    : cwdOrOptions || {}
  
  return new Promise<string | ExecuteCommandResult>((resolve, reject) => {
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
      env: effectiveEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let isResolved = false
    let outputCapped = false

    const timeoutId = options.timeout ? setTimeout(() => {
      if (!isResolved) {
        isResolved = true
        proc.kill('SIGKILL')
        reject(new Error(`Command timed out after ${options.timeout}ms: ${args.join(' ')}`))
      }
    }, options.timeout) : undefined

    proc.stdout?.on('data', (data: Buffer) => {
      if (outputCapped) return

      stdout += data.toString()
      if (options.maxOutputChars !== undefined && stdout.length > options.maxOutputChars) {
        outputCapped = true
        stdout = stdout.slice(0, options.maxOutputChars)
        proc.kill('SIGKILL')
      }
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

    proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (isResolved) return
      
      isResolved = true
      if (timeoutId) clearTimeout(timeoutId)

      const terminatedBySignal = code === null && signal !== null
      const exitCode = code === null ? 1 : code
      const failureDetail = terminatedBySignal ? `signal ${signal}` : `code ${code}`

      if (outputCapped) {
        resolve(options.ignoreExitCode
          ? {
            exitCode,
            stdout,
            stderr: terminatedBySignal ? `${stderr}Command terminated by signal ${signal}` : stderr,
            truncated: true,
          }
          : stdout)
      } else if (options.ignoreExitCode) {
        resolve({
          exitCode,
          stdout,
          stderr: terminatedBySignal ? `${stderr}Command terminated by signal ${signal}` : stderr,
        })
      } else if (code === 0) {
        resolve(stdout)
      } else {
        const error = new Error(`Command failed with ${failureDetail}: ${stderr || stdout}`)
        if (!options.silent) {
          logger.error(`Command failed: ${args.join(' ')}`, error)
        }
        reject(error)
      }
    })
  }) as Promise<ExecuteCommandReturn<O>>
}

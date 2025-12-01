import { spawn, type ChildProcess } from 'child_process'
import { logger } from './logger'

interface ExecuteCommandOptions {
  cwd?: string
  silent?: boolean
  env?: Record<string, string>
}

export async function executeCommand(
  args: string[],
  cwdOrOptions?: string | ExecuteCommandOptions
): Promise<string> {
  const options: ExecuteCommandOptions = typeof cwdOrOptions === 'string' 
    ? { cwd: cwdOrOptions } 
    : cwdOrOptions || {}
  
  return new Promise((resolve, reject) => {
    const [command, ...cmdArgs] = args
    
    const proc: ChildProcess = spawn(command || '', cmdArgs, {
      cwd: options.cwd,
      shell: false,
      env: { ...process.env, ...options.env }
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('error', (error: Error) => {
      if (!options.silent) {
        logger.error(`Command failed: ${args.join(' ')}`, error)
      }
      reject(error)
    })

    proc.on('close', (code: number | null) => {
      if (code === 0) {
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

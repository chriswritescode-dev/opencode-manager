import { spawn } from 'child_process'

export class GitCommandUtils {
  static async executeCommandWithStderr(
    args: string[],
    options: { env?: Record<string, string>; silent?: boolean } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const [command, ...cmdArgs] = args

      const proc = spawn(command || '', cmdArgs, {
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
        reject(error)
      })

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`))
        }
      })
    })
  }

  static isAuthenticationError(message: string): boolean {
    const lowerMessage = message.toLowerCase()
    return lowerMessage.includes('authentication failed') ||
           lowerMessage.includes('invalid username or password') ||
           lowerMessage.includes('invalid credentials') ||
           lowerMessage.includes('could not read username') ||
           lowerMessage.includes('permission denied') ||
           lowerMessage.includes('fatal: authentication') ||
           lowerMessage.includes('remote: permission denied')
  }

  static isConflictError(message: string): boolean {
    const lowerMessage = message.toLowerCase()
    return lowerMessage.includes('conflict') ||
           lowerMessage.includes('automatic merge failed') ||
           lowerMessage.includes('fix conflicts') ||
           lowerMessage.includes('merge conflict') ||
           lowerMessage.includes('unmerged files')
  }
}
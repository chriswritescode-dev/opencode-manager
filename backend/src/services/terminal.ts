import { spawn, type Subprocess } from 'bun'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { logger } from '../utils/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface TerminalSession {
  id: string
  process: Subprocess
  cwd: string
  createdAt: Date
  onData: ((data: string) => void) | null
  onExit: ((exitCode: number, signal?: number) => void) | null
  pendingData: string[]
}

class TerminalService {
  private sessions: Map<string, TerminalSession> = new Map()
  private ptyWorkerPath: string

  constructor() {
    // Try to find pty-worker.cjs relative to this file first (works for source and some bundles)
    const localWorkerPath = path.join(__dirname, 'pty-worker.cjs')
    
    // Try to find it relative to the entry point (works for flat bundles)
    const bundleWorkerPath = path.join(path.dirname(process.argv[1]), 'pty-worker.cjs')

    if (fs.existsSync(localWorkerPath)) {
      this.ptyWorkerPath = localWorkerPath
    } else if (fs.existsSync(bundleWorkerPath)) {
      this.ptyWorkerPath = bundleWorkerPath
    } else {
      // Default to local path and let it fail with a clear error later if not found
      this.ptyWorkerPath = localWorkerPath
      logger.warn(`Could not find pty-worker.cjs. Checked: \n - ${localWorkerPath}\n - ${bundleWorkerPath}`)
    }
  }

  createSession(id: string, cwd?: string): TerminalSession {
    const existingSession = this.sessions.get(id)
    if (existingSession) {
      logger.info(`Reusing existing terminal session: ${id}`)
      return existingSession
    }

    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
    const workingDir = cwd || process.env.HOME || os.homedir()

    logger.info(`Starting PTY worker: node ${this.ptyWorkerPath}`)
    
    // Ensure the worker path exists
    if (!fs.existsSync(this.ptyWorkerPath)) {
        logger.error(`PTY worker file not found at: ${this.ptyWorkerPath}`)
    }

    const proc = spawn(['node', this.ptyWorkerPath], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PTY_SHELL: shell,
        PTY_CWD: workingDir,
        PTY_COLS: '80',
        PTY_ROWS: '24',
        PATH: process.env.PATH, // Explicitly pass PATH to child
      },
    })

    const session: TerminalSession = {
      id,
      process: proc,
      cwd: workingDir,
      createdAt: new Date(),
      onData: null,
      onExit: null,
      pendingData: [],
    }

    this.sessions.set(id, session)
    logger.info(`Created terminal session: ${id} in ${workingDir}, PID: ${proc.pid}`)

    this.startReadingOutput(session)
    this.startReadingStderr(session)

    return session
  }

  private async startReadingOutput(session: TerminalSession) {
    const reader = session.process.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    logger.info(`Starting to read output for session ${session.id}`)

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          logger.info(`Output stream ended for session ${session.id}`)
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk
        
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.type === 'data') {
              if (session.onData) {
                session.onData(msg.data)
              } else {
                session.pendingData.push(msg.data)
              }
            } else if (msg.type === 'exit') {
              if (session.onExit) {
                session.onExit(msg.exitCode, msg.signal)
              }
            } else if (msg.type === 'error') {
              logger.error(`PTY error for ${session.id}:`, msg.error)
            } else if (msg.type === 'started') {
              logger.info(`PTY worker started for ${session.id}, child PID: ${msg.pid}`)
            }
          } catch (e) {
            logger.warn(`Failed to parse PTY message for ${session.id}: ${line.substring(0, 100)}`)
          }
        }
      }
    } catch (error) {
      logger.error(`Error reading PTY output for ${session.id}:`, error)
    }
  }

  private async startReadingStderr(session: TerminalSession) {
    const reader = session.process.stderr.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        if (text.trim()) {
          logger.error(`PTY worker stderr for ${session.id}: ${text}`)
        }
      }
    } catch (error) {
      logger.error(`Error reading PTY stderr for ${session.id}:`, error)
    }
  }

  setOnData(id: string, callback: (data: string) => void): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.onData = callback
    
    for (const data of session.pendingData) {
      callback(data)
    }
    session.pendingData = []
    
    return true
  }

  setOnExit(id: string, callback: (exitCode: number, signal?: number) => void): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.onExit = callback
    return true
  }

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id)
  }

  resizeSession(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    try {
      session.process.stdin.write(JSON.stringify({ type: 'resize', cols, rows }) + '\n')
      // @ts-ignore
      if (typeof session.process.stdin.flush === 'function') {
        // @ts-ignore
        session.process.stdin.flush()
      }
      return true
    } catch (error) {
      logger.error(`Failed to resize terminal ${id}:`, error)
      return false
    }
  }

  writeToSession(id: string, data: string): boolean {
    const session = this.sessions.get(id)
    if (!session) {
      logger.warn(`writeToSession: session ${id} not found`)
      return false
    }

    try {
      const msg = JSON.stringify({ type: 'input', data }) + '\n'
      session.process.stdin.write(msg)
      // @ts-ignore
      if (typeof session.process.stdin.flush === 'function') {
        // @ts-ignore
        session.process.stdin.flush()
      }
      return true
    } catch (error) {
      logger.error(`Failed to write to terminal ${id}:`, error)
      return false
    }
  }

  destroySession(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    try {
      session.process.stdin.write(JSON.stringify({ type: 'kill' }) + '\n')
      session.process.kill()
      this.sessions.delete(id)
      logger.info(`Destroyed terminal session: ${id}`)
      return true
    } catch (error) {
      logger.error(`Failed to destroy terminal ${id}:`, error)
      return false
    }
  }

  listSessions(): Array<{ id: string; cwd: string; createdAt: Date }> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      cwd: session.cwd,
      createdAt: session.createdAt,
    }))
  }

  destroyAllSessions(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id)
    }
    logger.info('Destroyed all terminal sessions')
  }
}

export const terminalService = new TerminalService()

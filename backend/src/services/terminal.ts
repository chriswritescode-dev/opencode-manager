import * as pty from 'node-pty'
import os from 'os'
import { logger } from '../utils/logger'

interface TerminalSession {
  id: string
  pty: pty.IPty
  cwd: string
  createdAt: Date
}

class TerminalService {
  private sessions: Map<string, TerminalSession> = new Map()

  createSession(id: string, cwd?: string): TerminalSession {
    const existingSession = this.sessions.get(id)
    if (existingSession) {
      logger.info(`Reusing existing terminal session: ${id}`)
      return existingSession
    }

    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
    const workingDir = cwd || process.env.HOME || os.homedir()

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })

    const session: TerminalSession = {
      id,
      pty: ptyProcess,
      cwd: workingDir,
      createdAt: new Date(),
    }

    this.sessions.set(id, session)
    logger.info(`Created terminal session: ${id} in ${workingDir}`)

    return session
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
      session.pty.resize(cols, rows)
      return true
    } catch (error) {
      logger.error(`Failed to resize terminal ${id}:`, error)
      return false
    }
  }

  writeToSession(id: string, data: string): boolean {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    try {
      session.pty.write(data)
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
      session.pty.kill()
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

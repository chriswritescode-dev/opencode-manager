import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { terminalService } from '../../src/services/terminal'

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 12345
  }))
}))

describe('Terminal Service', () => {
  const sessionId = 'test-session-id'

  afterEach(() => {
    terminalService.destroyAllSessions()
    vi.clearAllMocks()
  })

  it('should create a new session', () => {
    const session = terminalService.createSession(sessionId)
    expect(session).toBeDefined()
    expect(session.id).toBe(sessionId)
    expect(terminalService.getSession(sessionId)).toBeDefined()
  })

  it('should reuse existing session', () => {
    const session1 = terminalService.createSession(sessionId)
    const session2 = terminalService.createSession(sessionId)
    expect(session1).toBe(session2)
  })

  it('should list sessions', () => {
    terminalService.createSession('session-1')
    terminalService.createSession('session-2')
    
    const sessions = terminalService.listSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions.map(s => s.id)).toContain('session-1')
    expect(sessions.map(s => s.id)).toContain('session-2')
  })

  it('should destroy session', () => {
    terminalService.createSession(sessionId)
    const result = terminalService.destroySession(sessionId)
    
    expect(result).toBe(true)
    expect(terminalService.getSession(sessionId)).toBeUndefined()
  })

  it('should handle resizing session', () => {
    const session = terminalService.createSession(sessionId)
    const resizeSpy = vi.spyOn(session.pty, 'resize')
    
    const result = terminalService.resizeSession(sessionId, 100, 40)
    
    expect(result).toBe(true)
    expect(resizeSpy).toHaveBeenCalledWith(100, 40)
  })

  it('should handle writing to session', () => {
    const session = terminalService.createSession(sessionId)
    const writeSpy = vi.spyOn(session.pty, 'write')
    
    const result = terminalService.writeToSession(sessionId, 'ls -la')
    
    expect(result).toBe(true)
    expect(writeSpy).toHaveBeenCalledWith('ls -la')
  })
})

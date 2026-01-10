import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'

const BACKEND_PORT = 5001
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`
const STARTUP_TIMEOUT = 60000

let serverProcess: ChildProcess | null = null

describe('Full Stack Integration Test', () => {
  beforeAll(async () => {
    console.log('Starting opencode-manager with npm start...')
    
    const env = { 
      ...process.env, 
      NODE_ENV: 'test',
      AUTH_USERNAME: '', 
      AUTH_PASSWORD: ''
    }

    serverProcess = spawn('npm', ['start'], {
      cwd: join(import.meta.dir, '../../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    })

    let startupOutput = ''
    
    const startupPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timed out after 60s'))
      }, STARTUP_TIMEOUT)

      const handleOutput = (data: Buffer) => {
        const output = data.toString()
        console.log('[SERVER]', output)
        startupOutput += output
        
        if (output.includes('OpenCode WebUI API running on')) {
          clearTimeout(timeout)
          resolve()
        }
      }

      serverProcess!.stdout?.on('data', handleOutput)
      serverProcess!.stderr?.on('data', handleOutput)
    })

    try {
      await startupPromise
      await new Promise(resolve => setTimeout(resolve, 2000))
      console.log('Server started successfully')
    } catch (error) {
      console.error('Startup output:', startupOutput)
      throw error
    }
  }, STARTUP_TIMEOUT)

  afterAll(() => {
    if (serverProcess) {
      console.log('Stopping server...')
      serverProcess.kill('SIGTERM')
      serverProcess = null
    }
  })

  describe('Backend Health Check', () => {
    it('should respond to health endpoint', async () => {
      const response = await fetch(`${BACKEND_URL}/api/health`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(data).toHaveProperty('status')
      expect(['healthy', 'degraded']).toContain(data.status)
    })

    it('should have OpenCode server running', async () => {
      const response = await fetch(`${BACKEND_URL}/api/health/processes`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(data).toHaveProperty('opencode')
      expect(data.opencode).toHaveProperty('healthy')
    })
  })

  describe('STT Integration', () => {
    it('should return STT status', async () => {
      const response = await fetch(`${BACKEND_URL}/api/stt/status?userId=test-user`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(data).toHaveProperty('server')
      expect(data.server).toHaveProperty('running')
    })

    it('should transcribe audio when Whisper is available', async () => {
      const statusResponse = await fetch(`${BACKEND_URL}/api/stt/status?userId=test-user`)
      const status = await statusResponse.json()
      
      if (!status.server.running) {
        console.log('Whisper server not running, skipping transcription test')
        return
      }

      const testAudio = Buffer.from('test audio data')
      const base64Audio = testAudio.toString('base64')
      
      const response = await fetch(`${BACKEND_URL}/api/stt/transcribe?userId=test-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: base64Audio,
          format: 'wav'
        })
      })

      if (response.status === 500 || response.status === 400) {
        const error = await response.json()
        console.log('Transcription failed (expected with test data):', error.message || error.error)
        expect(error).toHaveProperty('error')
      } else {
        expect(response.ok).toBe(true)
      }
    })
  })

  describe('TTS Integration', () => {
    it('should return TTS status', async () => {
      const response = await fetch(`${BACKEND_URL}/api/tts/status?userId=test-user`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(data).toHaveProperty('chatterbox')
    })

    it('should get available voices', async () => {
      const response = await fetch(`${BACKEND_URL}/api/tts/voices?userId=test-user`)
      
      if (response.ok) {
        const data = await response.json()
        expect(data).toHaveProperty('voices')
      } else {
        const data = await response.json()
        expect(data).toHaveProperty('error')
        expect(['TTS not configured', 'Failed to fetch voices']).toContain(data.error)
      }
    })
  })

  describe('OpenCode Proxy', () => {
    let sessionId: string

    it('should list sessions via proxy', async () => {
      const response = await fetch(`${BACKEND_URL}/api/opencode/session`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(Array.isArray(data)).toBe(true)
    })

    it('should create a new session', async () => {
      const response = await fetch(`${BACKEND_URL}/api/opencode/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test Session'
        })
      })
      
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data).toHaveProperty('id')
      sessionId = data.id
    })

    it('should get session details', async () => {
      if (!sessionId) {
        console.log('No session created, skipping')
        return
      }
      
      const response = await fetch(`${BACKEND_URL}/api/opencode/session/${sessionId}`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(data).toHaveProperty('id', sessionId)
    })

    it('should get config', async () => {
      const response = await fetch(`${BACKEND_URL}/api/opencode/config`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(typeof data).toBe('object')
    })

    it('should delete session', async () => {
      if (!sessionId) {
        console.log('No session created, skipping')
        return
      }
      
      const response = await fetch(`${BACKEND_URL}/api/opencode/session/${sessionId}`, {
        method: 'DELETE'
      })
      
      expect(response.ok).toBe(true)
    })
  })
})

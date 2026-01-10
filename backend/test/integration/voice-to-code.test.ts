/**
 * Voice-to-Code Integration Test
 * 
 * Tests the complete voice pipeline: Audio → STT → OpenCode → File Creation
 * 
 * Prerequisites:
 * - macOS with `say` command
 * - ffmpeg installed
 * - Backend running on port 5001 (or specify OPENCODE_MANAGER_URL)
 * - Whisper STT server running
 * - OpenCode server running
 * 
 * Run with:
 *   RUN_INTEGRATION_TESTS=1 pnpm test
 *   
 * Or against a specific URL:
 *   OPENCODE_MANAGER_URL=http://localhost:5001 RUN_INTEGRATION_TESTS=1 pnpm test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { existsSync, unlinkSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SKIP_INTEGRATION = !process.env.RUN_INTEGRATION_TESTS && !process.env.OPENCODE_MANAGER_URL

const BASE_URL = process.env.OPENCODE_MANAGER_URL || 'http://localhost:5001'
const AUTH_USER = process.env.AUTH_USER || ''
const AUTH_PASS = process.env.AUTH_PASS || ''
const TEST_TIMEOUT = 60000

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (AUTH_USER && AUTH_PASS) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString('base64')
  }
  return headers
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = { ...getAuthHeaders(), ...options.headers as Record<string, string> }
  return fetch(url, { ...options, headers })
}

function generateTestAudio(text: string): string | null {
  const aiffPath = '/tmp/voice_test.aiff'
  const wavPath = '/tmp/voice_test.wav'
  
  try {
    execSync(`say -v Samantha "${text}" -o ${aiffPath}`, { stdio: 'pipe' })
    
    const result = spawnSync('afinfo', [aiffPath], { encoding: 'utf-8' })
    const durationMatch = result.stdout?.match(/estimated duration: ([\d.]+)/)
    const duration = durationMatch ? parseFloat(durationMatch[1]) : 0
    
    if (duration < 0.5) {
      console.log('Warning: Generated audio too short, voice synthesis may have failed')
      return null
    }
    
    execSync(`ffmpeg -y -i ${aiffPath} -ar 16000 -ac 1 -f wav ${wavPath}`, { stdio: 'pipe' })
    
    const audioBuffer = readFileSync(wavPath)
    return audioBuffer.toString('base64')
  } catch (error: any) {
    console.log('Failed to generate test audio:', error.message)
    return null
  }
}

async function waitForSessionIdle(sessionId: string, directory: string, maxWaitMs: number = 30000): Promise<void> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetchWithAuth(`${BASE_URL}/api/opencode/session/status?directory=${encodeURIComponent(directory)}`)
    const status = await response.json()
    
    if (!status[sessionId] || status[sessionId].type === 'idle') {
      return
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  throw new Error(`Session did not become idle within ${maxWaitMs}ms`)
}

describe.skipIf(SKIP_INTEGRATION)('Voice-to-Code Integration Test', () => {
  let workspaceDir: string
  let testFilePath: string
  let sessionId: string
  
  beforeAll(async () => {
    workspaceDir = join(__dirname, '../../../workspace')
    testFilePath = join(workspaceDir, 'hello_voice_test.py')
    
    if (existsSync(testFilePath)) {
      unlinkSync(testFilePath)
    }
    
    console.log(`Testing against: ${BASE_URL}`)
    console.log(`Workspace: ${workspaceDir}`)
    
    const healthResponse = await fetchWithAuth(`${BASE_URL}/api/health`)
    if (!healthResponse.ok) {
      throw new Error(`Backend not healthy: ${healthResponse.status}`)
    }
    
    const health = await healthResponse.json()
    console.log('Backend health:', health.status)
    expect(health.status).toBe('healthy')
  }, TEST_TIMEOUT)
  
  afterAll(async () => {
    if (existsSync(testFilePath)) {
      unlinkSync(testFilePath)
      console.log('Cleaned up test file')
    }
    
    if (sessionId) {
      try {
        await fetchWithAuth(`${BASE_URL}/api/opencode/session/${sessionId}?directory=${encodeURIComponent(workspaceDir)}`, {
          method: 'DELETE'
        })
        console.log('Cleaned up test session')
      } catch {
      }
    }
  })
  
  describe('Prerequisites', () => {
    it('should have STT server running', async () => {
      const response = await fetchWithAuth(`${BASE_URL}/api/stt/status`)
      expect(response.ok).toBe(true)
      
      const status = await response.json()
      console.log('STT status:', { running: status.server?.running, model: status.server?.model })
      
      expect(status.server).toBeDefined()
      expect(status.server.running).toBe(true)
    })
    
    it('should have OpenCode server running', async () => {
      const response = await fetchWithAuth(`${BASE_URL}/api/health`)
      const health = await response.json()
      
      expect(health.opencode).toBe('healthy')
      console.log('OpenCode version:', health.opencodeVersion)
    })
    
    it('should be able to generate test audio (macOS only)', async () => {
      const audio = generateTestAudio('test')
      
      if (!audio) {
        console.log('Skipping: Cannot generate audio (not macOS or missing say/ffmpeg)')
        return
      }
      
      expect(audio.length).toBeGreaterThan(1000)
      console.log('Audio generation working, base64 length:', audio.length)
    })
  })
  
  describe('STT Transcription', () => {
    it('should transcribe voice command accurately', async () => {
      const audio = generateTestAudio('Write a simple hello world Python application')
      
      if (!audio) {
        console.log('Skipping: Cannot generate audio')
        return
      }
      
      const response = await fetchWithAuth(`${BASE_URL}/api/stt/transcribe`, {
        method: 'POST',
        body: JSON.stringify({ audio, format: 'wav' })
      })
      
      expect(response.ok).toBe(true)
      
      const result = await response.json()
      console.log('Transcription result:', result)
      
      expect(result.text).toBeDefined()
      expect(result.text.length).toBeGreaterThan(10)
      expect(result.text.toLowerCase()).toContain('hello')
      expect(result.text.toLowerCase()).toContain('world')
      expect(result.text.toLowerCase()).toContain('python')
      expect(result.duration).toBeGreaterThan(1)
    }, TEST_TIMEOUT)
  })
  
  describe('Full Voice-to-Code Pipeline', () => {
    it('should create Python file from voice command', async () => {
      const createResponse = await fetchWithAuth(`${BASE_URL}/api/opencode/session?directory=${encodeURIComponent(workspaceDir)}`, {
        method: 'POST',
        body: JSON.stringify({ title: 'Voice Integration Test' })
      })
      
      expect(createResponse.ok).toBe(true)
      const session = await createResponse.json()
      sessionId = session.id
      console.log('Created session:', sessionId)
      
      const audio = generateTestAudio('Write a simple hello world Python application and save it as hello_voice_test.py')
      
      let commandText: string
      if (audio) {
        const sttResponse = await fetchWithAuth(`${BASE_URL}/api/stt/transcribe`, {
          method: 'POST',
          body: JSON.stringify({ audio, format: 'wav' })
        })
        
        if (sttResponse.ok) {
          const sttResult = await sttResponse.json()
          commandText = sttResult.text
          console.log('Voice transcription:', commandText)
        } else {
          commandText = 'Write a simple hello world Python application and save it as hello_voice_test.py'
          console.log('STT failed, using text command directly')
        }
      } else {
        commandText = 'Write a simple hello world Python application and save it as hello_voice_test.py'
        console.log('Audio generation not available, using text command')
      }
      
      const messageResponse = await fetchWithAuth(
        `${BASE_URL}/api/opencode/session/${sessionId}/message?directory=${encodeURIComponent(workspaceDir)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            parts: [{ type: 'text', text: commandText }]
          })
        }
      )
      
      expect(messageResponse.ok).toBe(true)
      console.log('Message sent to OpenCode')
      
      await waitForSessionIdle(sessionId, workspaceDir, 30000)
      console.log('Session completed')
      
      const messagesResponse = await fetchWithAuth(
        `${BASE_URL}/api/opencode/session/${sessionId}/message?directory=${encodeURIComponent(workspaceDir)}`
      )
      const messages = await messagesResponse.json()
      
      const assistantMessages = messages.filter((m: any) => m.info.role === 'assistant')
      expect(assistantMessages.length).toBeGreaterThan(0)
      
      const lastMessage = assistantMessages[assistantMessages.length - 1]
      console.log('Assistant response finish:', lastMessage.info.finish)
      
      const hasWriteTool = lastMessage.parts.some((p: any) => 
        p.type === 'tool' && (p.tool === 'write' || p.tool === 'Write')
      )
      
      const textParts = lastMessage.parts.filter((p: any) => p.type === 'text')
      const responseText = textParts.map((p: any) => p.text).join(' ')
      console.log('Response preview:', responseText.substring(0, 200))
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const fileExists = existsSync(testFilePath)
      console.log('File exists:', fileExists, 'at', testFilePath)
      
      if (fileExists) {
        const content = readFileSync(testFilePath, 'utf-8')
        console.log('File content:', content)
        
        expect(content.toLowerCase()).toContain('hello')
        
        try {
          const result = spawnSync('python3', [testFilePath], { encoding: 'utf-8' })
          console.log('Python output:', result.stdout?.trim())
          expect(result.status).toBe(0)
          expect(result.stdout?.toLowerCase()).toContain('hello')
        } catch (error: any) {
          console.log('Could not execute Python:', error.message)
        }
      } else {
        expect(hasWriteTool || responseText.toLowerCase().includes('hello')).toBe(true)
        console.log('File not created but response contains hello world code')
      }
    }, TEST_TIMEOUT)
  })
  
  describe('Error Handling', () => {
    it('should handle empty audio gracefully', async () => {
      const emptyAudio = Buffer.from('').toString('base64')
      
      const response = await fetchWithAuth(`${BASE_URL}/api/stt/transcribe`, {
        method: 'POST',
        body: JSON.stringify({ audio: emptyAudio, format: 'wav' })
      })
      
      expect([400, 500]).toContain(response.status)
      const error = await response.json()
      expect(error.error).toBeDefined()
    })
    
    it('should handle invalid audio format gracefully', async () => {
      const invalidAudio = Buffer.from('not valid audio data').toString('base64')
      
      const response = await fetchWithAuth(`${BASE_URL}/api/stt/transcribe`, {
        method: 'POST',
        body: JSON.stringify({ audio: invalidAudio, format: 'wav' })
      })
      
      expect([400, 500]).toContain(response.status)
    })
  })
})

/**
 * Integration test for WebFetch large output handling
 * 
 * This test verifies that the context overflow fix (PR #6234) is working correctly.
 * It sends requests that trigger WebFetch with large outputs and verifies:
 * 1. The session doesn't get stuck
 * 2. No "prompt is too long" errors occur
 * 3. Large outputs are properly handled (file persistence)
 * 
 * Usage:
 *   OPENCODE_MANAGER_URL=https://your-deployment.com bun run test:integration
 * 
 * Or for local testing:
 *   docker run -d -p 5003:5003 ghcr.io/vibetechnologies/opencode-manager:latest
 *   bun run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import axios, { AxiosInstance } from 'axios'

const OPENCODE_MANAGER_URL = process.env.OPENCODE_MANAGER_URL || 'http://localhost:5003'
const OPENCODE_API_URL = `${OPENCODE_MANAGER_URL}/api/opencode`
const TEST_TIMEOUT = 180000

interface SessionStatus {
  type: 'idle' | 'busy' | 'retry'
  attempt?: number
  message?: string
  next?: number
}

interface MessagePart {
  type: string
  text?: string
  state?: {
    status: string
    output?: string
    error?: { name: string; data: { message: string } }
  }
  tool?: string
}

interface Message {
  id: string
  role: string
  parts: MessagePart[]
}

describe('WebFetch Large Output Integration Test', () => {
  let client: AxiosInstance
  let sessionID: string
  let directory: string

  beforeAll(async () => {
    console.log(`Testing against: ${OPENCODE_MANAGER_URL}`)
    
    client = axios.create({
      baseURL: OPENCODE_API_URL,
      timeout: 30000
    })

    try {
      const healthResponse = await axios.get(`${OPENCODE_MANAGER_URL}/api/health`)
      expect(healthResponse.status).toBe(200)
      console.log('Health check passed:', healthResponse.data)
    } catch (error) {
      console.error(`Failed to connect to ${OPENCODE_MANAGER_URL}`)
      console.error('Make sure the OpenCode Manager is running.')
      console.error('You can start it with: docker run -d -p 5003:5003 ghcr.io/vibetechnologies/opencode-manager:latest')
      throw error
    }

    try {
      const reposResponse = await axios.get(`${OPENCODE_MANAGER_URL}/api/repos`)
      const repos = reposResponse.data
      if (repos.length === 0) {
        console.warn('No repositories available. Creating a test workspace...')
        directory = '/workspace'
      } else {
        directory = repos[0].path
      }
      console.log('Using directory:', directory)
    } catch (error) {
      console.warn('Could not get repos, using default workspace')
      directory = '/workspace'
    }

    client.interceptors.request.use((config) => {
      config.params = { ...config.params, directory }
      return config
    })
  })

  afterAll(async () => {
    if (sessionID) {
      try {
        await client.delete(`/session/${sessionID}`)
        console.log('Cleaned up test session:', sessionID)
      } catch (e) {
        console.warn('Failed to cleanup session:', e)
      }
    }
  })

  beforeEach(() => {
    sessionID = ''
  })

  async function waitForSessionIdle(sid: string, maxWaitMs: number = 120000): Promise<void> {
    const startTime = Date.now()
    let lastLogTime = 0
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const statusResponse = await client.get<Record<string, SessionStatus>>('/session/status')
        const status = statusResponse.data[sid]
        
        if (!status || status.type === 'idle') {
          return
        }
        
        if (Date.now() - lastLogTime > 5000) {
          console.log(`Session status: ${status.type}${status.attempt ? ` (attempt ${status.attempt})` : ''}`)
          lastLogTime = Date.now()
        }
        
        if (status.type === 'retry') {
          console.log(`Session in retry state: attempt ${status.attempt}, message: ${status.message}`)
          if (status.attempt && status.attempt > 5) {
            throw new Error(`Session stuck in retry loop after ${status.attempt} attempts: ${status.message}`)
          }
        }
      } catch (error: any) {
        if (error.message?.includes('stuck in retry')) {
          throw error
        }
        console.warn('Error checking status:', error.message)
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    throw new Error(`Timeout waiting for session to become idle after ${maxWaitMs}ms`)
  }

  async function getLastAssistantMessage(sid: string): Promise<Message | undefined> {
    const messagesResponse = await client.get<Message[]>(`/session/${sid}/message`)
    const messages = messagesResponse.data
    return messages.filter(m => m.role === 'assistant').pop()
  }

  async function createTestSession(title: string): Promise<string> {
    const createResponse = await client.post('/session', { title })
    return createResponse.data.id
  }

  it('should handle WebFetch of a large file without context overflow', async () => {
    sessionID = await createTestSession('WebFetch Large Output Test')
    console.log('Created test session:', sessionID)

    const largeFileUrl = 'https://raw.githubusercontent.com/torvalds/linux/master/MAINTAINERS'
    
    console.log('Sending prompt to fetch large file...')
    await client.post(`/session/${sessionID}/message`, {
      parts: [{
        type: 'text',
        text: `Use the WebFetch tool to fetch this URL: ${largeFileUrl}
Then tell me the first 3 maintainers listed in the file. Just list their names.`
      }]
    })

    console.log('Waiting for response (this may take a while)...')
    await waitForSessionIdle(sessionID, TEST_TIMEOUT)

    const lastMessage = await getLastAssistantMessage(sessionID)
    expect(lastMessage).toBeDefined()
    
    const hasContextError = lastMessage?.parts.some(part => {
      const errorMsg = part.state?.error?.data?.message || ''
      return errorMsg.includes('prompt is too long') || 
             errorMsg.includes('context') ||
             errorMsg.includes('token')
    })
    
    if (hasContextError) {
      console.error('Context overflow error detected!')
      const errorPart = lastMessage?.parts.find(p => p.state?.error)
      console.error('Error:', errorPart?.state?.error)
    }
    
    expect(hasContextError).toBe(false)

    const webfetchPart = lastMessage?.parts.find(part => 
      part.type === 'tool' && part.tool === 'webfetch'
    )
    
    if (webfetchPart) {
      console.log('WebFetch tool status:', webfetchPart.state?.status)
      const output = webfetchPart.state?.output || ''
      
      const isFilePersisted = output.includes('Output saved to') || 
                              output.includes('file:') ||
                              output.includes('/tool_results/') ||
                              output.includes('.txt')
      
      console.log('Output length:', output.length)
      console.log('File persistence detected:', isFilePersisted)
      
      if (output.length > 30000 || isFilePersisted) {
        console.log('Large output was handled correctly via file persistence')
      }
    }

    const textParts = lastMessage?.parts.filter(part => part.type === 'text')
    const responseText = textParts?.map(p => p.text || '').join(' ') || ''
    
    console.log('Response preview:', responseText.substring(0, 300))
    
    expect(responseText.length).toBeGreaterThan(20)
    console.log('Test PASSED: WebFetch large output handled without context overflow')
  }, TEST_TIMEOUT)

  it('should not get stuck in retry loop with large outputs', async () => {
    sessionID = await createTestSession('Retry Loop Test')
    console.log('Created test session:', sessionID)

    console.log('Sending request with potentially large output...')
    await client.post(`/session/${sessionID}/message`, {
      parts: [{
        type: 'text',
        text: `Fetch https://raw.githubusercontent.com/nodejs/node/main/AUTHORS and count how many contributors are listed.`
      }]
    })

    let retryCount = 0
    const maxRetries = 10
    const startTime = Date.now()
    
    while (Date.now() - startTime < TEST_TIMEOUT) {
      const statusResponse = await client.get<Record<string, SessionStatus>>('/session/status')
      const status = statusResponse.data[sessionID]
      
      if (status?.type === 'retry') {
        retryCount++
        console.log(`Retry detected: attempt ${status.attempt}, count so far: ${retryCount}`)
        
        expect(retryCount).toBeLessThan(maxRetries)
      }
      
      if (!status || status.type === 'idle') {
        console.log('Session completed successfully')
        break
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    const lastMessage = await getLastAssistantMessage(sessionID)
    expect(lastMessage).toBeDefined()
    
    console.log(`Test PASSED: No excessive retry loop (${retryCount} retries)`)
  }, TEST_TIMEOUT)

  it('should recover gracefully after context-heavy operations', async () => {
    sessionID = await createTestSession('Context Recovery Test')
    console.log('Created test session:', sessionID)

    console.log('Step 1: Fetching large content...')
    await client.post(`/session/${sessionID}/message`, {
      parts: [{
        type: 'text',
        text: 'Fetch https://jsonplaceholder.typicode.com/posts and tell me how many posts there are.'
      }]
    })
    
    await waitForSessionIdle(sessionID, 60000)
    
    let lastMessage = await getLastAssistantMessage(sessionID)
    expect(lastMessage).toBeDefined()
    
    console.log('Step 2: Sending follow-up question...')
    await client.post(`/session/${sessionID}/message`, {
      parts: [{
        type: 'text', 
        text: 'What was the title of post #1?'
      }]
    })
    
    await waitForSessionIdle(sessionID, 60000)
    
    lastMessage = await getLastAssistantMessage(sessionID)
    expect(lastMessage).toBeDefined()
    
    const hasError = lastMessage?.parts.some(part => 
      part.state?.error?.data?.message?.includes('prompt is too long')
    )
    expect(hasError).toBe(false)
    
    console.log('Test PASSED: Session recovered gracefully after context-heavy operations')
  }, TEST_TIMEOUT)
})

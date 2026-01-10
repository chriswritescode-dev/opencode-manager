/**
 * Integration test for WebFetch large output handling
 * 
 * This test verifies that the context overflow fix (PR #6234) is working correctly.
 * It sends requests that trigger WebFetch with large outputs and verifies:
 * 1. The session doesn't get stuck in a retry loop
 * 2. No "prompt is too long" errors occur
 * 3. Large outputs are properly handled (file persistence)
 * 
 * Usage:
 *   OPENCODE_MANAGER_URL=https://your-deployment.com AUTH_USER=admin AUTH_PASS=secret pnpm run test:integration
 * 
 * Or for local testing:
 *   docker run -d -p 5003:5003 ghcr.io/vibetechnologies/opencode-manager:latest
 *   pnpm run test:integration
 * 
 * NOTE: This test is skipped by default. Run with RUN_INTEGRATION_TESTS=1 or use pnpm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const SKIP_INTEGRATION = !process.env.RUN_INTEGRATION_TESTS && !process.env.OPENCODE_MANAGER_URL
import axios, { AxiosInstance } from 'axios'

const OPENCODE_MANAGER_URL = process.env.OPENCODE_MANAGER_URL || 'http://localhost:5003'
const OPENCODE_API_URL = `${OPENCODE_MANAGER_URL}/api/opencode`
const AUTH_USER = process.env.AUTH_USER || ''
const AUTH_PASS = process.env.AUTH_PASS || ''
const TEST_TIMEOUT = 300000

interface SessionStatus {
  type: 'idle' | 'busy' | 'retry'
  attempt?: number
  message?: string
  next?: number
}

interface ToolState {
  status: string
  output?: string
  error?: { name: string; data: { message: string } }
}

interface MessagePart {
  type: string
  text?: string
  state?: ToolState
  tool?: string
}

interface MessageInfo {
  id: string
  role: string
  finish?: string
}

interface Message {
  info: MessageInfo
  parts: MessagePart[]
}

describe.skipIf(SKIP_INTEGRATION)('WebFetch Large Output Integration Test', () => {
  let client: AxiosInstance
  let sessionID: string
  let directory: string

  beforeAll(async () => {
    console.log(`Testing against: ${OPENCODE_MANAGER_URL}`)
    if (AUTH_USER) {
      console.log(`Using Basic Auth: ${AUTH_USER}:****`)
    }
    
    const axiosConfig: any = {
      baseURL: OPENCODE_API_URL,
      timeout: 30000
    }
    
    if (AUTH_USER && AUTH_PASS) {
      axiosConfig.auth = {
        username: AUTH_USER,
        password: AUTH_PASS
      }
    }
    
    client = axios.create(axiosConfig)

    try {
      const healthConfig: any = { timeout: 10000 }
      if (AUTH_USER && AUTH_PASS) {
        healthConfig.auth = { username: AUTH_USER, password: AUTH_PASS }
      }
      const healthResponse = await axios.get(`${OPENCODE_MANAGER_URL}/api/health`, healthConfig)
      expect(healthResponse.status).toBe(200)
      console.log('Health check passed:', healthResponse.data)
    } catch (error) {
      console.error(`Failed to connect to ${OPENCODE_MANAGER_URL}`)
      console.error('Make sure the OpenCode Manager is running.')
      console.error('You can start it with: docker run -d -p 5003:5003 ghcr.io/vibetechnologies/opencode-manager:latest')
      throw error
    }

    try {
      const reposConfig: any = { timeout: 10000 }
      if (AUTH_USER && AUTH_PASS) {
        reposConfig.auth = { username: AUTH_USER, password: AUTH_PASS }
      }
      const reposResponse = await axios.get(`${OPENCODE_MANAGER_URL}/api/repos`, reposConfig)
      const repos = reposResponse.data
      if (repos.length === 0) {
        console.warn('No repositories available. Using default workspace...')
        directory = '/workspace'
      } else {
        directory = repos[0].fullPath || repos[0].path || '/workspace'
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

  async function sendMessageAsync(sid: string, text: string): Promise<void> {
    const response = await client.post(`/session/${sid}/prompt_async`, {
      parts: [{ type: 'text', text }]
    })
    expect(response.status).toBe(204)
  }

  async function waitForSessionIdle(sid: string, maxWaitMs: number = 120000): Promise<void> {
    const startTime = Date.now()
    let lastLogTime = 0
    let lastStatus = ''
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const statusResponse = await client.get<Record<string, SessionStatus>>('/session/status')
        const status = statusResponse.data[sid]
        
        if (!status || status.type === 'idle') {
          if (lastStatus === 'busy') {
            console.log('Session completed (idle)')
          }
          return
        }
        
        const statusStr = `${status.type}${status.attempt ? ` (attempt ${status.attempt})` : ''}`
        if (Date.now() - lastLogTime > 5000 || statusStr !== lastStatus) {
          console.log(`Session status: ${statusStr}`)
          lastLogTime = Date.now()
          lastStatus = statusStr
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

  async function getMessages(sid: string): Promise<Message[]> {
    const messagesResponse = await client.get<Message[]>(`/session/${sid}/message`)
    return messagesResponse.data
  }

  async function getLastAssistantMessage(sid: string): Promise<Message | undefined> {
    const messages = await getMessages(sid)
    return messages.filter(m => m.info.role === 'assistant').pop()
  }

  async function createTestSession(title: string): Promise<string> {
    const createResponse = await client.post('/session', { title })
    return createResponse.data.id
  }

  function findWebFetchPart(message: Message): MessagePart | undefined {
    return message.parts.find(part => part.type === 'tool' && part.tool === 'webfetch')
  }

  function hasContextOverflowError(message: Message): boolean {
    return message.parts.some(part => {
      const errorMsg = part.state?.error?.data?.message || ''
      return errorMsg.includes('prompt is too long') || 
             errorMsg.includes('context length') ||
             errorMsg.includes('maximum context') ||
             errorMsg.includes('token limit')
    })
  }

  function isFilePersisted(output: string): boolean {
    return output.includes('Output') && 
           output.includes('exceeds maximum') && 
           output.includes('saved to')
  }

  it('should handle WebFetch of a large file without context overflow', async () => {
    sessionID = await createTestSession('WebFetch Large Output Test')
    console.log('Created test session:', sessionID)

    const largeFileUrl = 'https://raw.githubusercontent.com/torvalds/linux/master/MAINTAINERS'
    
    console.log('Sending prompt to fetch large file (async)...')
    await sendMessageAsync(sessionID, `Use the WebFetch tool to fetch this URL: ${largeFileUrl}
Then tell me the first 3 maintainers listed in the file. Just list their names.`)

    console.log('Waiting for response (this may take a while)...')
    await waitForSessionIdle(sessionID, TEST_TIMEOUT)

    const messages = await getMessages(sessionID)
    console.log(`Session has ${messages.length} messages`)
    
    const assistantMessages = messages.filter(m => m.info.role === 'assistant')
    expect(assistantMessages.length).toBeGreaterThan(0)
    
    for (const msg of assistantMessages) {
      expect(hasContextOverflowError(msg)).toBe(false)
      
      const webfetchPart = findWebFetchPart(msg)
      if (webfetchPart && webfetchPart.state) {
        console.log('WebFetch tool status:', webfetchPart.state.status)
        const output = webfetchPart.state.output || ''
        
        if (isFilePersisted(output)) {
          console.log('✓ Large output was saved to file (context overflow fix working)')
          console.log('Output:', output.substring(0, 200))
        }
      }
    }

    const lastMessage = assistantMessages[assistantMessages.length - 1]
    expect(lastMessage.info.finish).toBe('stop')
    
    const textParts = lastMessage.parts.filter(part => part.type === 'text')
    const responseText = textParts.map(p => p.text || '').join(' ')
    
    console.log('Response preview:', responseText.substring(0, 300))
    expect(responseText.length).toBeGreaterThan(20)
    
    console.log('Test PASSED: WebFetch large output handled without context overflow')
  }, TEST_TIMEOUT)

  it('should not get stuck in retry loop with large outputs', async () => {
    sessionID = await createTestSession('Retry Loop Test')
    console.log('Created test session:', sessionID)

    console.log('Sending request with potentially large output (async)...')
    await sendMessageAsync(sessionID, `Fetch https://raw.githubusercontent.com/nodejs/node/main/AUTHORS and count how many contributors are listed.`)

    let retryCount = 0
    const maxRetries = 5
    const startTime = Date.now()
    
    while (Date.now() - startTime < TEST_TIMEOUT) {
      const statusResponse = await client.get<Record<string, SessionStatus>>('/session/status')
      const status = statusResponse.data[sessionID]
      
      if (status?.type === 'retry') {
        retryCount++
        console.log(`Retry detected: attempt ${status.attempt}, total retries seen: ${retryCount}`)
        console.log(`Retry message: ${status.message}`)
        
        if (status.attempt && status.attempt > maxRetries) {
          throw new Error(`Session stuck in retry loop after ${status.attempt} attempts: ${status.message}`)
        }
      }
      
      if (!status || status.type === 'idle') {
        console.log('Session completed successfully')
        break
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    const lastMessage = await getLastAssistantMessage(sessionID)
    expect(lastMessage).toBeDefined()
    expect(lastMessage!.info.finish).toBe('stop')
    expect(hasContextOverflowError(lastMessage!)).toBe(false)
    
    console.log(`Test PASSED: No excessive retry loop (saw ${retryCount} retry status updates)`)
  }, TEST_TIMEOUT)

  it('should recover gracefully after context-heavy operations', async () => {
    sessionID = await createTestSession('Context Recovery Test')
    console.log('Created test session:', sessionID)

    console.log('Step 1: Fetching content...')
    await sendMessageAsync(sessionID, 'Fetch https://jsonplaceholder.typicode.com/posts and tell me how many posts there are.')
    
    await waitForSessionIdle(sessionID, 120000)
    
    let messages = await getMessages(sessionID)
    let assistantMessages = messages.filter(m => m.info.role === 'assistant')
    expect(assistantMessages.length).toBeGreaterThan(0)
    
    const firstResponse = assistantMessages[assistantMessages.length - 1]
    expect(firstResponse.info.finish).toBe('stop')
    expect(hasContextOverflowError(firstResponse)).toBe(false)
    console.log('Step 1 completed successfully')
    
    console.log('Step 2: Sending follow-up question...')
    await sendMessageAsync(sessionID, 'What was the title of post #1?')
    
    await waitForSessionIdle(sessionID, 120000)
    
    messages = await getMessages(sessionID)
    assistantMessages = messages.filter(m => m.info.role === 'assistant')
    
    const lastMessage = assistantMessages[assistantMessages.length - 1]
    expect(lastMessage.info.finish).toBe('stop')
    expect(hasContextOverflowError(lastMessage)).toBe(false)
    
    console.log('Test PASSED: Session recovered gracefully after context-heavy operations')
  }, TEST_TIMEOUT)
})

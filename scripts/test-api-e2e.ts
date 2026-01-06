#!/usr/bin/env bun

interface TestConfig {
  baseUrl: string
  username: string
  password: string
}

interface TestResult {
  name: string
  passed: boolean
  duration: number
  details?: string
  error?: string
}

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.OPENCODE_URL || 'http://localhost:5003',
  username: process.env.OPENCODE_USER || '',
  password: process.env.OPENCODE_PASS || ''
}

class APIE2ETest {
  private config: TestConfig
  private results: TestResult[] = []

  constructor(config: TestConfig) {
    this.config = config
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.config.username && this.config.password) {
      const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')
      headers['Authorization'] = `Basic ${auth}`
    }
    return headers
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
      ...this.getAuthHeaders()
    }
    return fetch(url, { ...options, headers })
  }

  private async runTest(name: string, testFn: () => Promise<{ passed: boolean; details?: string }>): Promise<TestResult> {
    const start = Date.now()
    try {
      const result = await testFn()
      const duration = Date.now() - start
      const testResult: TestResult = { name, ...result, duration }
      this.results.push(testResult)
      console.log(`${result.passed ? '✅' : '❌'} ${name} (${duration}ms)`)
      if (result.details) console.log(`   ${result.details}`)
      return testResult
    } catch (error) {
      const duration = Date.now() - start
      const testResult: TestResult = {
        name,
        passed: false,
        duration,
        error: error instanceof Error ? error.message : String(error)
      }
      this.results.push(testResult)
      console.log(`❌ ${name} (${duration}ms)`)
      console.log(`   Error: ${testResult.error}`)
      return testResult
    }
  }

  async testHealthEndpoint(): Promise<TestResult> {
    return this.runTest('Health Endpoint', async () => {
      const response = await this.fetch('/api/health')
      const data = await response.json()
      
      return {
        passed: response.status === 200 && data.status === 'healthy',
        details: `Status: ${data.status}, OpenCode: ${data.opencode}, Version: ${data.opencodeVersion || 'unknown'}`
      }
    })
  }

  async testSettingsEndpoint(): Promise<TestResult> {
    return this.runTest('Settings Endpoint', async () => {
      const response = await this.fetch('/api/settings')
      const data = await response.json()
      
      const hasPreferences = !!data.preferences
      const hasTTS = data.preferences?.tts !== undefined
      const hasSTT = data.preferences?.stt !== undefined
      
      return {
        passed: response.status === 200 && hasPreferences,
        details: `Has preferences: ${hasPreferences}, TTS config: ${hasTTS}, STT config: ${hasSTT}`
      }
    })
  }

  async testReposEndpoint(): Promise<TestResult> {
    return this.runTest('Repos Endpoint', async () => {
      const response = await this.fetch('/api/repos')
      const data = await response.json()
      
      const isArray = Array.isArray(data)
      
      return {
        passed: response.status === 200 && isArray,
        details: `Found ${data.length || 0} repos`
      }
    })
  }

  async testSTTStatus(): Promise<TestResult> {
    return this.runTest('STT Status', async () => {
      const response = await this.fetch('/api/stt/status')
      const data = await response.json()
      
      return {
        passed: response.status === 200,
        details: `Enabled: ${data.enabled}, Server running: ${data.server?.running}, Model: ${data.server?.model || 'none'}`
      }
    })
  }

  async testSTTModels(): Promise<TestResult> {
    return this.runTest('STT Models', async () => {
      const response = await this.fetch('/api/stt/models')
      const data = await response.json()
      
      const hasModels = Array.isArray(data.models) && data.models.length > 0
      
      return {
        passed: response.status === 200 && hasModels,
        details: `Available: ${data.models?.join(', ') || 'none'}`
      }
    })
  }

  async testTTSVoices(): Promise<TestResult> {
    return this.runTest('TTS Voices', async () => {
      const response = await this.fetch('/api/tts/voices')
      
      if (response.status === 200) {
        const data = await response.json()
        const hasVoices = Array.isArray(data.voices)
        return {
          passed: hasVoices,
          details: `Available: ${data.voices?.length || 0} voices`
        }
      }
      
      const data = await response.json()
      if (data.error?.includes('not configured')) {
        return { passed: true, details: 'TTS not configured (expected without API key)' }
      }
      
      return { passed: false, details: `Error: ${data.error || response.status}` }
    })
  }

  async testOpenCodeSession(): Promise<TestResult> {
    return this.runTest('OpenCode Session Creation', async () => {
      const response = await this.fetch('/api/opencode/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      
      if (response.status !== 200) {
        const text = await response.text()
        return { passed: false, details: `Status: ${response.status}, Body: ${text.slice(0, 100)}` }
      }
      
      const data = await response.json()
      const hasId = !!data.id
      
      return {
        passed: hasId,
        details: `Session ID: ${data.id || 'none'}`
      }
    })
  }

  async testOpenCodeProviders(): Promise<TestResult> {
    return this.runTest('OpenCode Providers', async () => {
      const response = await this.fetch('/api/opencode/providers')
      
      if (response.status !== 200) {
        return { passed: false, details: `Status: ${response.status}` }
      }
      
      const data = await response.json()
      const providers = Object.keys(data || {})
      
      return {
        passed: providers.length > 0,
        details: `Providers: ${providers.join(', ')}`
      }
    })
  }

  async testFilesEndpoint(): Promise<TestResult> {
    return this.runTest('Files Endpoint', async () => {
      const response = await this.fetch('/api/files?path=/')
      
      return {
        passed: response.status === 200,
        details: `Status: ${response.status}`
      }
    })
  }

  async testSimplePrompt(): Promise<TestResult> {
    return this.runTest('Simple Prompt (2+2)', async () => {
      const sessionResponse = await this.fetch('/api/opencode/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      
      if (sessionResponse.status !== 200) {
        return { passed: false, details: 'Failed to create session' }
      }
      
      const session = await sessionResponse.json()
      const sessionId = session.id
      
      const messageResponse = await this.fetch(`/api/opencode/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ type: 'text', text: 'What is 2+2? Reply with just the number.' }]
        })
      })
      
      if (!messageResponse.ok) {
        return { passed: false, details: 'Failed to send message' }
      }
      
      let response = ''
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000))
        
        const messagesResponse = await this.fetch(`/api/opencode/session/${sessionId}/message`)
        if (messagesResponse.ok) {
          const messages = await messagesResponse.json()
          
          if (Array.isArray(messages) && messages.length > 0) {
            const lastMsg = messages[messages.length - 1]
            if (lastMsg.info?.role === 'assistant' && lastMsg.info?.time?.completed) {
              const textParts = lastMsg.parts?.filter((p: { type: string }) => p.type === 'text') || []
              response = textParts.map((p: { text?: string }) => p.text || '').join('')
              break
            }
          }
        }
      }
      
      const hasFour = response.includes('4') || response.toLowerCase().includes('four')
      
      return {
        passed: hasFour,
        details: `Response: "${response.slice(0, 50)}${response.length > 50 ? '...' : ''}"`
      }
    })
  }

  async runAllTests(): Promise<void> {
    console.log('\n🧪 OpenCode Manager API E2E Tests\n')
    console.log(`URL: ${this.config.baseUrl}`)
    console.log(`Auth: ${this.config.username ? 'enabled' : 'disabled'}`)
    console.log('─'.repeat(60))
    console.log('')

    await this.testHealthEndpoint()
    await this.testSettingsEndpoint()
    await this.testReposEndpoint()
    await this.testSTTStatus()
    await this.testSTTModels()
    await this.testTTSVoices()
    await this.testFilesEndpoint()
    await this.testOpenCodeProviders()
    await this.testOpenCodeSession()
    await this.testSimplePrompt()

    this.printSummary()
  }

  private printSummary(): void {
    const passed = this.results.filter(r => r.passed).length
    const failed = this.results.filter(r => !r.passed).length
    const total = this.results.length

    console.log('')
    console.log('═'.repeat(60))
    console.log(`Results: ${passed}/${total} passed, ${failed} failed`)
    console.log('═'.repeat(60))

    if (failed > 0) {
      console.log('\nFailed tests:')
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error || r.details}`)
      })
      process.exit(1)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const config: TestConfig = { ...DEFAULT_CONFIG }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) config.baseUrl = args[++i]
    else if (args[i] === '--user' && args[i + 1]) config.username = args[++i]
    else if (args[i] === '--pass' && args[i + 1]) config.password = args[++i]
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
OpenCode Manager API E2E Tests

Runs API-level tests that don't require audio generation.
Suitable for CI environments.

Usage: bun run scripts/test-api-e2e.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5003)
  --user <username> Basic auth username
  --pass <password> Basic auth password
  --help, -h        Show this help

Environment Variables:
  OPENCODE_URL      Base URL
  OPENCODE_USER     Username
  OPENCODE_PASS     Password
`)
      process.exit(0)
    }
  }

  const tester = new APIE2ETest(config)
  await tester.runAllTests()
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

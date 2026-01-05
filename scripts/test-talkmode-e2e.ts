#!/usr/bin/env bun

import { spawn } from 'child_process'
import { readFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

interface TestConfig {
  baseUrl: string
  username: string
  password: string
  opcodeUrl: string
}

interface TestResult {
  name: string
  passed: boolean
  duration: number
  details?: string
  error?: string
}

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.OPENCODE_URL || 'http://localhost:5001',
  username: process.env.OPENCODE_USER || '',
  password: process.env.OPENCODE_PASS || '',
  opcodeUrl: process.env.OPENCODE_SERVER_URL || 'http://localhost:5551'
}

class TalkModeE2ETest {
  private config: TestConfig
  private results: TestResult[] = []
  private tempFiles: string[] = []

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

  private async fetchOpenCode(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.config.baseUrl}/api/opencode${path}`
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
      return testResult
    }
  }

  private execCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args)
      let stdout = ''
      let stderr = ''
      
      proc.stdout.on('data', (data) => { stdout += data.toString() })
      proc.stderr.on('data', (data) => { stderr += data.toString() })
      proc.on('close', (code) => {
        resolve({ stdout, stderr, code: code || 0 })
      })
    })
  }

  private async generateAudio16kHz(text: string, outputPath: string): Promise<boolean> {
    const aiffPath = outputPath.replace('.wav', '.aiff')
    
    const sayResult = await this.execCommand('say', ['-o', aiffPath, text])
    if (sayResult.code !== 0) {
      console.error('say command failed:', sayResult.stderr)
      return false
    }
    this.tempFiles.push(aiffPath)

    const ffmpegResult = await this.execCommand('ffmpeg', [
      '-y', '-i', aiffPath, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', outputPath
    ])
    if (ffmpegResult.code !== 0) {
      console.error('ffmpeg conversion failed:', ffmpegResult.stderr)
      return false
    }
    this.tempFiles.push(outputPath)
    
    return existsSync(outputPath)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async testTalkModeEnabled(): Promise<TestResult> {
    return this.runTest('Talk Mode Settings', async () => {
      const response = await this.fetch('/api/settings')
      const data = await response.json()

      if (response.status !== 200) {
        return { passed: false, details: `Status: ${response.status}` }
      }

      const talkMode = data.preferences?.talkMode
      const stt = data.preferences?.stt
      const tts = data.preferences?.tts

      const isEnabled = talkMode?.enabled && stt?.enabled

      return {
        passed: isEnabled,
        details: `TalkMode: ${talkMode?.enabled ? 'enabled' : 'disabled'}, STT: ${stt?.enabled ? 'enabled' : 'disabled'}, TTS: ${tts?.enabled ? 'enabled' : 'disabled'}, Silence: ${talkMode?.silenceThresholdMs}ms, MinSpeech: ${talkMode?.minSpeechMs}ms`
      }
    })
  }

  async testSTTTranscription(): Promise<TestResult> {
    return this.runTest('STT Transcription (16kHz WAV)', async () => {
      const testText = 'Hello, what is two plus two?'
      const wavPath = join(tmpdir(), `talkmode-test-${Date.now()}.wav`)
      
      const generated = await this.generateAudio16kHz(testText, wavPath)
      if (!generated) {
        return { passed: false, details: 'Failed to generate test audio (requires macOS with say command and ffmpeg)' }
      }

      const audioBuffer = readFileSync(wavPath)
      const audioBase64 = audioBuffer.toString('base64')

      const response = await this.fetch('/api/stt/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: audioBase64, format: 'wav' })
      })

      const data = await response.json()
      
      if (response.status !== 200) {
        return { passed: false, details: `Error: ${data.error || response.status}` }
      }

      const hasText = typeof data.text === 'string' && data.text.length > 0

      return {
        passed: hasText,
        details: `Transcribed: "${data.text}" | Duration: ${data.duration?.toFixed(2)}s`
      }
    })
  }

  async testCreateSession(): Promise<TestResult & { sessionId?: string }> {
    const result = await this.runTest('Create OpenCode Session', async () => {
      const response = await this.fetchOpenCode('/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      if (response.status !== 200) {
        const text = await response.text()
        return { passed: false, details: `Status: ${response.status}, Body: ${text}` }
      }

      const data = await response.json()
      const sessionId = data.id

      return {
        passed: !!sessionId,
        details: `Session ID: ${sessionId}`
      }
    })

    if (result.passed && result.details) {
      const match = result.details.match(/Session ID: (.+)/)
      if (match) {
        return { ...result, sessionId: match[1] }
      }
    }
    return result
  }

  async testFullTalkModeFlow(): Promise<TestResult> {
    return this.runTest('Full Talk Mode Flow (STT -> OpenCode -> Response)', async () => {
      const testQuestion = 'What is two plus two?'
      const wavPath = join(tmpdir(), `talkmode-flow-${Date.now()}.wav`)
      
      const generated = await this.generateAudio16kHz(testQuestion, wavPath)
      if (!generated) {
        return { passed: false, details: 'Failed to generate test audio' }
      }

      const audioBuffer = readFileSync(wavPath)
      const audioBase64 = audioBuffer.toString('base64')

      const sttResponse = await this.fetch('/api/stt/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: audioBase64, format: 'wav' })
      })

      const sttData = await sttResponse.json()
      if (!sttData.text) {
        return { passed: false, details: `STT failed: ${sttData.error || 'no text'}` }
      }

      const transcript = sttData.text.trim()

      const sessionResponse = await this.fetchOpenCode('/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      
      if (sessionResponse.status !== 200) {
        const text = await sessionResponse.text()
        return { passed: false, details: `Failed to create session: ${sessionResponse.status} - ${text}` }
      }
      
      const sessionData = await sessionResponse.json()
      const sessionId = sessionData.id

      const messageResponse = await this.fetchOpenCode(`/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ type: 'text', text: transcript }]
        })
      })

      if (!messageResponse.ok) {
        const text = await messageResponse.text()
        return { passed: false, details: `Failed to send message: ${messageResponse.status} - ${text}` }
      }

      let assistantResponse = ''
      let attempts = 0
      const maxAttempts = 60

      while (attempts < maxAttempts) {
        await this.sleep(1000)
        attempts++

        const messagesResponse = await this.fetchOpenCode(`/session/${sessionId}/message`)
        
        if (messagesResponse.ok) {
          const messages = await messagesResponse.json()
          
          if (Array.isArray(messages)) {
            if (messages.length > 0) {
              const lastMessage = messages[messages.length - 1]
              const messageInfo = lastMessage.info || lastMessage
              
              if (messageInfo.role === 'assistant') {
                const isComplete = !!messageInfo.time?.completed
                
                const textParts = lastMessage.parts?.filter((p: { type: string }) => p.type === 'text') || []
                assistantResponse = textParts.map((p: { text?: string }) => p.text || '').join('')
                
                if (isComplete && assistantResponse) {
                  const hasFour = assistantResponse.toLowerCase().includes('four') || assistantResponse.includes('4')
                  return {
                    passed: hasFour,
                    details: `Transcript: "${transcript}" | Response contains answer: ${hasFour} | Response: "${assistantResponse.slice(0, 200)}${assistantResponse.length > 200 ? '...' : ''}"`
                  }
                }
              }
            }
          }
        } else if (attempts % 20 === 0) {
          console.log(`   Still waiting for response... (${attempts}s)`)
        }
      }

      return { 
        passed: false, 
        details: `Timeout waiting for response after ${attempts} attempts. Got: "${assistantResponse.slice(0, 100)}..."` 
      }
    })
  }

  async testTTSResponse(): Promise<TestResult> {
    return this.runTest('TTS Response Synthesis', async () => {
      const responseText = 'Two plus two equals four.'
      
      const response = await this.fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: responseText })
      })

      const contentType = response.headers.get('content-type')
      
      if (response.status === 200) {
        const isAudio = contentType?.includes('audio') || contentType?.includes('octet-stream')
        if (isAudio) {
          const buffer = await response.arrayBuffer()
          return {
            passed: buffer.byteLength > 0,
            details: `Audio size: ${buffer.byteLength} bytes, Type: ${contentType}`
          }
        }
      }

      try {
        const data = await response.json()
        if (data.error?.includes('not configured') || data.error?.includes('API key')) {
          return { passed: true, details: 'TTS not configured (skipped - would work with API key)' }
        }
        return { passed: false, details: `Error: ${data.error || response.status}` }
      } catch {
        return { passed: false, details: `Status: ${response.status}, Content-Type: ${contentType}` }
      }
    })
  }

  async enableTalkMode(): Promise<boolean> {
    const response = await this.fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          stt: { enabled: true, model: 'base' },
          talkMode: { 
            enabled: true, 
            silenceThresholdMs: 800, 
            minSpeechMs: 400,
            autoInterrupt: true 
          }
        }
      })
    })
    return response.status === 200
  }

  cleanup(): void {
    for (const file of this.tempFiles) {
      try {
        if (existsSync(file)) {
          unlinkSync(file)
        }
      } catch {}
    }
  }

  async runAllTests(): Promise<void> {
    console.log('\n🎧 OpenCode Manager Talk Mode E2E Tests\n')
    console.log(`Backend URL: ${this.config.baseUrl}`)
    console.log(`OpenCode URL: ${this.config.opcodeUrl}`)
    console.log(`User: ${this.config.username || '(none)'}`)
    console.log('─'.repeat(60))

    const settingsResult = await this.testTalkModeEnabled()
    if (!settingsResult.passed) {
      console.log('\n⚙️  Enabling Talk Mode for tests...')
      const enabled = await this.enableTalkMode()
      if (!enabled) {
        console.log('❌ Failed to enable Talk Mode')
      } else {
        console.log('✅ Talk Mode enabled')
      }
    }

    await this.testSTTTranscription()
    await this.testCreateSession()
    await this.testFullTalkModeFlow()
    await this.testTTSResponse()

    this.cleanup()
    this.printResults()
  }

  private printResults(): void {
    console.log('\n' + '═'.repeat(60))
    console.log('Test Results')
    console.log('═'.repeat(60))

    let passed = 0
    let failed = 0

    for (const result of this.results) {
      const icon = result.passed ? '✅' : '❌'
      const status = result.passed ? 'PASS' : 'FAIL'
      passed += result.passed ? 1 : 0
      failed += result.passed ? 0 : 1

      console.log(`\n${icon} ${result.name} [${status}] (${result.duration}ms)`)
      if (result.details) {
        console.log(`   ${result.details}`)
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`)
      }
    }

    console.log('\n' + '─'.repeat(60))
    console.log(`Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed}`)
    console.log('─'.repeat(60))

    if (failed > 0) {
      process.exit(1)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  
  const config: TestConfig = { ...DEFAULT_CONFIG }
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      config.baseUrl = args[++i]
      if (!config.opcodeUrl.includes('localhost')) {
        config.opcodeUrl = config.baseUrl.replace(/:\d+$/, '') + ':5551'
      }
    } else if (args[i] === '--opencode-url' && args[i + 1]) {
      config.opcodeUrl = args[++i]
    } else if (args[i] === '--user' && args[i + 1]) {
      config.username = args[++i]
    } else if (args[i] === '--pass' && args[i + 1]) {
      config.password = args[++i]
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
OpenCode Manager Talk Mode E2E Test

This test simulates the full Talk Mode flow:
1. Generate audio from text (using macOS 'say' command)
2. Transcribe audio via STT API (Whisper)
3. Send transcription to OpenCode session
4. Wait for assistant response
5. Synthesize response via TTS (if configured)

Usage: bun run scripts/test-talkmode-e2e.ts [options]

Options:
  --url <url>           Backend API URL (default: http://localhost:5001)
  --opencode-url <url>  OpenCode server URL (default: http://localhost:5551)
  --user <username>     Username for basic auth
  --pass <password>     Password for basic auth
  --help, -h            Show this help

Environment Variables:
  OPENCODE_URL          Backend API URL
  OPENCODE_SERVER_URL   OpenCode server URL  
  OPENCODE_USER         Username
  OPENCODE_PASS         Password

Examples:
  # Local development
  bun run scripts/test-talkmode-e2e.ts

  # Remote deployment (URLs are proxied through backend)
  bun run scripts/test-talkmode-e2e.ts --url https://example.trycloudflare.com --user admin --pass secret
`)
      process.exit(0)
    }
  }

  if (config.baseUrl.includes('trycloudflare.com') || config.baseUrl.includes('https://')) {
    config.opcodeUrl = `${config.baseUrl}/opencode`
  }

  if (!config.baseUrl.includes('localhost') && !config.baseUrl.includes('127.0.0.1') && !config.password) {
    console.error('Error: Password is required for remote URLs. Use --pass <password> or set OPENCODE_PASS')
    process.exit(1)
  }

  const tester = new TalkModeE2ETest(config)
  await tester.runAllTests()
}

main().catch((error) => {
  console.error('Test failed:', error)
  process.exit(1)
})

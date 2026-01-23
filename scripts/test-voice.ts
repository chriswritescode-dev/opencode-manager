#!/usr/bin/env bun

import { spawn } from 'child_process'
import { readFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

interface TestConfig {
  baseUrl: string
  username: string
  password: string
  testText: string
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
  testText: process.env.TEST_TEXT || 'What is two plus two?'
}

class VoiceTest {
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

  private async generateAudio(text: string, outputPath: string): Promise<boolean> {
    if (process.platform === 'darwin') {
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
    } else {
      const espeakResult = await this.execCommand('espeak', ['-w', outputPath, text])
      if (espeakResult.code === 0 && existsSync(outputPath)) {
        this.tempFiles.push(outputPath)
        return true
      }
      
      const picoResult = await this.execCommand('pico2wave', ['-w', outputPath, text])
      if (picoResult.code === 0 && existsSync(outputPath)) {
        this.tempFiles.push(outputPath)
        return true
      }
      
      console.log('No TTS available, creating silent audio with speech-like duration')
      const ffmpegResult = await this.execCommand('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '3', outputPath
      ])
      if (ffmpegResult.code === 0 && existsSync(outputPath)) {
        this.tempFiles.push(outputPath)
        return true
      }
      
      console.error('Failed to generate audio on Linux')
      return false
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async testHealth(): Promise<TestResult> {
    return this.runTest('Health Endpoint', async () => {
      const response = await this.fetch('/api/health')
      const data = await response.json()
      
      if (response.status !== 200) {
        return { passed: false, details: `Status: ${response.status}` }
      }
      
      return {
        passed: data.status === 'healthy' && data.opencode === 'healthy',
        details: `OpenCode: ${data.opencodeVersion}, DB: ${data.database}`
      }
    })
  }

  async testAuthEnforced(): Promise<TestResult> {
    return this.runTest('Authentication Enforced (when configured)', async () => {
      if (!this.config.username || !this.config.password) {
        return { passed: true, details: 'Skipped - no auth configured' }
      }

      const url = `${this.config.baseUrl}/api/health`
      const noAuthResponse = await fetch(url)
      
      if (noAuthResponse.status !== 401) {
        return { 
          passed: false, 
          details: `Expected 401 without auth, got ${noAuthResponse.status}` 
        }
      }

      const wrongAuthResponse = await fetch(url, {
        headers: { 'Authorization': `Basic ${Buffer.from('wrong:wrong').toString('base64')}` }
      })
      
      if (wrongAuthResponse.status !== 401) {
        return { 
          passed: false, 
          details: `Expected 401 with wrong auth, got ${wrongAuthResponse.status}` 
        }
      }

      const correctAuthResponse = await this.fetch('/api/health')
      
      return {
        passed: correctAuthResponse.status === 200,
        details: `No auth: 401 ✓, Wrong auth: 401 ✓, Correct auth: ${correctAuthResponse.status}`
      }
    })
  }

  async testOpenCodeProxyDynamic(): Promise<TestResult> {
    return this.runTest('OpenCode Proxy (dynamic port)', async () => {
      const healthResponse = await this.fetch('/api/health')
      if (healthResponse.status !== 200) {
        return { passed: false, details: `Health check failed: ${healthResponse.status}` }
      }
      
      const healthData = await healthResponse.json()
      const configuredPort = healthData.opencodePort

      const sessionResponse = await this.fetchOpenCode('/session')
      
      if (sessionResponse.status !== 200) {
        const text = await sessionResponse.text()
        const isHtml = text.includes('<!doctype html>') || text.includes('<html')
        if (isHtml) {
          return { 
            passed: false, 
            details: `Proxy returned HTML instead of JSON - port mismatch (configured: ${configuredPort})` 
          }
        }
        return { passed: false, details: `Status: ${sessionResponse.status}` }
      }
      
      const sessions = await sessionResponse.json()
      
      return {
        passed: Array.isArray(sessions),
        details: `OpenCode port: ${configuredPort}, Sessions: ${sessions.length}`
      }
    })
  }

  async testSettings(): Promise<TestResult> {
    return this.runTest('Voice Settings', async () => {
      const response = await this.fetch('/api/settings')
      const data = await response.json()

      if (response.status !== 200) {
        return { passed: false, details: `Status: ${response.status}` }
      }

      const prefs = data.preferences
      const hasTTS = prefs?.tts !== undefined
      const hasSTT = prefs?.stt !== undefined
      const hasTalkMode = prefs?.talkMode !== undefined

      return {
        passed: hasTTS && hasSTT && hasTalkMode,
        details: `TTS: ${hasTTS ? (prefs.tts.enabled ? 'enabled' : 'disabled') : 'missing'}, STT: ${hasSTT ? (prefs.stt.enabled ? 'enabled' : 'disabled') : 'missing'}, TalkMode: ${hasTalkMode ? (prefs.talkMode.enabled ? 'enabled' : 'disabled') : 'missing'}`
      }
    })
  }

  async testSTTStatus(): Promise<TestResult> {
    return this.runTest('STT Status', async () => {
      const response = await this.fetch('/api/stt/status')
      const data = await response.json()
      
      if (response.status !== 200) {
        return { passed: false, details: `Status: ${response.status}` }
      }
      
      return {
        passed: data.server?.running === true,
        details: `Server running: ${data.server?.running}, Port: ${data.server?.port}, Model: ${data.server?.model}`
      }
    })
  }

  async testSTTModels(): Promise<TestResult> {
    return this.runTest('STT Models', async () => {
      const response = await this.fetch('/api/stt/models')
      const data = await response.json()
      
      if (response.status !== 200) {
        return { passed: false, details: `Status: ${response.status}` }
      }
      
      const hasModels = Array.isArray(data.models) && data.models.length > 0
      return {
        passed: hasModels,
        details: `Available models: ${data.models?.join(', ') || 'none'}`
      }
    })
  }

  async testSTTTranscription(): Promise<TestResult> {
    return this.runTest('STT Transcription', async () => {
      const wavPath = join(tmpdir(), `test-stt-${Date.now()}.wav`)
      
      const generated = await this.generateAudio(this.config.testText, wavPath)
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
        if (data.error === 'STT is not enabled') {
          return { passed: false, details: 'STT is not enabled in settings. Enable it first.' }
        }
        return { passed: false, details: `Error: ${data.error || response.status}` }
      }

      const hasText = typeof data.text === 'string' && data.text.length > 0
      const originalWords = this.config.testText.toLowerCase().split(/\s+/)
      const transcribedWords = (data.text || '').toLowerCase().split(/\s+/)
      const matchingWords = originalWords.filter(w => transcribedWords.some(tw => tw.includes(w) || w.includes(tw)))
      const accuracy = Math.round((matchingWords.length / originalWords.length) * 100)

      return {
        passed: hasText && accuracy > 50,
        details: `Transcribed: "${data.text}" | Accuracy: ~${accuracy}% | Duration: ${data.duration?.toFixed(2)}s`
      }
    })
  }

  async testTTSVoices(): Promise<TestResult> {
    return this.runTest('TTS Voices', async () => {
      const response = await this.fetch('/api/tts/voices')
      const data = await response.json()

      if (data.error === 'TTS not configured') {
        return { passed: true, details: 'TTS not configured (expected if no API key set)' }
      }

      if (response.status !== 200) {
        return { passed: false, details: `Error: ${data.error || response.status}` }
      }

      const hasVoices = Array.isArray(data.voices) && data.voices.length > 0
      return {
        passed: hasVoices,
        details: `Available voices: ${data.voices?.slice(0, 5).join(', ') || 'none'}${data.voices?.length > 5 ? '...' : ''}`
      }
    })
  }

  async testTTSSynthesis(): Promise<TestResult> {
    return this.runTest('TTS Synthesis', async () => {
      const response = await this.fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello world, this is a test.' })
      })

      if (response.status === 200) {
        const contentType = response.headers.get('content-type')
        const isAudio = contentType?.includes('audio') || contentType?.includes('octet-stream')
        const buffer = await response.arrayBuffer()
        return {
          passed: isAudio && buffer.byteLength > 0,
          details: `Audio size: ${buffer.byteLength} bytes, Type: ${contentType}`
        }
      }

      const data = await response.json()
      if (data.error?.includes('not configured') || data.error?.includes('API key') || data.error?.includes('not enabled')) {
        return { passed: true, details: 'TTS not configured (expected if no API key set)' }
      }

      return { passed: false, details: `Error: ${data.error || response.status}` }
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
      const wavPath = join(tmpdir(), `talkmode-flow-${Date.now()}.wav`)
      
      const generated = await this.generateAudio(this.config.testText, wavPath)
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

  async testSTTErrorHandling(): Promise<TestResult> {
    return this.runTest('STT Error Handling (Invalid Input)', async () => {
      const response = await this.fetch('/api/stt/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: 'not_valid_base64!', format: 'wav' })
      })

      const data = await response.json()
      
      const hasError = data.error !== undefined
      const hasDetails = data.details !== undefined
      
      return {
        passed: hasError && response.status !== 200,
        details: `Status: ${response.status}, Error: ${data.error || 'none'}`
      }
    })
  }

  async testSTTEmptyInput(): Promise<TestResult> {
    return this.runTest('STT Empty Input Validation', async () => {
      const response = await this.fetch('/api/stt/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: '', format: 'wav' })
      })

      const data = await response.json()
      
      return {
        passed: response.status === 400 && data.error === 'Invalid request',
        details: `Status: ${response.status}, Response: ${JSON.stringify(data).slice(0, 100)}`
      }
    })
  }

  async testOpenCodeModelAvailable(): Promise<TestResult> {
    return this.runTest('OpenCode Model Configured', async () => {
      const response = await this.fetchOpenCode('/config')
      
      if (response.status !== 200) {
        return { passed: false, details: `Status: ${response.status}` }
      }
      
      const data = await response.json()
      const hasModel = data.model && typeof data.model === 'string' && data.model.length > 0
      const hasProvider = data.model?.includes('/')
      
      return {
        passed: hasModel && hasProvider,
        details: `Model: ${data.model || 'not set'}, Small: ${data.small_model || 'not set'}`
      }
    })
  }

  async enableVoiceFeatures(): Promise<boolean> {
    const response = await this.fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          stt: { enabled: true, model: 'base', autoSubmit: false },
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

  async runAllTests(skipTalkMode: boolean = false): Promise<void> {
    console.log('\nOpenCode Manager Voice API Tests\n')
    console.log(`Base URL: ${this.config.baseUrl}`)
    console.log(`User: ${this.config.username || '(none)'}`)
    console.log(`Skip Talk Mode Flow: ${skipTalkMode}`)
    console.log('-'.repeat(60))

    await this.testHealth()
    await this.testAuthEnforced()
    await this.testOpenCodeProxyDynamic()
    await this.testSettings()
    await this.testSTTStatus()
    await this.testSTTModels()
    
    const sttStatus = await this.fetch('/api/stt/status')
    const sttData = await sttStatus.json()
    if (!sttData.enabled) {
      console.log('\n  Enabling voice features for tests...')
      await this.enableVoiceFeatures()
    }
    
    await this.testSTTTranscription()
    await this.testSTTErrorHandling()
    await this.testSTTEmptyInput()
    await this.testTTSVoices()
    await this.testTTSSynthesis()
    
    if (!skipTalkMode) {
      await this.testOpenCodeModelAvailable()
      await this.testCreateSession()
      await this.testFullTalkModeFlow()
    }

    this.cleanup()
    this.printResults()
  }

  private printResults(): void {
    console.log('\n' + '='.repeat(60))
    console.log('Test Results')
    console.log('='.repeat(60))

    let passed = 0
    let failed = 0

    for (const result of this.results) {
      const icon = result.passed ? '[PASS]' : '[FAIL]'
      passed += result.passed ? 1 : 0
      failed += result.passed ? 0 : 1

      console.log(`\n${icon} ${result.name} (${result.duration}ms)`)
      if (result.details) {
        console.log(`   ${result.details}`)
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`)
      }
    }

    console.log('\n' + '-'.repeat(60))
    console.log(`Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed}`)
    console.log('-'.repeat(60))

    if (failed > 0) {
      process.exit(1)
    }
  }
}

function printHelp(): void {
  console.log(`
OpenCode Manager Voice API Test

Tests STT (Speech-to-Text), TTS (Text-to-Speech), and Talk Mode functionality.

Usage: bun run scripts/test-voice.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5001)
  --user <username> Username for basic auth
  --pass <password> Password for basic auth
  --text <text>     Custom text for STT test (default: "What is two plus two?")
  --skip-talkmode   Skip the full talk mode flow test (faster)
  --help, -h        Show this help

Environment Variables:
  OPENCODE_URL      Base URL
  OPENCODE_USER     Username
  OPENCODE_PASS     Password
  TEST_TEXT         Custom test text

Tests Performed:
  1. Health endpoint connectivity
  2. Voice settings (TTS, STT, TalkMode config)
  3. STT server status and available models
  4. STT transcription with generated audio
  5. TTS voices and synthesis endpoints
  6. OpenCode session creation
  7. Full talk mode flow: Audio -> STT -> OpenCode -> Response

Examples:
  # Local development
  bun run scripts/test-voice.ts

  # Skip slow talk mode test
  bun run scripts/test-voice.ts --skip-talkmode

  # Remote deployment
  bun run scripts/test-voice.ts --url https://example.trycloudflare.com --user admin --pass secret
`)
}

async function main() {
  const args = process.argv.slice(2)
  
  const config: TestConfig = { ...DEFAULT_CONFIG }
  let skipTalkMode = false
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      config.baseUrl = args[++i]
    } else if (args[i] === '--user' && args[i + 1]) {
      config.username = args[++i]
    } else if (args[i] === '--pass' && args[i + 1]) {
      config.password = args[++i]
    } else if (args[i] === '--text' && args[i + 1]) {
      config.testText = args[++i]
    } else if (args[i] === '--skip-talkmode') {
      skipTalkMode = true
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  if (!config.baseUrl.includes('localhost') && !config.baseUrl.includes('127.0.0.1') && !config.password) {
    console.error('Error: Password is required for remote URLs. Use --pass <password> or set OPENCODE_PASS')
    process.exit(1)
  }

  const tester = new VoiceTest(config)
  await tester.runAllTests(skipTalkMode)
}

main().catch((error) => {
  console.error('Test failed:', error)
  process.exit(1)
})

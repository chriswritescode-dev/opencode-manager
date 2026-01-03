#!/usr/bin/env bun

import { spawn } from 'child_process'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs'
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
  baseUrl: process.env.OPENCODE_URL || 'http://localhost:5003',
  username: process.env.OPENCODE_USER || 'admin',
  password: process.env.OPENCODE_PASS || '',
  testText: process.env.TEST_TEXT || 'Create a TypeScript hello world application for Bun. The file should be called hello.ts and print Hello World to the console.'
}

class VoiceE2ETest {
  private config: TestConfig
  private results: TestResult[] = []
  private tempFiles: string[] = []

  constructor(config: TestConfig) {
    this.config = config
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')
    const url = `${this.config.baseUrl}${path}`
    
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Basic ${auth}`
      }
    })
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

  private async generateAudioWithSay(text: string, outputPath: string): Promise<boolean> {
    const aiffPath = outputPath.replace('.wav', '.aiff')
    
    const sayResult = await this.execCommand('say', ['-o', aiffPath, text])
    if (sayResult.code !== 0) {
      console.error('say command failed:', sayResult.stderr)
      return false
    }
    this.tempFiles.push(aiffPath)

    const ffmpegResult = await this.execCommand('ffmpeg', [
      '-y', '-i', aiffPath, '-ar', '16000', '-ac', '1', outputPath
    ])
    if (ffmpegResult.code !== 0) {
      console.error('ffmpeg conversion failed:', ffmpegResult.stderr)
      return false
    }
    this.tempFiles.push(outputPath)
    
    return existsSync(outputPath)
  }

  async testHealthEndpoint(): Promise<TestResult> {
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
      
      const generated = await this.generateAudioWithSay(this.config.testText, wavPath)
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
      if (data.error?.includes('not configured') || data.error?.includes('API key')) {
        return { passed: true, details: 'TTS not configured (expected if no API key set)' }
      }

      return { passed: false, details: `Error: ${data.error || response.status}` }
    })
  }

  async testSettingsVoiceConfig(): Promise<TestResult> {
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

  async enableSTT(): Promise<boolean> {
    const response = await this.fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          stt: { enabled: true, model: 'base', autoSubmit: false }
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
    console.log('\n🎤 OpenCode Manager Voice E2E Tests\n')
    console.log(`Base URL: ${this.config.baseUrl}`)
    console.log(`User: ${this.config.username}`)
    console.log('─'.repeat(60))

    await this.testHealthEndpoint()
    await this.testSettingsVoiceConfig()
    await this.testSTTStatus()
    await this.testSTTModels()
    
    const sttStatus = await this.fetch('/api/stt/status')
    const sttData = await sttStatus.json()
    if (!sttData.enabled) {
      console.log('\n⚙️  Enabling STT for transcription test...')
      await this.enableSTT()
    }
    
    await this.testSTTTranscription()
    await this.testTTSVoices()
    await this.testTTSSynthesis()

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
    } else if (args[i] === '--user' && args[i + 1]) {
      config.username = args[++i]
    } else if (args[i] === '--pass' && args[i + 1]) {
      config.password = args[++i]
    } else if (args[i] === '--text' && args[i + 1]) {
      config.testText = args[++i]
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
OpenCode Manager Voice E2E Test

Usage: bun run scripts/test-voice-e2e.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5003)
  --user <username> Username for basic auth (default: admin)
  --pass <password> Password for basic auth
  --text <text>     Custom text for STT test
  --help, -h        Show this help

Environment Variables:
  OPENCODE_URL      Base URL
  OPENCODE_USER     Username
  OPENCODE_PASS     Password
  TEST_TEXT         Custom test text

Examples:
  bun run scripts/test-voice-e2e.ts --url https://example.trycloudflare.com --user admin --pass secret
  OPENCODE_URL=http://localhost:5003 bun run scripts/test-voice-e2e.ts
`)
      process.exit(0)
    }
  }

  if (!config.password) {
    console.error('Error: Password is required. Use --pass <password> or set OPENCODE_PASS')
    process.exit(1)
  }

  const tester = new VoiceE2ETest(config)
  await tester.runAllTests()
}

main().catch((error) => {
  console.error('Test failed:', error)
  process.exit(1)
})

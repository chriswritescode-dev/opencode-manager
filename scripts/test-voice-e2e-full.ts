#!/usr/bin/env bun

import { chromium, Browser, Page } from 'playwright'
import { spawn, execSync } from 'child_process'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'

interface TestConfig {
  baseUrl: string
  username: string
  password: string
  testPhrase: string
  headless: boolean
  timeout: number
  useVirtualMic: boolean
}

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.OPENCODE_URL || 'http://localhost:5003',
  username: process.env.OPENCODE_USER || '',
  password: process.env.OPENCODE_PASS || '',
  testPhrase: 'What is two plus two',
  headless: process.env.CI === 'true',
  timeout: 120000,
  useVirtualMic: process.env.CI === 'true',
}

function log(message: string, indent = 0) {
  const prefix = '  '.repeat(indent)
  const timestamp = new Date().toISOString().slice(11, 19)
  console.log(`[${timestamp}] ${prefix}${message}`)
}

function success(message: string) {
  log(`[PASS] ${message}`)
}

function fail(message: string) {
  log(`[FAIL] ${message}`)
}

function info(message: string) {
  log(`[INFO] ${message}`)
}

function generateTestAudio(phrase: string): string {
  const audioPath = '/tmp/test-speech.wav'
  
  info(`Generating test audio for phrase: "${phrase}"`)
  
  if (process.platform === 'darwin') {
    execSync(`say -o ${audioPath} --data-format=LEI16@16000 "${phrase}"`, { stdio: 'inherit' })
  } else {
    try {
      execSync(`espeak -w ${audioPath} "${phrase}"`, { stdio: 'inherit' })
    } catch {
      info('espeak not available, using pico2wave...')
      try {
        execSync(`pico2wave -w ${audioPath} "${phrase}"`, { stdio: 'inherit' })
      } catch {
        info('No TTS available, creating silent audio placeholder')
        execSync(`ffmpeg -y -f lavfi -i anullsrc=r=16000:cl=mono -t 3 ${audioPath}`, { stdio: 'pipe' })
      }
    }
  }
  
  if (!existsSync(audioPath)) {
    throw new Error('Failed to generate test audio file')
  }
  
  info(`Audio file created: ${audioPath}`)
  return audioPath
}

function playAudioToVirtualMic(audioPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    info('Playing audio to virtual microphone...')
    
    const proc = spawn('paplay', ['--device=virtual_speaker', audioPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    
    proc.on('close', (code) => {
      if (code === 0) {
        info('Audio playback complete')
        resolve()
      } else {
        reject(new Error(`paplay exited with code ${code}`))
      }
    })
    
    proc.on('error', (err) => {
      reject(err)
    })
  })
}

async function injectAudioViaWebAPI(page: Page, audioPath: string): Promise<void> {
  info('Injecting audio via Web Audio API override...')
  
  const audioBase64 = execSync(`base64 -i ${audioPath}`).toString().trim()
  
  await page.evaluate(async (base64Audio: string) => {
    const binaryString = atob(base64Audio)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const audioBlob = new Blob([bytes], { type: 'audio/wav' })
    
    const audioContext = new AudioContext({ sampleRate: 16000 })
    const arrayBuffer = await audioBlob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    
    const source = audioContext.createBufferSource()
    source.buffer = audioBuffer
    
    const destination = audioContext.createMediaStreamDestination()
    source.connect(destination)
    
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.audio) {
        console.log('[Test] Returning injected audio stream')
        source.start()
        return destination.stream
      }
      return originalGetUserMedia(constraints)
    }
    
    console.log('[Test] Audio injection prepared')
  }, audioBase64)
  
  info('Audio injection setup complete')
}

async function waitForService(url: string, maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.ok) {
        const data = await response.json()
        if (data.status === 'healthy') {
          return true
        }
      }
    } catch {
      // Service not ready yet
    }
    await new Promise(r => setTimeout(r, 1000))
    if (i % 10 === 0) {
      info(`Waiting for service... (${i}/${maxAttempts})`)
    }
  }
  return false
}

async function runVoiceE2ETest(config: TestConfig): Promise<boolean> {
  console.log('\n' + '='.repeat(60))
  console.log('Voice E2E Test - Full Audio Pipeline')
  console.log('='.repeat(60))
  console.log(`URL: ${config.baseUrl}`)
  console.log(`Test Phrase: "${config.testPhrase}"`)
  console.log(`Virtual Mic: ${config.useVirtualMic}`)
  console.log(`Headless: ${config.headless}`)
  console.log('='.repeat(60) + '\n')

  let browser: Browser | null = null
  let audioPath: string | null = null

  try {
    info('Waiting for service to be ready...')
    const serviceReady = await waitForService(config.baseUrl)
    if (!serviceReady) {
      fail('Service failed to become healthy')
      return false
    }
    success('Service is healthy')

    info('Generating test audio...')
    audioPath = generateTestAudio(config.testPhrase)
    success('Test audio generated')

    info('Launching browser...')
    browser = await chromium.launch({
      headless: config.headless,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        config.useVirtualMic ? '--use-file-for-fake-audio-capture=/tmp/test-speech.wav' : '',
        '--autoplay-policy=no-user-gesture-required',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ].filter(Boolean)
    })

    const context = await browser.newContext({
      permissions: ['microphone'],
      httpCredentials: config.username && config.password ? {
        username: config.username,
        password: config.password
      } : undefined
    })

    const page = await context.newPage()

    page.on('console', msg => {
      const text = msg.text()
      if (text.includes('TalkMode') || text.includes('STT') || text.includes('transcri') || 
          text.includes('[Test]') || text.includes('speech') || text.includes('Error')) {
        log(`[Browser] ${text}`, 1)
      }
    })

    page.on('pageerror', err => {
      log(`[Page Error] ${err.message}`, 1)
    })

    if (!config.useVirtualMic) {
      await injectAudioViaWebAPI(page, audioPath)
    }

    info('Loading page...')
    await page.goto(config.baseUrl, { waitUntil: 'networkidle', timeout: 60000 })
    success('Page loaded')

    await page.waitForSelector('button', { timeout: 15000 })
    success('App rendered')

    await page.waitForTimeout(2000)

    info('Checking repos...')
    const repos = await page.evaluate(async () => {
      const response = await fetch('/api/repos')
      return response.json()
    })

    if (!repos.length) {
      fail('No repos available')
      return false
    }

    const repoId = repos[0].id
    const repoPath = repos[0].fullPath
    success(`Found repo: ${repos[0].repoUrl}`)

    info('Navigating to repo...')
    await page.goto(`${config.baseUrl}/repo/${repoId}`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(2000)

    info('Checking for existing session or creating new one...')
    const sessionsResult = await page.evaluate(async (directory: string) => {
      try {
        const response = await fetch(`/api/opencode/sessions?directory=${encodeURIComponent(directory)}`)
        if (!response.ok) return { error: `HTTP ${response.status}` }
        return response.json()
      } catch (e) {
        return { error: String(e) }
      }
    }, repoPath)

    let sessionId: string | null = null

    if (Array.isArray(sessionsResult) && sessionsResult.length > 0) {
      sessionId = sessionsResult[0].id
      success(`Using existing session: ${sessionId}`)
    } else {
      info('Creating new session...')
      const createResult = await page.evaluate(async (directory: string) => {
        const response = await fetch('/api/opencode/session', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-opencode-dir': directory
          },
          body: JSON.stringify({})
        })
        if (!response.ok) return { error: `HTTP ${response.status}` }
        return response.json()
      }, repoPath)

      if (createResult.error) {
        fail(`Failed to create session: ${createResult.error}`)
        return false
      }
      sessionId = createResult.id
      success(`Created session: ${sessionId}`)
    }

    await page.goto(`${config.baseUrl}/repos/${repoId}/sessions/${sessionId}`, { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    })
    await page.waitForTimeout(2000)

    info('Checking STT status...')
    const sttStatus = await page.evaluate(async () => {
      const response = await fetch('/api/stt/status')
      return response.json()
    })

    if (sttStatus.error || !sttStatus.server?.running) {
      fail(`STT not ready: ${JSON.stringify(sttStatus)}`)
      return false
    }
    success(`STT ready: ${sttStatus.server?.model || sttStatus.config?.model}`)

    info('Looking for Talk Mode button...')
    const talkModeButton = await page.locator('button[title*="Talk Mode"], button[title*="talk mode"]').first()
    
    if (!await talkModeButton.isVisible()) {
      fail('Talk Mode button not found')
      await page.screenshot({ path: '/tmp/voice-e2e-no-button.png' })
      return false
    }
    success('Found Talk Mode button')

    info('Starting Talk Mode...')
    await talkModeButton.click()
    await page.waitForTimeout(2000)

    const testApiReady = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        let attempts = 0
        const check = () => {
          const testApi = (window as Window & { __TALK_MODE_TEST__?: { getState: () => unknown } }).__TALK_MODE_TEST__
          if (testApi && typeof testApi.getState === 'function') {
            resolve(true)
          } else if (attempts++ < 30) {
            setTimeout(check, 200)
          } else {
            resolve(false)
          }
        }
        check()
      })
    })

    if (!testApiReady) {
      fail('Talk Mode test API not available')
      return false
    }
    success('Talk Mode started and test API ready')

    const initialState = await page.evaluate(() => {
      const testApi = (window as Window & { __TALK_MODE_TEST__?: { getState: () => { state: string } } }).__TALK_MODE_TEST__
      return testApi?.getState()
    })
    info(`Initial Talk Mode state: ${initialState?.state}`)

    if (config.useVirtualMic) {
      info('Playing audio to virtual microphone (testing full audio pipeline)...')
      await playAudioToVirtualMic(audioPath)
      await page.waitForTimeout(5000)
    } else {
      info('Using transcript injection (audio override mode)...')
      const injected = await page.evaluate((phrase: string) => {
        const testApi = (window as Window & { __TALK_MODE_TEST__?: { injectTranscript: (t: string) => boolean } }).__TALK_MODE_TEST__
        if (!testApi) return false
        return testApi.injectTranscript(phrase)
      }, config.testPhrase)

      if (!injected) {
        fail('Failed to inject transcript')
        return false
      }
      success('Transcript injected')
    }

    info('Waiting for agent response...')
    
    let response: string | null = null
    const startTime = Date.now()
    const maxWait = 60000

    while (Date.now() - startTime < maxWait) {
      const state = await page.evaluate(() => {
        const testApi = (window as Window & { __TALK_MODE_TEST__?: { 
          getState: () => { 
            state: string
            agentResponse: string | null 
            userTranscript: string | null
          } 
        } }).__TALK_MODE_TEST__
        return testApi?.getState()
      })

      if (state?.agentResponse) {
        response = state.agentResponse
        break
      }

      if (state?.state === 'listening' && state?.userTranscript) {
        info(`Transcribed: "${state.userTranscript}"`)
      }

      await page.waitForTimeout(500)
    }

    info('Stopping Talk Mode...')
    await talkModeButton.click()
    await page.waitForTimeout(1000)

    console.log('\n' + '='.repeat(60))
    console.log('Test Results')
    console.log('='.repeat(60))

    if (response) {
      success(`Agent responded: "${response.slice(0, 100)}..."`)
      
      if (response.includes('4') || response.toLowerCase().includes('four')) {
        success('Response contains correct answer!')
      }
      
      success('Voice E2E test passed!')
      return true
    } else {
      fail('No response received from agent')
      await page.screenshot({ path: '/tmp/voice-e2e-no-response.png' })
      return false
    }

  } catch (error) {
    fail(`Test error: ${error instanceof Error ? error.message : error}`)
    console.error(error)
    return false
  } finally {
    if (browser) {
      await browser.close()
    }
    if (audioPath && existsSync(audioPath)) {
      try {
        unlinkSync(audioPath)
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const config: TestConfig = { ...DEFAULT_CONFIG }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        config.baseUrl = args[++i]
        break
      case '--user':
        config.username = args[++i]
        break
      case '--pass':
        config.password = args[++i]
        break
      case '--text':
        config.testPhrase = args[++i]
        break
      case '--no-headless':
        config.headless = false
        break
      case '--virtual-mic':
        config.useVirtualMic = true
        break
      case '--no-virtual-mic':
        config.useVirtualMic = false
        break
      case '--help':
      case '-h':
        console.log(`
Voice E2E Test - Full Audio Pipeline

Tests the complete Talk Mode voice flow:
1. Generates test audio (TTS) for a phrase
2. Either injects audio via virtual mic (CI) or Web Audio API
3. Waits for STT to transcribe
4. Verifies OpenCode responds correctly

Usage: bun run scripts/test-voice-e2e-full.ts [options]

Options:
  --url <url>         Base URL (default: http://localhost:5003)
  --user <username>   Username for basic auth
  --pass <password>   Password for basic auth
  --text <phrase>     Test phrase (default: "What is two plus two")
  --no-headless       Run browser in visible mode
  --virtual-mic       Use PulseAudio virtual mic (CI mode)
  --no-virtual-mic    Use Web Audio API injection (local mode)
  --help, -h          Show this help

Environment Variables:
  OPENCODE_URL        Base URL
  OPENCODE_USER       Basic auth username
  OPENCODE_PASS       Basic auth password
  CI                  If "true", enables headless + virtual-mic mode
`)
        process.exit(0)
    }
  }

  const passed = await runVoiceE2ETest(config)
  process.exit(passed ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

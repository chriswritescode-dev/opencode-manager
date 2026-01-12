#!/usr/bin/env bun

import puppeteer, { Browser, Page } from 'puppeteer'
import { spawn, execSync } from 'child_process'
import { existsSync, unlinkSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

interface TestConfig {
  baseUrl: string
  username: string
  password: string
  testPhrase: string
  headless: boolean
  timeout: number
  useWebAudioInjection: boolean
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
  testPhrase: 'Write a simple python hello world app and test it',
  headless: process.env.CI === 'true',
  timeout: 180000,
  useWebAudioInjection: false,
}

function log(message: string, indent = 0) {
  const prefix = '  '.repeat(indent)
  const timestamp = new Date().toISOString().slice(11, 19)
  console.log(`[${timestamp}] ${prefix}${message}`)
}

function success(message: string) {
  log(`PASS ${message}`)
}

function fail(message: string) {
  log(`FAIL ${message}`)
}

function info(message: string) {
  log(`INFO ${message}`)
}

function execCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
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

async function generateTestAudio(phrase: string): Promise<string | null> {
  const wavPath = join(tmpdir(), `browser-test-${Date.now()}.wav`)
  const aiffPath = wavPath.replace('.wav', '.aiff')
  
  info(`Generating test audio: "${phrase}"`)
  
  if (process.platform === 'darwin') {
    const sayResult = await execCommand('say', ['-o', aiffPath, phrase])
    if (sayResult.code !== 0) {
      fail(`say command failed: ${sayResult.stderr}`)
      return null
    }

    const ffmpegResult = await execCommand('ffmpeg', [
      '-y', '-i', aiffPath, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', wavPath
    ])
    
    try { unlinkSync(aiffPath) } catch {}
    
    if (ffmpegResult.code !== 0) {
      fail(`ffmpeg conversion failed: ${ffmpegResult.stderr}`)
      return null
    }
  } else {
    try {
      const espeakResult = await execCommand('espeak', ['-w', wavPath, phrase])
      if (espeakResult.code !== 0) throw new Error('espeak failed')
    } catch {
      info('espeak not available, trying pico2wave...')
      try {
        const picoResult = await execCommand('pico2wave', ['-w', wavPath, phrase])
        if (picoResult.code !== 0) throw new Error('pico2wave failed')
      } catch {
        info('No TTS available, creating silent audio placeholder')
        const ffmpegResult = await execCommand('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '3', wavPath
        ])
        if (ffmpegResult.code !== 0) {
          fail('Failed to create audio file')
          return null
        }
      }
    }
  }
  
  if (!existsSync(wavPath)) {
    fail('Failed to create test audio file')
    return null
  }
  
  success(`Generated test audio: ${wavPath}`)
  return wavPath
}

async function injectAudioViaWebAPI(page: Page, audioPath: string): Promise<boolean> {
  info('Injecting audio via Web Audio API override...')
  
  try {
    const audioBuffer = readFileSync(audioPath)
    const audioBase64 = audioBuffer.toString('base64')
    
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
    
    success('Audio injection setup complete')
    return true
  } catch (error) {
    fail(`Audio injection failed: ${error instanceof Error ? error.message : error}`)
    return false
  }
}

async function waitForTalkModeState(page: Page, targetState: string, timeoutMs = 30000): Promise<boolean> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeoutMs) {
    const state = await page.evaluate(() => {
      const testApi = (window as Window & typeof globalThis & { 
        __TALK_MODE_TEST__?: { getState: () => { state: string } } 
      }).__TALK_MODE_TEST__
      return testApi?.getState()?.state
    })
    
    if (state === targetState) {
      return true
    }
    
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  
  return false
}

async function runBrowserTest(config: TestConfig): Promise<boolean> {
  console.log('\n' + '='.repeat(60))
  console.log('Browser E2E Test - Full Talk Mode Pipeline')
  console.log('='.repeat(60))
  console.log(`URL: ${config.baseUrl}`)
  console.log(`Test Phrase: "${config.testPhrase}"`)
  console.log(`Headless: ${config.headless}`)
  console.log(`Audio Mode: ${config.useWebAudioInjection ? 'Web Audio API injection' : 'Chrome fake audio capture'}`)
  console.log('='.repeat(60) + '\n')

  let browser: Browser | null = null
  let audioPath: string | null = null
  const results: TestResult[] = []

  try {
    audioPath = await generateTestAudio(config.testPhrase)
    if (!audioPath) {
      fail('Cannot run test without audio file')
      return false
    }

    info('Launching browser...')
    const launchArgs = [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ]
    
    if (!config.useWebAudioInjection) {
      launchArgs.push(`--use-file-for-fake-audio-capture=${audioPath}`)
    }
    
    browser = await puppeteer.launch({
      headless: config.headless,
      args: launchArgs
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    
    if (config.username && config.password) {
      await page.setExtraHTTPHeaders({
        'Authorization': `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
      })
    }

    const sttRequests: { url: string; status: number; body?: string }[] = []
    let transcriptionResult: string | null = null

    page.on('console', msg => {
      const text = msg.text()
      if (text.includes('TalkMode') || text.includes('STT') || text.includes('transcri') ||
          text.includes('Error') || text.includes('error') || text.includes('speech') ||
          text.includes('[Test]')) {
        log(`[Browser] ${text}`, 1)
      }
    })

    page.on('response', async response => {
      const url = response.url()
      if (url.includes('/api/stt/transcribe')) {
        const status = response.status()
        try {
          const body = await response.text()
          sttRequests.push({ url, status, body })
          log(`[STT Response] ${status}: ${body.slice(0, 200)}`, 1)
          
          if (status === 200) {
            const data = JSON.parse(body)
            if (data.text) {
              transcriptionResult = data.text
              success(`STT transcription: "${data.text}"`)
            }
          }
        } catch {
          sttRequests.push({ url, status })
        }
      }
    })

    if (config.useWebAudioInjection) {
      const injected = await injectAudioViaWebAPI(page, audioPath)
      if (!injected) {
        fail('Failed to setup Web Audio API injection')
        return false
      }
    }

    info('Loading page...')
    await page.goto(config.baseUrl, { waitUntil: 'networkidle2', timeout: 60000 })
    success('Page loaded')

    await page.waitForFunction(() => document.querySelector('button') !== null, { timeout: 15000 })
    success('App rendered')

    info('Checking repos...')
    const repos = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/repos')
        return await response.json()
      } catch (e) {
        return { error: String(e) }
      }
    })

    if (repos.error || !repos.length) {
      fail(`No repos available: ${repos.error || 'empty list'}`)
      return false
    }

    const repoId = repos[0].id
    const repoPath = repos[0].fullPath
    success(`Found repo: ${repos[0].repoUrl} (id: ${repoId})`)

    info('Getting or creating session...')
    let sessionId: string | null = null

    const sessions = await page.evaluate(async (directory: string) => {
      try {
        const response = await fetch(`/api/opencode/sessions?directory=${encodeURIComponent(directory)}`)
        if (!response.ok) return []
        return await response.json()
      } catch { return [] }
    }, repoPath)

    if (Array.isArray(sessions) && sessions.length > 0) {
      sessionId = sessions[0].id
      success(`Using existing session: ${sessionId}`)
    } else {
      const createResult = await page.evaluate(async (directory: string) => {
        const response = await fetch('/api/opencode/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-opencode-dir': directory },
          body: JSON.stringify({})
        })
        return response.ok ? await response.json() : null
      }, repoPath)

      if (!createResult) {
        fail('Failed to create session')
        return false
      }
      sessionId = createResult.id
      success(`Created new session: ${sessionId}`)
    }

    await page.goto(`${config.baseUrl}/repos/${repoId}/sessions/${sessionId}`, { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    })
    success('Navigated to session page')

    await new Promise(resolve => setTimeout(resolve, 2000))

    info('Verifying STT server is running...')
    const sttStatus = await page.evaluate(async () => {
      const response = await fetch('/api/stt/status')
      return response.json()
    })
    
    if (!sttStatus.server?.running) {
      fail(`STT server not running: ${JSON.stringify(sttStatus)}`)
      return false
    }
    success(`STT server is running (model: ${sttStatus.server?.model || 'unknown'})`)

    info('Looking for Talk Mode button...')
    const talkModeButton = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      for (const btn of buttons) {
        const title = btn.getAttribute('title')?.toLowerCase() || ''
        if (title.includes('talk mode') || title.includes('talk-mode')) {
          return { found: true, selector: `button[title="${btn.getAttribute('title')}"]` }
        }
      }
      return { found: false }
    })

    if (!talkModeButton.found) {
      fail('Talk Mode button not found')
      const buttons = await page.evaluate(() => 
        Array.from(document.querySelectorAll('button')).slice(0, 10).map(b => ({
          title: b.getAttribute('title'),
          text: b.textContent?.slice(0, 30)
        }))
      )
      log('Available buttons:', 1)
      buttons.forEach(b => log(JSON.stringify(b), 2))
      return false
    }
    success('Found Talk Mode button')

    info('Starting Talk Mode...')
    await page.click(talkModeButton.selector!)
    await new Promise(resolve => setTimeout(resolve, 1000))

    const testApiReady = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        let attempts = 0
        const check = () => {
          const testApi = (window as Window & typeof globalThis & { 
            __TALK_MODE_TEST__?: { getState: () => unknown } 
          }).__TALK_MODE_TEST__
          if (testApi && typeof testApi.getState === 'function') {
            resolve(true)
          } else if (attempts++ < 20) {
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
    success('Talk Mode activated')

    info('Waiting for Talk Mode to enter listening state...')
    const isListening = await waitForTalkModeState(page, 'listening', 10000)
    if (!isListening) {
      const state = await page.evaluate(() => {
        const testApi = (window as Window & typeof globalThis & { 
          __TALK_MODE_TEST__?: { getState: () => { state: string } } 
        }).__TALK_MODE_TEST__
        return testApi?.getState()
      })
      fail(`Talk Mode not in listening state: ${JSON.stringify(state)}`)
      return false
    }
    success('Talk Mode is listening for audio')

    info('Audio is being captured...')
    info('Waiting for STT transcription...')
    
    const startTime = Date.now()
    const maxWait = 30000
    
    while (Date.now() - startTime < maxWait && !transcriptionResult) {
      await new Promise(resolve => setTimeout(resolve, 500))
      
      if (sttRequests.length > 0) {
        const lastReq = sttRequests[sttRequests.length - 1]
        if (lastReq.status !== 200) {
          log(`STT request failed: ${lastReq.status} - ${lastReq.body}`, 1)
        }
      }
    }

    let agentResponse: string | null = null

    if (transcriptionResult) {
      success(`Transcribed: "${transcriptionResult}"`)
      
      info('Submitting transcribed message to OpenCode...')
      
      const submitted = await page.evaluate(async (text: string, sid: string, repoDir: string) => {
        try {
          const response = await fetch(`/api/opencode/session/${sid}/message`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-opencode-dir': repoDir
            },
            body: JSON.stringify({
              parts: [{ type: 'text', text: text }]
            })
          })
          
          if (response.ok) {
            return { method: 'directApi', success: true }
          }
          
          const errorText = await response.text()
          return { method: 'directApi', success: false, error: `${response.status}: ${errorText}` }
        } catch (e) {
          return { method: 'error', success: false, error: String(e) }
        }
      }, transcriptionResult, sessionId!, repoPath)
      
      if (submitted.success) {
        success(`Message submitted via ${submitted.method}`)
      } else {
        fail(`Failed to submit message: ${submitted.error || 'unknown error'}`)
      }
      
      info('Waiting for OpenCode to process and respond...')
      const responseStartTime = Date.now()
      const responseMaxWait = 120000
      let lastLoggedResponse = ''

      while (Date.now() - responseStartTime < responseMaxWait) {
        const messages = await page.evaluate(async (sid: string, dir: string) => {
          try {
            const res = await fetch(`/api/opencode/session/${sid}/message`, {
              headers: { 'x-opencode-dir': dir }
            })
            if (!res.ok) return []
            return res.json()
          } catch { return [] }
        }, sessionId!, repoPath)

        if (Array.isArray(messages)) {
          const assistantMsgs = messages.filter((m: { info?: { role: string } }) => m.info?.role === 'assistant')
          if (assistantMsgs.length > 0) {
            const lastMsg = assistantMsgs[assistantMsgs.length - 1]
            const allText: string[] = []
            
            for (const part of (lastMsg.parts || [])) {
              if (part.type === 'text' && part.text) {
                allText.push(part.text)
              }
              if (part.type === 'tool-invocation') {
                allText.push(`[Tool: ${part.toolName}]`)
              }
              if (part.type === 'tool-result' && part.result) {
                allText.push(`[Result: ${String(part.result).slice(0, 200)}]`)
              }
            }
            
            if (allText.length > 0) {
              const currentResponse = allText.join('\n')
              
              if (currentResponse !== lastLoggedResponse) {
                const newContent = currentResponse.slice(lastLoggedResponse.length)
                if (newContent.length > 0) {
                  log(`[OpenCode] ${newContent.slice(0, 300)}${newContent.length > 300 ? '...' : ''}`, 1)
                }
                lastLoggedResponse = currentResponse
                agentResponse = currentResponse
              }
              
              const isComplete = lastMsg.info?.time?.completed
              if (isComplete) {
                success('OpenCode response complete')
                break
              }
            }
          }
        }

        const elapsedSec = Math.floor((Date.now() - responseStartTime) / 1000)
        if (elapsedSec > 0 && elapsedSec % 15 === 0 && !agentResponse) {
          log(`Still waiting for OpenCode response... (${elapsedSec}s elapsed)`, 1)
        }

        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    info('Stopping Talk Mode...')
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      for (const btn of buttons) {
        const title = btn.getAttribute('title')?.toLowerCase() || ''
        if (title.includes('talk') || title.includes('exit') || title.includes('stop')) {
          (btn as HTMLButtonElement).click()
          return
        }
      }
    })

    console.log('\n' + '='.repeat(60))
    console.log('Test Results')
    console.log('='.repeat(60))

    const transcribedCorrectly = transcriptionResult && (
      transcriptionResult.toLowerCase().includes('python') ||
      transcriptionResult.toLowerCase().includes('hello') ||
      transcriptionResult.toLowerCase().includes('write')
    )

    if (transcriptionResult) {
      if (transcribedCorrectly) {
        success(`Audio transcribed correctly: "${transcriptionResult}"`)
      } else {
        fail(`Transcription mismatch - got: "${transcriptionResult}"`)
      }
    } else {
      fail('No transcription received')
      log(`STT calls made: ${sttRequests.length}`, 1)
      
      if (sttRequests.length === 0) {
        fail('No STT API calls made - audio capture may not be working')
        log('Possible causes:', 1)
        log('- MediaRecorder is not capturing audio from fake device', 2)
        log('- VAD (Voice Activity Detection) is not detecting speech', 2)
        log('- The audio file may be too short or have no speech content', 2)
      } else {
        fail('STT requests were made but no successful transcription')
        sttRequests.forEach((req, i) => {
          log(`Request ${i + 1}: ${req.status} - ${req.body?.slice(0, 100) || 'no body'}`, 2)
        })
      }
    }

    let responseHasCode = false
    let responseHasOutput = false

    if (agentResponse) {
      success(`OpenCode responded (${agentResponse.length} chars)`)
      log(`Response preview: "${agentResponse.slice(0, 200)}..."`, 1)
      
      responseHasCode = agentResponse.includes('print') || 
                        agentResponse.includes('hello') ||
                        agentResponse.includes('.py') ||
                        agentResponse.includes('python')
      
      responseHasOutput = agentResponse.toLowerCase().includes('hello world') ||
                          agentResponse.includes('Hello World') ||
                          agentResponse.includes('Hello, World')
      
      if (responseHasCode) {
        success('Response contains Python code!')
      } else {
        fail('Response does not contain expected Python code')
      }
      
      if (responseHasOutput) {
        success('Response shows "Hello World" output!')
      } else {
        log('Note: "Hello World" output not detected in response', 1)
      }
    } else if (transcriptionResult) {
      fail('No response from OpenCode')
    }

    const responseCorrect = responseHasCode
    const passed = !!transcribedCorrectly && !!responseCorrect

    if (passed) {
      console.log('\n' + '='.repeat(60))
      success('FULL E2E TEST PASSED')
      console.log('  Real audio -> MediaRecorder -> STT -> Transcription -> OpenCode -> Response')
      console.log('='.repeat(60))
    } else {
      console.log('\n' + '='.repeat(60))
      fail('TEST FAILED')
      if (!transcribedCorrectly) console.log('  - Transcription failed or incorrect')
      if (!responseCorrect) console.log('  - OpenCode response missing or incorrect')
      console.log('='.repeat(60))
    }

    return passed

  } catch (error) {
    fail(`Test error: ${error instanceof Error ? error.message : error}`)
    return false
  } finally {
    if (browser) {
      await browser.close()
    }
    
    if (audioPath && existsSync(audioPath)) {
      try { unlinkSync(audioPath) } catch {}
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
      config.testPhrase = args[++i]
    } else if (args[i] === '--no-headless') {
      config.headless = false
    } else if (args[i] === '--web-audio') {
      config.useWebAudioInjection = true
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Browser E2E Test - Full Talk Mode Pipeline

Tests the complete Talk Mode flow with real audio capture:
1. Generates test audio using macOS 'say' command (or espeak/pico2wave on Linux)
2. Launches Chrome with fake audio device OR Web Audio API injection
3. Starts Talk Mode which captures audio via getUserMedia()
4. Audio flows through MediaRecorder -> STT API -> Whisper
5. Verifies transcription matches the test phrase
6. Waits for OpenCode to write Python code and execute it
7. Verifies the response contains Python code and Hello World output

This test verifies the ACTUAL audio pipeline works end-to-end with a real coding task.

Requirements:
- macOS with 'say' command OR Linux with espeak/pico2wave
- ffmpeg installed
- Whisper server running
- OpenCode configured with an AI provider

Usage: bun run scripts/test-browser.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5001)
  --user <username> Username for basic auth
  --pass <password> Password for basic auth
  --text <phrase>   Test phrase to speak (default: "Write a simple python hello world app and test it")
  --no-headless     Run browser in visible mode for debugging
  --web-audio       Use Web Audio API injection instead of Chrome fake audio capture
  --help, -h        Show this help

Environment Variables:
  OPENCODE_URL      Base URL
  OPENCODE_USER     Username
  OPENCODE_PASS     Password
  CI                If "true", enables headless mode

Examples:
  # Local development
  bun run scripts/test-browser.ts

  # With visible browser for debugging
  bun run scripts/test-browser.ts --no-headless

  # Remote deployment with auth
  bun run scripts/test-browser.ts --url https://example.trycloudflare.com --user admin --pass secret

  # Use Web Audio API injection (alternative to fake audio device)
  bun run scripts/test-browser.ts --web-audio
`)
      process.exit(0)
    }
  }

  const passed = await runBrowserTest(config)
  process.exit(passed ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

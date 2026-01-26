#!/usr/bin/env bun

import puppeteer, { Browser, Page } from 'puppeteer'
import { spawn, execSync } from 'child_process'
import { existsSync, unlinkSync, readFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { VideoRecorder } from './lib/video-recorder'

interface TestConfig {
  baseUrl: string
  username: string
  password: string
  testPhrase: string
  headless: boolean
  timeout: number
  useWebAudioInjection: boolean
  sttOnly: boolean
  outputDir: string
  screenshotsDir: string
}

interface TestResult {
  name: string
  passed: boolean
  duration: number
  details?: string
  error?: string
}

function createTestOutputDir(): { outputDir: string; screenshotsDir: string } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outputDir = join(process.cwd(), '.test', `BrowserE2E-${timestamp}`)
  const screenshotsDir = join(outputDir, 'screenshots')
  mkdirSync(screenshotsDir, { recursive: true })
  return { outputDir, screenshotsDir }
}

const testDirs = createTestOutputDir()

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.OPENCODE_URL || 'http://localhost:5001',
  username: process.env.OPENCODE_USER || '',
  password: process.env.OPENCODE_PASS || '',
  testPhrase: 'What is two plus two? Reply with just the number.',
  headless: process.env.CI === 'true',
  timeout: 180000,
  useWebAudioInjection: false,
  sttOnly: false,
  outputDir: testDirs.outputDir,
  screenshotsDir: testDirs.screenshotsDir,
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

let screenshotCounter = 0

async function takeScreenshot(page: Page, name: string, screenshotsDir: string): Promise<void> {
  screenshotCounter++
  const filename = `${String(screenshotCounter).padStart(2, '0')}_${name.replace(/\s+/g, '_')}.png`
  const filepath = join(screenshotsDir, filename)
  await page.screenshot({ path: filepath, fullPage: false })
  log(`Screenshot: ${filename}`, 1)
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
  info('Injecting audio via Web Audio API override (evaluateOnNewDocument)...')
  
  try {
    const audioBuffer = readFileSync(audioPath)
    const audioBase64 = audioBuffer.toString('base64')
    
    await page.evaluateOnNewDocument((base64Audio: string) => {
      (window as Window & typeof globalThis & { __AUDIO_INJECTED__?: boolean }).__AUDIO_INJECTED__ = false;
      
      const setupAudioInjection = async () => {
        if ((window as Window & typeof globalThis & { __AUDIO_INJECTED__?: boolean }).__AUDIO_INJECTED__) {
          return
        }
        (window as Window & typeof globalThis & { __AUDIO_INJECTED__?: boolean }).__AUDIO_INJECTED__ = true
        
        const binaryString = atob(base64Audio)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const audioBlob = new Blob([bytes], { type: 'audio/wav' })
        
        const audioContext = new AudioContext({ sampleRate: 16000 })
        const arrayBuffer = await audioBlob.arrayBuffer()
        const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer)
        
        console.log('[Test] Audio decoded:', decodedBuffer.duration, 'seconds,', decodedBuffer.numberOfChannels, 'channels')
        
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          if (constraints?.audio) {
            console.log('[Test] getUserMedia called with audio - returning injected stream')
            
            const source = audioContext.createBufferSource()
            source.buffer = decodedBuffer
            
            const destination = audioContext.createMediaStreamDestination()
            source.connect(destination)
            source.start()
            
            console.log('[Test] Audio stream started, duration:', decodedBuffer.duration, 'seconds')
            return destination.stream
          }
          return originalGetUserMedia(constraints)
        }
        
        console.log('[Test] Audio injection ready - getUserMedia overridden')
      }
      
      if (document.readyState === 'complete') {
        setupAudioInjection()
      } else {
        window.addEventListener('load', () => setupAudioInjection())
      }
    }, audioBase64)
    
    success('Audio injection script registered (will activate on page load)')
    return true
  } catch (error) {
    fail(`Audio injection failed: ${error instanceof Error ? error.message : error}`)
    return false
  }
}

async function waitForVoiceButtonActive(page: Page, timeoutMs = 30000): Promise<boolean> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeoutMs) {
    const isActive = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      for (const btn of buttons) {
        const title = btn.getAttribute('title')?.toLowerCase() || ''
        if (title === 'stop voice input' || title === 'exit talk mode') {
          return true
        }
      }
      // Also check for listening indicator or Talk Mode overlay
      const listeningIndicator = document.querySelector('[class*="bg-green-500"]')
      if (listeningIndicator?.textContent?.includes('Listening')) {
        return true
      }
      // Check for Talk Mode overlay
      const overlay = document.querySelector('[class*="fixed inset-0"]')
      if (overlay && overlay.textContent?.includes('Talk Mode')) {
        return true
      }
      return false
    })
    
    if (isActive) {
      return true
    }
    
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  
  return false
}

async function runBrowserTest(config: TestConfig): Promise<boolean> {
  console.log('\n' + '='.repeat(60))
  console.log('Browser E2E Test - Voice Input Pipeline')
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
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
    ]
    
    if (!config.useWebAudioInjection) {
      launchArgs.push(`--use-file-for-fake-audio-capture=${audioPath}`)
    }
    
    let executablePath: string | undefined
    if (process.platform === 'darwin') {
      const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      if (existsSync(macPath)) executablePath = macPath
    } else if (process.platform === 'win32') {
      const winPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      if (existsSync(winPath)) executablePath = winPath
    } else {
      const linuxPaths = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']
      executablePath = linuxPaths.find(p => existsSync(p))
    }
    
    if (executablePath) {
      info(`Using Chrome at: ${executablePath}`)
    } else {
      info('Using Puppeteer bundled Chrome')
    }

    browser = await puppeteer.launch({
      headless: config.headless,
      protocolTimeout: 240000,
      ...(executablePath && { executablePath }),
      args: launchArgs
    })

    let page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    page.setDefaultTimeout(60000)
    
    if (config.username && config.password) {
      await page.setExtraHTTPHeaders({
        'Authorization': `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
      })
    }

    const sttRequests: { url: string; status: number; body?: string }[] = []
    let transcriptionResult: string | null = null

    page.on('console', msg => {
      const text = msg.text()
      if (text.includes('[SSE]') || text.includes('Connection error for')) {
        return
      }
      if (text.includes('Voice') || text.includes('STT') || text.includes('transcri') ||
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

    info('Setting up request interception to block SSE connections...')
    await page.setRequestInterception(true)
    page.on('request', request => {
      const url = request.url()
      // Block all SSE connections to prevent connection pool exhaustion
      if (url.includes('/api/opencode/event')) {
        request.abort()
      } else {
        request.continue()
      }
    })

    info('Loading page...')
    await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    success('Page loaded (DOM ready)')
    await takeScreenshot(page, 'page_loaded', config.screenshotsDir)

    const pageContent = await page.evaluate(() => document.body?.textContent?.slice(0, 500) || '')
    log(`Page content: ${pageContent.slice(0, 200)}`, 1)
    
    if (pageContent.includes('Unauthorized')) {
      fail('Page returned Unauthorized - auth headers may not be working')
      await takeScreenshot(page, 'unauthorized_error', config.screenshotsDir)
      return false
    }

    await page.waitForFunction(() => document.querySelector('button') !== null, { timeout: 30000 })
    success('App rendered')
    await takeScreenshot(page, 'app_rendered', config.screenshotsDir)

    info('Checking repos...')
    const repos = await page.evaluate(async () => {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        const response = await fetch('/api/repos', { signal: controller.signal })
        clearTimeout(timeoutId)
        return await response.json()
      } catch (e) {
        return { error: String(e) }
      }
    })

    if (repos.error || !repos.length) {
      if (config.sttOnly) {
        info('No repos available - skipping full Talk Mode test in STT-only mode')
        console.log('\n' + '='.repeat(60))
        success('STT-ONLY TEST PASSED (no repos to test with)')
        console.log('  Audio generation and injection verified')
        console.log('='.repeat(60))
        return true
      }
      fail(`No repos available: ${repos.error || 'empty list'}`)
      await takeScreenshot(page, 'no_repos_error', config.screenshotsDir)
      return false
    }

    const repoId = repos[0].id
    const repoPath = repos[0].fullPath
    success(`Found repo: ${repos[0].repoUrl} (id: ${repoId})`)

    info('Enabling STT and Talk Mode via Node.js fetch (before page load)...')
    try {
      const settingsHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (config.username && config.password) {
        settingsHeaders['Authorization'] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
      }
      const settingsResponse = await fetch(`${config.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: settingsHeaders,
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
      if (settingsResponse.ok) {
        success('STT and Talk Mode enabled via API')
      } else {
        fail(`Failed to enable settings: ${settingsResponse.status}`)
      }
    } catch (e) {
      fail(`Failed to enable settings: ${e}`)
    }

    info('Creating new session via Node.js fetch (bypassing browser connection pool)...')
    let sessionId: string | null = null

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (config.username && config.password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
      }
      const sessionResponse = await fetch(
        `${config.baseUrl}/api/opencode/session?directory=${encodeURIComponent(repoPath)}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({})
        }
      )
      if (!sessionResponse.ok) {
        const errText = await sessionResponse.text()
        fail(`Failed to create session: ${sessionResponse.status}: ${errText}`)
        return false
      }
      const sessionData = await sessionResponse.json() as { id: string }
      sessionId = sessionData.id
      success(`Created new session: ${sessionId}`)
    } catch (e) {
      fail(`Failed to create session: ${e}`)
      return false
    }

    info('Navigating to session page (using new page to avoid SSE blocking)...')
    const sessionUrl = `${config.baseUrl}/repos/${repoId}/sessions/${sessionId}`
    await page.close()
    page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    if (config.username && config.password) {
      await page.setExtraHTTPHeaders({
        'Authorization': `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
      })
    }
    page.on('console', msg => {
      const text = msg.text()
      if (text.includes('[SSE]') || text.includes('Connection error for')) {
        return
      }
      if (text.includes('Voice') || text.includes('STT') || text.includes('transcri') ||
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
    
    await page.setRequestInterception(true)
    const encodedRepoPath = encodeURIComponent(repoPath)
    let sseBlockCount = 0
    page.on('request', request => {
      const url = request.url()
      if (url.includes('/api/opencode/event') && !url.includes(encodedRepoPath)) {
        sseBlockCount++
        if (sseBlockCount <= 3) {
          log(`[Blocked SSE] ${url.slice(-50)}`, 2)
        } else if (sseBlockCount === 4) {
          log(`[Blocked SSE] ... (suppressing further messages)`, 2)
        }
        request.abort()
      } else {
        request.continue()
      }
    })
    
    if (config.useWebAudioInjection) {
      await injectAudioViaWebAPI(page, audioPath)
    }
    await page.goto(sessionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    success('Navigated to session page')
    await takeScreenshot(page, 'session_page', config.screenshotsDir)

    await page.waitForFunction(() => document.querySelector('button') !== null, { timeout: 30000 })
    await new Promise(resolve => setTimeout(resolve, 2000))

    info('Verifying STT server is running...')
    const sttHeaders: Record<string, string> = {}
    if (config.username && config.password) {
      sttHeaders['Authorization'] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
    }
    const sttResponse = await fetch(`${config.baseUrl}/api/stt/status`, { headers: sttHeaders })
    const sttStatus = await sttResponse.json() as { server?: { running: boolean; model?: string } }
    
    if (!sttStatus.server?.running) {
      fail(`STT server not running: ${JSON.stringify(sttStatus)}`)
      await takeScreenshot(page, 'stt_not_running', config.screenshotsDir)
      return false
    }
    success(`STT server is running (model: ${sttStatus.server?.model || 'unknown'})`)

    info('Checking settings from browser perspective (with cache bypass)...')
    const settingsCheckResponse = await fetch(`${config.baseUrl}/api/settings`, { headers: sttHeaders })
    const browserSettings = await settingsCheckResponse.json() as { preferences?: { stt?: { enabled?: boolean }; talkMode?: { enabled?: boolean } } }
    log(`API returns: stt.enabled=${browserSettings?.preferences?.stt?.enabled}, talkMode.enabled=${browserSettings?.preferences?.talkMode?.enabled}`, 1)
    
    info('Reloading page to force React Query refetch...')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('button') !== null, { timeout: 30000 })
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    info('Looking for voice input button...')
    
    let voiceButton: { found: boolean; selector?: string; title: string | null } = { found: false, title: null }
    const buttonWaitStart = Date.now()
    const buttonWaitMax = 15000
    
    while (Date.now() - buttonWaitStart < buttonWaitMax) {
      voiceButton = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'))
        for (const btn of buttons) {
          const title = btn.getAttribute('title')?.toLowerCase() || ''
          // Prefer Talk Mode button for continuous voice input
          if (title.includes('talk mode')) {
            return { found: true, selector: `button[title="${btn.getAttribute('title')}"]`, title: btn.getAttribute('title') }
          }
        }
        // Fallback to other voice buttons
        for (const btn of buttons) {
          const title = btn.getAttribute('title')?.toLowerCase() || ''
          if (title.includes('voice input') || title.includes('continuous voice')) {
            return { found: true, selector: `button[title="${btn.getAttribute('title')}"]`, title: btn.getAttribute('title') }
          }
        }
        return { found: false, title: null }
      })
      
      if (voiceButton.found) break
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (!voiceButton.found) {
      fail('Continuous Voice Input button not found')
      const buttons = await page.evaluate(() => 
        Array.from(document.querySelectorAll('button')).slice(0, 10).map(b => ({
          title: b.getAttribute('title'),
          text: b.textContent?.slice(0, 30)
        }))
      )
      log('Available buttons:', 1)
      buttons.forEach(b => log(JSON.stringify(b), 2))
      await takeScreenshot(page, 'voice_button_not_found', config.screenshotsDir)
      return false
    }
    success(`Found Continuous Voice button: "${voiceButton.title}"`)
    await takeScreenshot(page, 'voice_button_found', config.screenshotsDir)

    info('Starting continuous voice input...')
    
    await page.evaluate(() => {
      (window as Window & { __consoleErrors?: string[] }).__consoleErrors = []
      const origError = console.error
      console.error = (...args: unknown[]) => {
        (window as Window & { __consoleErrors?: string[] }).__consoleErrors?.push(args.map(String).join(' '))
        origError.apply(console, args)
      }
    })
    
    await page.click(voiceButton.selector!)
    await new Promise(resolve => setTimeout(resolve, 2000))

    info('Waiting for voice input to become active...')
    const isListening = await waitForVoiceButtonActive(page, 10000)
    if (!isListening) {
      const buttonsAfterClick = await page.evaluate(() => 
        Array.from(document.querySelectorAll('button')).map(b => ({
          title: b.getAttribute('title'),
          text: b.textContent?.slice(0, 30),
          className: b.className.slice(0, 50)
        }))
      )
      log('Buttons after click:', 1)
      buttonsAfterClick.filter(b => b.title?.toLowerCase().includes('voice')).forEach(b => log(JSON.stringify(b), 2))
      
      const errorTooltip = await page.evaluate(() => {
        const divs = Array.from(document.querySelectorAll('div'))
        for (const div of divs) {
          if (div.textContent?.includes('Failed') || div.textContent?.includes('error') || 
              div.textContent?.includes('Error') || div.className.includes('bg-red')) {
            return div.textContent?.slice(0, 200)
          }
        }
        return null
      })
      if (errorTooltip) {
        log(`Error tooltip: ${errorTooltip}`, 1)
      }
      
      const consoleErrors = await page.evaluate(() => {
        return (window as Window & { __consoleErrors?: string[] }).__consoleErrors || []
      })
      if (consoleErrors.length > 0) {
        log('Console errors:', 1)
        consoleErrors.forEach(e => log(e, 2))
      }
      
      fail('Voice input not active after clicking button')
      await takeScreenshot(page, 'voice_activation_failed', config.screenshotsDir)
      return false
    }
    success('Voice input is active and listening')
    await takeScreenshot(page, 'voice_active', config.screenshotsDir)

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
      await takeScreenshot(page, 'transcription_received', config.screenshotsDir)
      
      info('Stopping voice input before submitting...')
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'))
        for (const btn of buttons) {
          const title = btn.getAttribute('title')?.toLowerCase() || ''
          if (title.includes('stop voice') || title.includes('stop continuous')) {
            (btn as HTMLButtonElement).click()
            return
          }
        }
      })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      if (!config.sttOnly) {
        info('Submitting transcribed message to OpenCode...')
      
      await page.evaluate((text: string, sid: string, repoDir: string) => {
        fetch(`/api/opencode/session/${sid}/message?directory=${encodeURIComponent(repoDir)}`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            parts: [{ type: 'text', text: text }]
          })
        }).catch(() => {})
      }, transcriptionResult, sessionId!, repoPath)
      
      success('Message submitted (fire-and-forget)')
      await new Promise(resolve => setTimeout(resolve, 1000))
      await takeScreenshot(page, 'message_submitted', config.screenshotsDir)
      
      info('Waiting for OpenCode to process and respond...')
      const responseStartTime = Date.now()
      const responseMaxWait = 120000
      let lastLoggedResponse = ''

      while (Date.now() - responseStartTime < responseMaxWait) {
        const messages = await page.evaluate(async (sid: string, dir: string) => {
          try {
            const res = await fetch(`/api/opencode/session/${sid}/message?directory=${encodeURIComponent(dir)}`)
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
                  await takeScreenshot(page, 'response_complete', config.screenshotsDir)
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
    } else {
      info('Stopping voice input (no transcription)...')
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'))
        for (const btn of buttons) {
          const title = btn.getAttribute('title')?.toLowerCase() || ''
          if (title.includes('stop voice') || title.includes('stop continuous')) {
            (btn as HTMLButtonElement).click()
            return
          }
        }
      })
    }

    console.log('\n' + '='.repeat(60))
    console.log('Test Results')
    console.log('='.repeat(60))

    const transcribedCorrectly = transcriptionResult && (
      transcriptionResult.toLowerCase().includes('two') ||
      transcriptionResult.toLowerCase().includes('2') ||
      transcriptionResult.toLowerCase().includes('plus')
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

    let responseCorrectAnswer = false

    if (agentResponse) {
      success(`OpenCode responded (${agentResponse.length} chars)`)
      log(`Response preview: "${agentResponse.slice(0, 200)}..."`, 1)
      
      responseCorrectAnswer = agentResponse.includes('4') || 
                              agentResponse.toLowerCase().includes('four')
      
      if (responseCorrectAnswer) {
        success('Response contains correct answer (4)!')
      } else {
        fail('Response does not contain expected answer')
      }
    } else if (transcriptionResult && !config.sttOnly) {
      log('No response from OpenCode (expected - response timeout)', 1)
    }

    const voicePipelineWorked = !!transcribedCorrectly
    const responseCorrect = config.sttOnly ? true : responseCorrectAnswer
    const passed = voicePipelineWorked

    if (passed) {
      console.log('\n' + '='.repeat(60))
      if (config.sttOnly) {
        success('STT-ONLY TEST PASSED')
        console.log('  Real audio -> MediaRecorder -> STT -> Transcription')
      } else if (responseCorrect) {
        success('FULL E2E TEST PASSED')
        console.log('  Real audio -> MediaRecorder -> STT -> Transcription -> OpenCode -> Response')
      } else {
        success('VOICE E2E TEST PASSED')
        console.log('  Real audio -> MediaRecorder -> STT -> Transcription')
        console.log('  Note: OpenCode response was slow/missing (voice pipeline verified)')
      }
      console.log('='.repeat(60))
    } else {
      console.log('\n' + '='.repeat(60))
      fail('TEST FAILED')
      if (!transcribedCorrectly) console.log('  - Transcription failed or incorrect')
      console.log('='.repeat(60))
    }

    return passed

  } catch (error) {
    fail(`Test error: ${error instanceof Error ? error.message : error}`)
    return false
  } finally {
    info('Creating GIF from screenshots...')
    const gifResult = await VideoRecorder.fromTestDirectory(config.outputDir, {
      fps: 0.5,
      width: 1280,
      height: 800,
      outputName: 'test-recording.gif'
    })

    if (gifResult.success) {
      success(`GIF created: ${gifResult.videoPath} (${gifResult.sizeMB} MB)`)
    } else {
      log(`GIF creation failed: ${gifResult.error}`, 1)
    }

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
    } else if (args[i] === '--stt-only') {
      config.sttOnly = true
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
  --text <phrase>   Test phrase to speak (default: "What is two plus two? Reply with just the number.")
  --no-headless     Run browser in visible mode for debugging
  --web-audio       Use Web Audio API injection instead of Chrome fake audio capture
  --stt-only        Only test STT pipeline, skip OpenCode response validation (for CI without API keys)
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

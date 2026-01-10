#!/usr/bin/env bun

import puppeteer, { Browser, Page } from 'puppeteer'
import { spawn } from 'child_process'
import { existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

interface TestConfig {
  baseUrl: string
  username: string
  password: string
  testPhrase: string
  headless: boolean
  timeout: number
}

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.OPENCODE_URL || 'http://localhost:5001',
  username: process.env.OPENCODE_USER || '',
  password: process.env.OPENCODE_PASS || '',
  testPhrase: 'What is two plus two?',
  headless: true,
  timeout: 120000,
}

function log(message: string, indent = 0) {
  const prefix = '  '.repeat(indent)
  console.log(`${prefix}${message}`)
}

function success(message: string) {
  log(`PASS ${message}`)
}

function fail(message: string) {
  log(`FAIL ${message}`)
}

function info(message: string) {
  log(`INFO  ${message}`)
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

async function generateTestAudio(text: string): Promise<string | null> {
  const wavPath = join(tmpdir(), `talk-mode-test-${Date.now()}.wav`)
  const aiffPath = wavPath.replace('.wav', '.aiff')
  
  info(`Generating test audio: "${text}"`)
  
  const sayResult = await execCommand('say', ['-o', aiffPath, text])
  if (sayResult.code !== 0) {
    fail(`say command failed: ${sayResult.stderr}`)
    return null
  }

  const ffmpegResult = await execCommand('ffmpeg', [
    '-y', '-i', aiffPath, '-ar', '16000', '-ac', '1', wavPath
  ])
  
  try { unlinkSync(aiffPath) } catch {}
  
  if (ffmpegResult.code !== 0) {
    fail(`ffmpeg conversion failed: ${ffmpegResult.stderr}`)
    return null
  }
  
  if (!existsSync(wavPath)) {
    fail('Failed to create test audio file')
    return null
  }
  
  success(`Generated test audio: ${wavPath}`)
  return wavPath
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

async function runRealAudioTest(config: TestConfig) {
  console.log('\nTalk Mode Real Audio E2E Test')
  console.log('='.repeat(60))
  console.log(`URL: ${config.baseUrl}`)
  console.log(`Test Phrase: "${config.testPhrase}"`)
  console.log(`Headless: ${config.headless}`)
  console.log('='.repeat(60))

  const audioPath = await generateTestAudio(config.testPhrase)
  if (!audioPath) {
    fail('Cannot run test without audio file')
    return false
  }

  let browser: Browser | null = null
  
  try {
    info('Launching browser with fake audio device...')
    browser = await puppeteer.launch({
      headless: config.headless,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${audioPath}`,
        '--autoplay-policy=no-user-gesture-required',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ]
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
          text.includes('Error') || text.includes('error') || text.includes('speech')) {
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
              success(`Real STT transcription: "${data.text}"`)
            }
          }
        } catch {
          sttRequests.push({ url, status })
        }
      }
    })

    info('Loading page...')
    await page.goto(config.baseUrl, { waitUntil: 'networkidle2', timeout: 60000 })
    success('Page loaded')

    await page.waitForFunction(() => document.querySelector('button') !== null, { timeout: 15000 })
    success('App rendered')

    info('Navigating to first available repo...')
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
    success(`Found repo: ${repos[0].repoUrl} (id: ${repoId})`)

    info('Getting or creating session...')
    let sessionId: string | null = null

    const sessions = await page.evaluate(async (directory: string) => {
      try {
        const response = await fetch(`/api/opencode/sessions?directory=${encodeURIComponent(directory)}`)
        if (!response.ok) return []
        return await response.json()
      } catch { return [] }
    }, repos[0].fullPath)

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
      }, repos[0].fullPath)

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

    info('Verifying STT is working via API...')
    const sttStatus = await page.evaluate(async () => {
      const response = await fetch('/api/stt/status')
      return response.json()
    })
    
    if (!sttStatus.server?.running) {
      fail(`STT server not running: ${JSON.stringify(sttStatus)}`)
      return false
    }
    success('STT server is running')

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

    info('Starting Talk Mode (will use fake audio capture)...')
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

    info('Audio is being captured from fake device...')
    info('Waiting for STT transcription from real audio pipeline...')
    
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

    console.log('\n' + '='.repeat(60))
    console.log('Test Results')
    console.log('='.repeat(60))

    if (transcriptionResult) {
      success(`Real audio was transcribed by STT: "${transcriptionResult}"`)
      
      const expectedWords = config.testPhrase.toLowerCase().split(/\s+/)
      const transcribedWords = transcriptionResult.toLowerCase().split(/\s+/)
      const matches = expectedWords.filter(w => transcribedWords.some(tw => tw.includes(w) || w.includes(tw)))
      const accuracy = Math.round((matches.length / expectedWords.length) * 100)
      
      if (accuracy >= 50) {
        success(`Transcription accuracy: ${accuracy}% (${matches.length}/${expectedWords.length} words matched)`)
        success('Real audio STT pipeline is working!')
        return true
      } else {
        fail(`Low transcription accuracy: ${accuracy}%`)
        log(`Expected: "${config.testPhrase}"`, 1)
        log(`Got: "${transcriptionResult}"`, 1)
        return false
      }
    } else {
      fail('No transcription received from real audio pipeline')
      log(`Total STT requests made: ${sttRequests.length}`, 1)
      
      if (sttRequests.length === 0) {
        fail('No STT requests were made - audio capture may not be working')
        log('This could mean:', 1)
        log('- MediaRecorder is not capturing audio from fake device', 2)
        log('- VAD (Voice Activity Detection) is not detecting speech', 2)
        log('- The audio file may be too short or have no speech content', 2)
      } else {
        fail('STT requests were made but no successful transcription')
        sttRequests.forEach((req, i) => {
          log(`Request ${i + 1}: ${req.status} - ${req.body?.slice(0, 100) || 'no body'}`, 2)
        })
      }
      return false
    }

  } catch (error) {
    fail(`Test error: ${error instanceof Error ? error.message : error}`)
    return false
  } finally {
    if (browser) {
      await browser.close()
    }
    
    if (audioPath) {
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
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Talk Mode Real Audio E2E Test

Tests the complete Talk Mode flow with REAL audio capture:
1. Generates test audio using macOS 'say' command
2. Launches Chrome with --use-file-for-fake-audio-capture
3. Starts Talk Mode which captures audio via getUserMedia()
4. Audio flows through MediaRecorder -> STT API -> Whisper
5. Verifies the transcription matches the test phrase

This test verifies the ACTUAL audio pipeline works, not just the
transcript injection path. It will FAIL if:
- STT server is not running
- Audio capture doesn't work
- Whisper transcription fails

Requirements:
- macOS with 'say' command
- ffmpeg installed
- Whisper server running

Usage: bun run scripts/test-talkmode-browser.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5001)
  --user <username> Username for basic auth
  --pass <password> Password for basic auth
  --text <phrase>   Test phrase to speak (default: "What is two plus two?")
  --no-headless     Run browser in visible mode for debugging
  --help, -h        Show this help
`)
      process.exit(0)
    }
  }

  const passed = await runRealAudioTest(config)
  process.exit(passed ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

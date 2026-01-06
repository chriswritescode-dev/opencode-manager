#!/usr/bin/env bun

import puppeteer, { Browser } from 'puppeteer'
import { spawnSync } from 'child_process'
import { existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

interface TestConfig {
  baseUrl: string
  username: string
  password: string
  testPhrase: string
  headless: boolean
}

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.OPENCODE_URL || 'http://localhost:5001',
  username: process.env.OPENCODE_USER || '',
  password: process.env.OPENCODE_PASS || '',
  testPhrase: 'What is two plus two?',
  headless: true,
}

function log(message: string, indent = 0) {
  const prefix = '  '.repeat(indent)
  console.log(`${prefix}${message}`)
}

function success(message: string) { log(`✅ ${message}`) }
function fail(message: string) { log(`❌ ${message}`) }
function info(message: string) { log(`ℹ️  ${message}`) }

function generateTestAudioWav(phrase: string): string {
  const tempDir = tmpdir()
  const aiffPath = join(tempDir, `test-audio-${Date.now()}.aiff`)
  const wavPath = join(tempDir, `test-audio-${Date.now()}.wav`)

  spawnSync('say', ['-o', aiffPath, phrase], { stdio: 'pipe' })

  if (!existsSync(aiffPath)) {
    throw new Error('Failed to generate speech audio')
  }

  // Chrome's fake audio capture requires specific format:
  // PCM 16-bit, mono or stereo, 16kHz/44.1kHz/48kHz
  spawnSync('ffmpeg', [
    '-y', '-i', aiffPath,
    '-ar', '48000',
    '-ac', '1',
    '-sample_fmt', 's16',
    '-t', '5',  // 5 seconds max
    wavPath
  ], { stdio: 'pipe' })

  unlinkSync(aiffPath)

  if (!existsSync(wavPath)) {
    throw new Error('Failed to convert to WAV')
  }

  return wavPath
}

async function runRealAudioTest(config: TestConfig): Promise<boolean> {
  console.log('\n🎤 Talk Mode E2E Test with Real Audio Injection')
  console.log('━'.repeat(60))
  console.log(`URL: ${config.baseUrl}`)
  console.log(`Test Phrase: "${config.testPhrase}"`)
  console.log('━'.repeat(60))

  info('Generating test audio file...')
  const wavPath = generateTestAudioWav(config.testPhrase)
  success(`Generated: ${wavPath}`)

  let browser: Browser | null = null

  try {
    info('Launching browser with audio file injection...')
    browser = await puppeteer.launch({
      headless: config.headless,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${wavPath}`,
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

    const sttCalls: { status: number; text?: string }[] = []
    
    page.on('response', async response => {
      if (response.url().includes('/stt/transcribe')) {
        const status = response.status()
        let text: string | undefined
        if (status === 200) {
          try {
            const json = await response.json()
            text = json.text
          } catch {}
        }
        sttCalls.push({ status, text })
        log(`[STT] Status: ${status}${text ? ` - "${text}"` : ''}`, 1)
      }
    })

    page.on('console', msg => {
      const text = msg.text()
      if (text.includes('StreamingVAD') || text.includes('Transcript')) {
        log(`[Browser] ${text}`, 1)
      }
    })

    info('Loading page...')
    await page.goto(config.baseUrl, { waitUntil: 'networkidle2', timeout: 60000 })
    success('Page loaded')

    await new Promise(resolve => setTimeout(resolve, 2000))

    info('Getting first repo...')
    const repos = await page.evaluate(async () => {
      const response = await fetch('/api/repos')
      return response.json()
    })

    if (!repos?.length) {
      fail('No repos available')
      return false
    }

    const repoId = repos[0].id
    success(`Found repo: ${repos[0].repoUrl}`)

    info('Creating session...')
    const session = await page.evaluate(async (directory: string) => {
      const response = await fetch('/api/opencode/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-opencode-dir': directory },
        body: JSON.stringify({})
      })
      return response.json()
    }, repos[0].fullPath)

    if (!session?.id) {
      fail('Failed to create session')
      return false
    }
    success(`Session: ${session.id}`)

    await page.goto(`${config.baseUrl}/repos/${repoId}/sessions/${session.id}`, {
      waitUntil: 'networkidle2',
      timeout: 60000
    })

    await new Promise(resolve => setTimeout(resolve, 3000))

    info('Finding Talk Mode button...')
    const buttonSelector = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      for (const btn of buttons) {
        const title = btn.getAttribute('title')?.toLowerCase() || ''
        if (title.includes('talk mode')) {
          return `button[title="${btn.getAttribute('title')}"]`
        }
      }
      return null
    })

    if (!buttonSelector) {
      fail('Talk Mode button not found')
      return false
    }
    success('Found Talk Mode button')

    info('Starting Talk Mode (audio will be captured from file)...')
    await page.click(buttonSelector)

    // Wait for streaming VAD to initialize and start processing
    await new Promise(resolve => setTimeout(resolve, 2000))

    const initialState = await page.evaluate(() => {
      const api = (window as any).__TALK_MODE_TEST__
      return api?.getState()
    })
    
    if (initialState?.state !== 'listening') {
      fail(`Talk Mode not listening: ${initialState?.state}`)
      return false
    }
    success('Talk Mode is listening')

    // Wait for audio to be captured and processed (up to 15 seconds)
    // The streaming VAD sends chunks every 2.5s
    info('Waiting for audio capture and STT processing...')
    
    let transcription: string | null = null
    const startTime = Date.now()
    const maxWait = 20000

    while (Date.now() - startTime < maxWait) {
      // Check for successful STT transcriptions
      const successfulStt = sttCalls.find(c => c.status === 200 && c.text)
      if (successfulStt?.text) {
        transcription = successfulStt.text
        success(`STT transcribed: "${transcription}"`)
        break
      }

      // Also check live transcript in the app
      const state = await page.evaluate(() => {
        const api = (window as any).__TALK_MODE_TEST__
        return api?.getState()
      })

      if (state?.liveTranscript) {
        transcription = state.liveTranscript
        success(`Live transcript: "${transcription}"`)
        break
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (!transcription) {
      fail('No transcription received')
      log(`STT calls made: ${sttCalls.length}`, 1)
      sttCalls.forEach((c, i) => log(`  Call ${i + 1}: status=${c.status}`, 1))
      
      // Check if audio file was valid
      info('Checking if audio reached STT API...')
      if (sttCalls.length === 0) {
        fail('No STT API calls made - MediaRecorder may not be capturing audio')
      } else if (sttCalls.every(c => c.status === 500)) {
        fail('All STT calls failed with 500 - audio format may be invalid')
      }
      return false
    }

    // Now wait for the full flow to complete
    info('Waiting for silence detection and OpenCode response...')
    
    let response: string | null = null
    const responseStartTime = Date.now()

    while (Date.now() - responseStartTime < 30000) {
      const state = await page.evaluate(() => {
        const api = (window as any).__TALK_MODE_TEST__
        return api?.getState()
      })

      if (state?.agentResponse) {
        response = state.agentResponse
        break
      }

      // If we're back to listening, check messages API
      if (state?.state === 'listening' && state?.userTranscript) {
        const messages = await page.evaluate(async (sid: string) => {
          const res = await fetch(`/api/opencode/session/${sid}/message`)
          return res.json()
        }, session.id)

        const assistantMsg = messages?.find((m: any) => m.info?.role === 'assistant')
        if (assistantMsg) {
          const textPart = assistantMsg.parts?.find((p: any) => p.type === 'text')
          if (textPart?.text) {
            response = textPart.text
            break
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Stop Talk Mode
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

    // Results
    console.log('\n' + '═'.repeat(60))
    console.log('Test Results')
    console.log('═'.repeat(60))

    const transcribedCorrectly = transcription && 
      (transcription.toLowerCase().includes('two') || transcription.includes('2')) &&
      transcription.toLowerCase().includes('plus')

    if (transcribedCorrectly) {
      success(`Audio transcribed correctly: "${transcription}"`)
    } else {
      fail(`Transcription mismatch: "${transcription}"`)
    }

    if (response) {
      success(`OpenCode responded: "${response.slice(0, 100)}"`)
      if (response.includes('4') || response.toLowerCase().includes('four')) {
        success('Response contains correct answer!')
      } else {
        fail('Response does not contain expected answer (4)')
      }
    } else {
      fail('No response from OpenCode')
    }

    const responseCorrect = response && (response.includes('4') || response.toLowerCase().includes('four'))
    const passed = !!transcribedCorrectly && !!responseCorrect
    
    if (passed) {
      console.log('\n✅ FULL E2E TEST PASSED')
      console.log('   Real audio → MediaRecorder → STT → Transcription → OpenCode → Response verified!')
    } else {
      console.log('\n❌ TEST FAILED')
      if (!transcribedCorrectly) console.log('   - Transcription failed or incorrect')
      if (!responseCorrect) console.log('   - OpenCode response missing or incorrect')
    }

    return passed

  } catch (error) {
    fail(`Test error: ${error instanceof Error ? error.message : error}`)
    return false
  } finally {
    if (browser) {
      await browser.close()
    }
    if (existsSync(wavPath)) {
      unlinkSync(wavPath)
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
    else if (args[i] === '--text' && args[i + 1]) config.testPhrase = args[++i]
    else if (args[i] === '--no-headless') config.headless = false
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Talk Mode E2E Test with Real Audio

Injects a real audio file into Chrome's fake microphone device to test
the complete Talk Mode pipeline:

  Audio File → Fake Mic → MediaRecorder → STT API → Transcription → OpenCode

Usage: bun run scripts/test-talkmode-real-audio.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5001)
  --user <username> Basic auth username
  --pass <password> Basic auth password
  --text <phrase>   Test phrase (default: "What is two plus two?")
  --no-headless     Show browser window
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

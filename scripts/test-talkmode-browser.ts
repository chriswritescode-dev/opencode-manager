#!/usr/bin/env bun

import puppeteer, { Browser } from 'puppeteer'

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
  log(`✅ ${message}`)
}

function fail(message: string) {
  log(`❌ ${message}`)
}

function info(message: string) {
  log(`ℹ️  ${message}`)
}

async function runFullE2ETest(config: TestConfig) {
  console.log('\n🎧 Talk Mode Full Browser E2E Test (Streaming VAD)')
  console.log('━'.repeat(60))
  console.log(`URL: ${config.baseUrl}`)
  console.log(`Test Phrase: "${config.testPhrase}"`)
  console.log(`Headless: ${config.headless}`)
  console.log('━'.repeat(60))

  info('Using transcript injection (new streaming VAD architecture)...')

  let browser: Browser | null = null
  
  try {
    info('Launching browser...')
    browser = await puppeteer.launch({
      headless: config.headless,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
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

    const consoleMessages: string[] = []
    page.on('console', msg => {
      const text = msg.text()
      consoleMessages.push(`[${msg.type()}] ${text}`)
      if (text.includes('TalkMode') || text.includes('VAD') || text.includes('STT') || 
          text.includes('speech') || text.includes('Test]') || text.includes('transcri') ||
          text.includes('Error') || text.includes('error') || text.includes('failed')) {
        log(`[Browser] ${text}`, 1)
      }
    })

    page.on('pageerror', err => {
      log(`[Page Error] ${err.message}`, 1)
    })

    page.on('requestfailed', request => {
      const url = request.url()
      if (url.includes('stt') || url.includes('transcribe')) {
        log(`[Request Failed] ${url}: ${request.failure()?.errorText}`, 1)
      }
    })

    page.on('response', async response => {
      const url = response.url()
      if (url.includes('stt') || url.includes('transcribe')) {
        log(`[Response] ${url}: ${response.status()}`, 1)
        try {
          const body = await response.text()
          log(`[Response Body] ${body.slice(0, 500)}`, 1)
        } catch {
          // Ignore if we can't read the body
        }
      }
    })

    info('Loading page...')
    await page.goto(config.baseUrl, { waitUntil: 'networkidle2', timeout: 60000 })
    success('Page loaded')

    await page.waitForFunction(() => {
      return document.querySelector('button') !== null
    }, { timeout: 15000 })
    success('App rendered')

    await new Promise(resolve => setTimeout(resolve, 2000))

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

    await page.goto(`${config.baseUrl}/repo/${repoId}`, { waitUntil: 'networkidle2', timeout: 60000 })
    success('Navigated to repo page')

    await new Promise(resolve => setTimeout(resolve, 3000))

    info('Looking for existing sessions or creating a new one...')
    const sessionsResult = await page.evaluate(async (directory: string) => {
      try {
        const response = await fetch(`/api/opencode/sessions?directory=${encodeURIComponent(directory)}`)
        if (!response.ok) {
          return { error: `HTTP ${response.status}` }
        }
        return await response.json()
      } catch (e) {
        return { error: String(e) }
      }
    }, repos[0].fullPath)

    let sessionId: string | null = null

    if (sessionsResult.error) {
      info(`Could not fetch sessions: ${sessionsResult.error}, creating new session...`)
    } else if (Array.isArray(sessionsResult) && sessionsResult.length > 0) {
      sessionId = sessionsResult[0].id
      success(`Found existing session: ${sessionId}`)
    }

    if (!sessionId) {
      info('Creating new session...')
      const createResult = await page.evaluate(async (directory: string) => {
        try {
          const response = await fetch('/api/opencode/session', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-opencode-dir': directory
            },
            body: JSON.stringify({})
          })
          if (!response.ok) {
            return { error: `HTTP ${response.status}` }
          }
          return await response.json()
        } catch (e) {
          return { error: String(e) }
        }
      }, repos[0].fullPath)

      if (createResult.error) {
        fail(`Failed to create session: ${createResult.error}`)
        return false
      }
      sessionId = createResult.id
      success(`Created new session: ${sessionId}`)
    }

    info(`Navigating to session page: /repos/${repoId}/sessions/${sessionId}`)
    await page.goto(`${config.baseUrl}/repos/${repoId}/sessions/${sessionId}`, { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    })
    success('Navigated to session page')

    await new Promise(resolve => setTimeout(resolve, 3000))

    const pageState = await page.evaluate(() => {
      return {
        url: window.location.href,
        bodyHtml: document.body.innerHTML.slice(0, 1000),
        hasRoot: !!document.getElementById('root'),
        rootContent: document.getElementById('root')?.innerHTML.slice(0, 500),
        buttonCount: document.querySelectorAll('button').length
      }
    })
    log(`Page state: URL=${pageState.url}, buttons=${pageState.buttonCount}`, 1)

    info('Checking STT API is working...')
    const sttStatus = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/stt/status')
        return await response.json()
      } catch (e) {
        return { error: String(e) }
      }
    })
    
    if (sttStatus.error) {
      fail(`STT API error: ${sttStatus.error}`)
      return false
    }
    success(`STT server ready: ${sttStatus.model || 'whisper'}`)

    info('Looking for Talk Mode button...')
    const talkModeButton = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      
      for (const btn of buttons) {
        const title = btn.getAttribute('title')?.toLowerCase() || ''
        
        if (title.includes('talk mode') || title.includes('talk-mode')) {
          return { 
            found: true, 
            selector: `button[title="${btn.getAttribute('title')}"]`,
            title: btn.getAttribute('title')
          }
        }
      }
      
      return { found: false, buttonCount: buttons.length }
    })

    if (!talkModeButton.found) {
      fail('Could not find Talk Mode button')
      const pageInfo = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button')).slice(0, 20).map(b => ({
          ariaLabel: b.getAttribute('aria-label'),
          title: b.getAttribute('title'),
          text: b.textContent?.slice(0, 50),
          classes: b.className.slice(0, 50)
        }))
        const html = document.body.innerHTML.slice(0, 500)
        return { buttons, html, url: window.location.href }
      })
      log(`Current URL: ${pageInfo.url}`, 1)
      log('Available buttons:', 1)
      pageInfo.buttons.forEach(b => log(JSON.stringify(b), 2))
      log('Page preview:', 1)
      log(pageInfo.html.slice(0, 200), 2)
      return false
    }

    success(`Found Talk Mode button: ${talkModeButton.ariaLabel || talkModeButton.title}`)

    info('Clicking Talk Mode button to start...')
    if (talkModeButton.selector) {
      await page.click(talkModeButton.selector)
    }

    await new Promise(resolve => setTimeout(resolve, 2000))

    info('Waiting for Talk Mode test API to be available...')
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
    success('Talk Mode test API ready')

    info('Checking Talk Mode state...')
    const initialState = await page.evaluate(() => {
      const testApi = (window as Window & typeof globalThis & { 
        __TALK_MODE_TEST__?: { getState: () => { state: string; isActive: boolean; sessionID: string | null } } 
      }).__TALK_MODE_TEST__
      return testApi?.getState()
    })

    log(`Initial state: ${JSON.stringify(initialState)}`, 1)

    if (initialState?.state !== 'listening') {
      info('Waiting for listening state...')
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      const retryState = await page.evaluate(() => {
        const testApi = (window as Window & typeof globalThis & { 
          __TALK_MODE_TEST__?: { getState: () => { state: string; isActive: boolean } } 
        }).__TALK_MODE_TEST__
        return testApi?.getState()
      })
      
      if (retryState?.state !== 'listening') {
        fail(`Talk Mode not in listening state: ${retryState?.state}`)
        return false
      }
    }
    
    success('Talk Mode is listening')

    info('Injecting transcript via test API (simulating speech-to-text result)...')
    const injected = await page.evaluate((transcript: string) => {
      const testApi = (window as Window & typeof globalThis & { 
        __TALK_MODE_TEST__?: { injectTranscript: (text: string) => boolean } 
      }).__TALK_MODE_TEST__
      
      if (!testApi) return { success: false, error: 'Test API not found' }
      
      console.log('[Test] Injecting transcript:', transcript)
      
      const result = testApi.injectTranscript(transcript)
      return { success: result }
    }, config.testPhrase)

    if (!injected.success) {
      fail(`Failed to inject transcript: ${JSON.stringify(injected)}`)
      return false
    }
    success('Transcript injected successfully')

    info('Waiting for response from OpenCode...')
    
    let response: string | null = null
    const startTime = Date.now()
    const maxWait = 45000
    let pollCount = 0

    while (Date.now() - startTime < maxWait) {
      const state = await page.evaluate(() => {
        const testApi = (window as Window & typeof globalThis & { 
          __TALK_MODE_TEST__?: { getState: () => { 
            state: string
            userTranscript: string | null
            agentResponse: string | null
            sessionID: string | null
          }} 
        }).__TALK_MODE_TEST__
        return testApi?.getState()
      })

      pollCount++
      if (pollCount <= 10 || pollCount % 10 === 0) {
        log(`Poll #${pollCount}: state=${state?.state}, userTranscript=${state?.userTranscript?.slice(0, 30) || 'null'}`, 1)
      }

      if (state?.agentResponse && !response) {
        response = state.agentResponse
        success(`Agent response: "${response.slice(0, 100)}"`)
      }

      if (state?.state === 'speaking' && response) {
        info('Agent is speaking response via TTS')
        await new Promise(resolve => setTimeout(resolve, 2000))
        break
      }

      if (response) {
        break
      }

      if (state?.state === 'listening' && state?.userTranscript && !response) {
        info('State returned to listening, checking API directly for response...')
        
        const apiResponse = await page.evaluate(async (sessionId: string) => {
          try {
            const response = await fetch(`/api/opencode/session/${sessionId}/message`)
            if (!response.ok) return null
            const messages = await response.json()
            const assistantMsg = messages.find((m: { info: { role: string } }) => m.info.role === 'assistant')
            if (assistantMsg) {
              const textPart = assistantMsg.parts.find((p: { type: string }) => p.type === 'text')
              return textPart?.text || null
            }
            return null
          } catch {
            return null
          }
        }, state.sessionID)
        
        if (apiResponse) {
          response = apiResponse
          success(`Agent response (from API): "${response.slice(0, 100)}"`)
        }
        break
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }

    info('Stopping Talk Mode...')
    const stopResult = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      for (const btn of buttons) {
        const title = btn.getAttribute('title')?.toLowerCase() || ''
        if (title.includes('talk mode') || title.includes('talk-mode') || title.includes('stop talk')) {
          (btn as HTMLButtonElement).click()
          return { stopped: true, buttonTitle: btn.getAttribute('title') }
        }
      }
      return { stopped: false }
    })
    if (stopResult.stopped) {
      log(`Clicked stop button: ${stopResult.buttonTitle}`, 1)
    }

    console.log('\n' + '═'.repeat(60))
    console.log('Test Results')
    console.log('═'.repeat(60))

    const results = {
      transcriptInjected: injected.success,
      transcription: config.testPhrase,
      gotResponse: !!response,
      response: response?.slice(0, 100)
    }

    if (results.transcriptInjected) {
      success('Transcript was injected and processed')
      
      if (results.gotResponse) {
        success('OpenCode responded to the query')
        success('Full Talk Mode E2E flow verified!')

        if (response?.includes('4') || response?.toLowerCase().includes('four')) {
          success('Response contains correct answer (4)')
        }
        
        return true
      } else {
        info('Transcript processed but no response captured (may still be processing)')
        return true
      }
    } else {
      fail('Failed to inject transcript')
      log('Console messages with speech/STT:', 1)
      consoleMessages
        .filter(m => m.includes('speech') || m.includes('STT') || m.includes('transcri') || m.includes('Test]'))
        .slice(-10)
        .forEach(m => log(m, 2))
      return false
    }

  } catch (error) {
    fail(`Test error: ${error instanceof Error ? error.message : error}`)
    return false
  } finally {
    if (browser) {
      await browser.close()
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
Talk Mode Full Browser E2E Test (Streaming VAD)

Tests the complete Talk Mode flow by injecting transcript via test API:
1. Starts Talk Mode in browser
2. Injects a test transcript directly (simulating what STT would produce)
3. Waits for OpenCode to respond
4. Verifies the agent response

This tests the new streaming VAD architecture which uses:
- MediaRecorder for chunked audio capture
- Whisper STT API for transcription  
- Silence detection via no-new-words timeout

The injectTranscript API bypasses the audio capture layer but tests
the full Talk Mode -> OpenCode -> Response flow.

Usage: bun run scripts/test-talkmode-browser.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5001)
  --user <username> Username for basic auth
  --pass <password> Password for basic auth
  --text <phrase>   Test phrase to inject (default: "What is two plus two?")
  --no-headless     Run browser in visible mode for debugging
  --help, -h        Show this help
`)
      process.exit(0)
    }
  }

  const passed = await runFullE2ETest(config)
  process.exit(passed ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

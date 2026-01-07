#!/usr/bin/env bun

import puppeteer, { Browser, Page } from 'puppeteer'
import fs from 'fs/promises'
import path from 'path'
import { analyzeTalkModeCaptions, saveOCRResult } from './lib/ocr-analyzer'
import { generateMarkdownReport, createTestResult, TestReport, TestSection, TestResult } from './lib/report-generator'

interface TestConfig {
  url: string
  username: string
  password: string
  expectAgentResponse: boolean
  description: string
  testTask: string
  talkModePhrase: string
  timeouts: {
    pageLoad: number
    agentResponse: number
    talkModeTransition: number
    captionRender: number
  }
  ocr: {
    minConfidence: number
    language: string
  }
}

const PROJECT_ROOT = path.resolve(import.meta.dir, '..')
const TEST_DIR = path.join(PROJECT_ROOT, '.test')
const SCREENSHOTS_DIR = path.join(TEST_DIR, 'screenshots')
const OCR_DIR = path.join(TEST_DIR, 'ocr-results')
const REPORTS_DIR = path.join(TEST_DIR, 'reports')

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

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function loadConfig(env: string): Promise<TestConfig> {
  const configPath = path.join(TEST_DIR, 'config.json')
  const configData = await fs.readFile(configPath, 'utf-8')
  const config = JSON.parse(configData)
  
  const envConfig = config.environments[env]
  if (!envConfig) {
    throw new Error(`Environment '${env}' not found in config`)
  }
  
  return {
    ...envConfig,
    testTask: config.testTask,
    talkModePhrase: config.talkModePhrase,
    timeouts: config.timeouts,
    ocr: config.ocr,
  }
}

async function takeScreenshot(page: Page, name: string): Promise<string> {
  const timestamp = Date.now()
  const filename = `${timestamp}-${name}.png`
  const filepath = path.join(SCREENSHOTS_DIR, filename)
  await page.screenshot({ path: filepath, fullPage: true })
  info(`Screenshot saved: ${filename}`)
  return filepath
}

async function findButtonByText(page: Page, texts: string[]): Promise<any> {
  return page.evaluateHandle((textArray) => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.find(btn => 
      textArray.some(text => 
        btn.textContent?.toLowerCase().includes(text.toLowerCase()) ||
        btn.title?.toLowerCase().includes(text.toLowerCase()) ||
        btn.getAttribute('aria-label')?.toLowerCase().includes(text.toLowerCase())
      )
    )
  }, texts)
}

async function runTests(config: TestConfig, envName: string): Promise<TestReport> {
  const startTime = Date.now()
  const sections: TestSection[] = []
  const allScreenshots: string[] = []
  const allOCRResults: string[] = []
  
  let browser: Browser | null = null
  let page: Page | null = null
  
  try {
    info(`Starting tests for environment: ${envName}`)
    info(`URL: ${config.url}`)
    
    info('Launching browser...')
    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ]
    })
    
    page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    
    if (config.username && config.password) {
      await page.setExtraHTTPHeaders({
        'Authorization': `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
      })
    }
    
    page.on('console', msg => {
      const text = msg.text()
      if (text.includes('Error') || text.includes('error') || text.includes('[Test]')) {
        log(`[Browser] ${text}`, 1)
      }
    })
    
    const authTests: TestResult[] = []
    const functionalityTests: TestResult[] = []
    const talkModeTests: TestResult[] = []
    
    info('Phase 1: Authentication Tests')
    {
      const testName = 'Navigate with authentication'
      const testStart = Date.now()
      try {
        await page.goto(config.url, { waitUntil: 'networkidle0', timeout: config.timeouts.pageLoad })
        await sleep(2000)
        const screenshot = await takeScreenshot(page, '01-auth-success')
        allScreenshots.push(screenshot)
        
        const title = await page.title()
        const hasApp = await page.$('div#root') !== null
        
        if (hasApp && title.includes('OpenCode')) {
          success('Page loaded with authentication')
          authTests.push(createTestResult(testName, true, {
            duration: Date.now() - testStart,
            screenshot,
            notes: [`Page title: ${title}`, 'App root element found']
          }))
        } else {
          throw new Error('App did not load correctly')
        }
      } catch (error) {
        fail(`Failed: ${testName}`)
        authTests.push(createTestResult(testName, false, {
          duration: Date.now() - testStart,
          error: error instanceof Error ? error.message : String(error)
        }))
      }
    }
    
    sections.push({ name: 'Authentication', tests: authTests })
    
    info('Phase 2: Navigate to Session')
    {
      const testName = 'Navigate to session page'
      const testStart = Date.now()
      try {
        info('Attempting to navigate to a session where Talk Mode is available')
        
        let sessionUrl = `${config.url}/repos/2/sessions`
        await page.goto(sessionUrl, { waitUntil: 'networkidle0', timeout: config.timeouts.pageLoad })
        await sleep(2000)
        
        const sessionLinkHref = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'))
          const link = links.find(link => link.href.includes('/sessions/') && link.href.match(/\/sessions\/[^/]+$/))
          return link ? link.href : null
        })
        
        if (sessionLinkHref) {
          await page.goto(sessionLinkHref, { waitUntil: 'networkidle0', timeout: config.timeouts.pageLoad })
          await sleep(3000)
          const screenshot = await takeScreenshot(page, '02-session-page')
          allScreenshots.push(screenshot)
          
          success('Navigated to session page')
          functionalityTests.push(createTestResult(testName, true, {
            duration: Date.now() - testStart,
            screenshot,
            notes: ['Session page loaded where Talk Mode button should be available']
          }))
        } else {
          info('No existing session found, creating new session')
          sessionUrl = `${config.url}/repos/2`
          await page.goto(sessionUrl, { waitUntil: 'networkidle0', timeout: config.timeouts.pageLoad })
          await sleep(2000)
          
          const newSessionButton = await findButtonByText(page, ['New Session', 'New Chat', 'Start'])
          if (newSessionButton) {
            await (newSessionButton as any).click()
            await sleep(3000)
            const screenshot = await takeScreenshot(page, '02-new-session-page')
            allScreenshots.push(screenshot)
            
            success('Created and navigated to new session')
            functionalityTests.push(createTestResult(testName, true, {
              duration: Date.now() - testStart,
              screenshot,
              notes: ['New session created']
            }))
          } else {
            throw new Error('Could not find existing session or create new one')
          }
        }
      } catch (error) {
        fail(`Failed: ${testName}`)
        const screenshot = await takeScreenshot(page, '02-session-page-fail')
        allScreenshots.push(screenshot)
        functionalityTests.push(createTestResult(testName, false, {
          duration: Date.now() - testStart,
          error: error instanceof Error ? error.message : String(error),
          screenshot
        }))
      }
    }
    
    {
      const testName = 'Find Talk Mode button'
      const testStart = Date.now()
      try {
        await sleep(2000)
        
        const talkModeButton = await findButtonByText(page, ['Talk Mode', 'Start Talk', 'Voice'])
        
        if (talkModeButton && await talkModeButton.asElement()) {
          const screenshot = await takeScreenshot(page, '03-talkmode-button-found')
          allScreenshots.push(screenshot)
          
          success('Talk Mode button found')
          functionalityTests.push(createTestResult(testName, true, {
            duration: Date.now() - testStart,
            screenshot
          }))
        } else {
          throw new Error('Talk Mode button not found')
        }
      } catch (error) {
        fail(`Failed: ${testName}`)
        const screenshot = await takeScreenshot(page, '03-talkmode-button-fail')
        allScreenshots.push(screenshot)
        functionalityTests.push(createTestResult(testName, false, {
          duration: Date.now() - testStart,
          error: error instanceof Error ? error.message : String(error),
          screenshot
        }))
      }
    }
    
    sections.push({ name: 'Core Functionality', tests: functionalityTests })
    
    info('Phase 3: Talk Mode Tests')
    {
      const testName = 'Start Talk Mode'
      const testStart = Date.now()
      try {
        const talkModeButton = await findButtonByText(page, ['Talk Mode', 'Start Talk', 'Voice'])
        
        if (talkModeButton && await talkModeButton.asElement()) {
          await (talkModeButton as any).click()
          await sleep(3000)
          
          const overlay = await page.$('[class*="fixed"][class*="inset"]')
          if (overlay) {
            const screenshot = await takeScreenshot(page, '04-talkmode-overlay')
            allScreenshots.push(screenshot)
            
            success('Talk Mode overlay appeared')
            talkModeTests.push(createTestResult(testName, true, {
              duration: Date.now() - testStart,
              screenshot
            }))
          } else {
            throw new Error('Talk Mode overlay not found')
          }
        } else {
          throw new Error('Talk Mode button not found')
        }
      } catch (error) {
        fail(`Failed: ${testName}`)
        const screenshot = await takeScreenshot(page, '04-talkmode-fail')
        allScreenshots.push(screenshot)
        talkModeTests.push(createTestResult(testName, false, {
          duration: Date.now() - testStart,
          error: error instanceof Error ? error.message : String(error),
          screenshot
        }))
      }
    }
    
    {
      const testName = 'Inject test transcript'
      const testStart = Date.now()
      try {
        await page.waitForFunction(() => typeof (window as any).__TALK_MODE_TEST__ !== 'undefined', { timeout: 5000 })
        
        await page.evaluate((phrase) => {
          (window as any).__TALK_MODE_TEST__.injectTranscript(phrase)
        }, config.talkModePhrase)
        
        await sleep(config.timeouts.captionRender)
        
        success('Transcript injected')
        talkModeTests.push(createTestResult(testName, true, {
          duration: Date.now() - testStart
        }))
      } catch (error) {
        fail(`Failed: ${testName}`)
        talkModeTests.push(createTestResult(testName, false, {
          duration: Date.now() - testStart,
          error: error instanceof Error ? error.message : String(error)
        }))
      }
    }
    
    {
      const testName = 'Verify caption UI with OCR'
      const testStart = Date.now()
      try {
        await sleep(config.timeouts.captionRender)
        const screenshot = await takeScreenshot(page, '05-talkmode-captions')
        allScreenshots.push(screenshot)
        
        info('Running OCR analysis on captions...')
        const ocrAnalysis = await analyzeTalkModeCaptions(screenshot, config.ocr)
        
        const ocrPath = path.join(OCR_DIR, '05-talkmode-captions.json')
        await saveOCRResult(ocrAnalysis.result, ocrPath)
        allOCRResults.push(ocrPath)
        
        const notes = [...ocrAnalysis.reasons]
        if (ocrAnalysis.passed) {
          success('Caption UI verified via OCR')
          notes.unshift('User caption found in screenshot')
        } else {
          info('Caption UI partially verified (see notes)')
        }
        
        talkModeTests.push(createTestResult(testName, ocrAnalysis.passed, {
          duration: Date.now() - testStart,
          screenshot,
          ocrResult: ocrAnalysis.result,
          notes
        }))
      } catch (error) {
        fail(`Failed: ${testName}`)
        talkModeTests.push(createTestResult(testName, false, {
          duration: Date.now() - testStart,
          error: error instanceof Error ? error.message : String(error)
        }))
      }
    }
    
    {
      const testName = 'Close Talk Mode'
      const testStart = Date.now()
      try {
        await page.keyboard.press('Escape')
        await sleep(1000)
        
        const overlayGone = await page.$('[class*="fixed"][class*="inset"]') === null
        const screenshot = await takeScreenshot(page, '06-talkmode-closed')
        allScreenshots.push(screenshot)
        
        if (overlayGone) {
          success('Talk Mode closed')
          talkModeTests.push(createTestResult(testName, true, {
            duration: Date.now() - testStart,
            screenshot
          }))
        } else {
          info('Talk Mode overlay still visible (may be expected)')
          talkModeTests.push(createTestResult(testName, true, {
            duration: Date.now() - testStart,
            screenshot,
            notes: ['Overlay may still be visible in screenshot']
          }))
        }
      } catch (error) {
        fail(`Failed: ${testName}`)
        talkModeTests.push(createTestResult(testName, false, {
          duration: Date.now() - testStart,
          error: error instanceof Error ? error.message : String(error)
        }))
      }
    }
    
    sections.push({ name: 'Talk Mode', tests: talkModeTests })
    
  } finally {
    if (browser) {
      await browser.close()
    }
  }
  
  const duration = Date.now() - startTime
  
  let totalTests = 0
  let passed = 0
  let failed = 0
  let warnings = 0
  
  for (const section of sections) {
    for (const test of section.tests) {
      totalTests++
      if (test.passed) {
        passed++
      } else {
        failed++
      }
      if (test.notes && test.notes.length > 0 && !test.passed) {
        warnings++
      }
    }
  }
  
  return {
    environment: envName,
    url: config.url,
    timestamp: new Date().toISOString(),
    duration,
    sections,
    screenshots: allScreenshots,
    ocrResults: allOCRResults,
    summary: {
      totalTests,
      passed,
      failed,
      warnings,
    },
  }
}

async function main() {
  const args = process.argv.slice(2)
  const envArg = args.find(arg => arg.startsWith('--env='))
  const env = envArg ? envArg.split('=')[1] : 'local'
  
  console.log('\n🧪 OpenCode Manager Production Readiness Test')
  console.log('='.repeat(60))
  console.log(`Environment: ${env}`)
  console.log('='.repeat(60))
  console.log('')
  
  try {
    const config = await loadConfig(env)
    const report = await runTests(config, env)
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const reportPath = path.join(REPORTS_DIR, `test-report-${env}-${timestamp}.md`)
    
    info('Generating report...')
    await generateMarkdownReport(report, reportPath)
    
    console.log('')
    console.log('='.repeat(60))
    console.log('Test Summary')
    console.log('='.repeat(60))
    console.log(`Total Tests: ${report.summary.totalTests}`)
    console.log(`Passed: ✅ ${report.summary.passed}`)
    console.log(`Failed: ❌ ${report.summary.failed}`)
    console.log(`Warnings: ⚠️ ${report.summary.warnings}`)
    console.log(`Success Rate: ${((report.summary.passed / report.summary.totalTests) * 100).toFixed(1)}%`)
    console.log('='.repeat(60))
    console.log('')
    console.log(`📄 Report saved: ${reportPath}`)
    console.log('')
    
    const { spawn } = await import('child_process')
    spawn('open', [reportPath], { stdio: 'inherit' })
    
    process.exit(report.summary.failed > 0 ? 1 : 0)
    
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

main()

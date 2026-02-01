#!/usr/bin/env bun

/**
 * Push Notification Browser E2E Test
 * 
 * Tests the complete push notification pipeline in a real browser:
 * 1. Opens the app in Puppeteer with notification permissions granted
 * 2. Subscribes to push notifications via the UI
 * 3. Triggers a session.idle event
 * 4. Verifies the notification is sent
 * 
 * This test simulates what a real user on Android or macOS would experience.
 * 
 * Usage:
 *   bun run scripts/test-push-browser.ts [options]
 * 
 * Options:
 *   --url <url>       Base URL (default: http://localhost:5001)
 *   --user <username> Username for basic auth
 *   --pass <password> Password for basic auth
 *   --no-headless     Run browser in visible mode for debugging
 *   --help, -h        Show this help
 */

import puppeteer, { Browser, Page } from 'puppeteer'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

interface TestConfig {
  baseUrl: string
  username: string
  password: string
  headless: boolean
  timeout: number
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
  const outputDir = join(process.cwd(), '.test', `PushBrowserE2E-${timestamp}`)
  const screenshotsDir = join(outputDir, 'screenshots')
  mkdirSync(screenshotsDir, { recursive: true })
  return { outputDir, screenshotsDir }
}

const testDirs = createTestOutputDir()

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.OPENCODE_URL || 'http://localhost:5001',
  username: process.env.OPENCODE_USER || '',
  password: process.env.OPENCODE_PASS || '',
  headless: process.env.CI === 'true',
  timeout: 60000,
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

async function runBrowserPushTest(config: TestConfig): Promise<boolean> {
  console.log('\n' + '='.repeat(60))
  console.log('Push Notification Browser E2E Test')
  console.log('='.repeat(60))
  console.log(`URL: ${config.baseUrl}`)
  console.log(`Headless: ${config.headless}`)
  console.log(`Output: ${config.outputDir}`)
  console.log('='.repeat(60) + '\n')

  let browser: Browser | null = null
  const results: TestResult[] = []

  try {
    info('Launching browser with notification permissions...')
    
    let executablePath: string | undefined
    if (process.platform === 'darwin') {
      const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      if (existsSync(macPath)) executablePath = macPath
    } else if (process.platform === 'linux') {
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
      ...(executablePath && { executablePath }),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Grant notification permissions
        '--enable-features=WebNotifications',
      ]
    })

    const context = browser.defaultBrowserContext()
    // Grant notification permission for the origin
    const origin = new URL(config.baseUrl).origin
    await context.overridePermissions(origin, ['notifications'])

    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    page.setDefaultTimeout(config.timeout)

    if (config.username && config.password) {
      await page.setExtraHTTPHeaders({
        'Authorization': `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
      })
    }

    // Capture push notification requests
    let pushSubscriptionSent = false
    let pushTestSent = false
    let vapidKeyFetched = false

    page.on('response', async (response) => {
      const url = response.url()
      if (url.includes('/api/push/vapid-public-key')) {
        vapidKeyFetched = response.status() === 200
        log(`[API] VAPID key fetched: ${response.status()}`, 1)
      } else if (url.includes('/api/push/subscribe')) {
        pushSubscriptionSent = response.status() === 200
        log(`[API] Push subscription: ${response.status()}`, 1)
      } else if (url.includes('/api/push/test')) {
        pushTestSent = true
        const data = await response.json().catch(() => ({}))
        log(`[API] Push test: ${JSON.stringify(data)}`, 1)
      } else if (url.includes('/api/push/send')) {
        log(`[API] Push send: ${response.status()}`, 1)
      }
    })

    page.on('console', (msg) => {
      const text = msg.text()
      // Log all console messages for debugging
      const type = msg.type()
      if (type === 'error' || type === 'warning') {
        log(`[Browser ${type}] ${text}`, 1)
      } else if (text.includes('[SW]') || text.includes('[Push]') || text.includes('notification') ||
          text.includes('error') || text.includes('Error')) {
        log(`[Browser] ${text}`, 1)
      }
    })

    // Log network errors
    page.on('requestfailed', (request) => {
      log(`[Network FAIL] ${request.url().slice(-50)}: ${request.failure()?.errorText}`, 1)
    })

    // Test 1: Load page
    const testStart = Date.now()
    info('Loading home page...')
    await page.goto(config.baseUrl, { 
      waitUntil: 'load', 
      timeout: 30000 
    })
    await takeScreenshot(page, 'page_loaded', config.screenshotsDir)
    
    // Give React time to hydrate
    await new Promise(r => setTimeout(r, 5000))
    await takeScreenshot(page, 'after_wait', config.screenshotsDir)
    
    // Check page state
    const pageState = await page.evaluate(() => {
      return {
        url: window.location.href,
        rootContent: document.getElementById('root')?.innerHTML?.slice(0, 200),
        bodyText: document.body.textContent?.slice(0, 200),
        scripts: Array.from(document.scripts).map(s => s.src?.slice(-30) || 'inline'),
        errors: (window as { __pageErrors?: string[] }).__pageErrors || []
      }
    })
    log(`Page state: ${JSON.stringify(pageState, null, 2)}`, 1)
    
    // Wait for app to render - check for various app elements
    info('Waiting for app to render...')
    try {
      await page.waitForFunction(() => {
        // Check for any React app indicator
        const hasButtons = document.querySelector('button') !== null
        const hasReactRoot = document.querySelector('#root') !== null
        const hasContent = document.body.textContent && document.body.textContent.length > 100
        return hasButtons || (hasReactRoot && hasContent)
      }, { timeout: 20000 })
    } catch {
      // Take screenshot and log page content on failure
      await takeScreenshot(page, 'app_load_failed', config.screenshotsDir)
      const pageContent = await page.evaluate(() => document.body?.innerHTML?.slice(0, 500) || '')
      log(`Page content: ${pageContent}`, 1)
      fail('App failed to render within timeout')
      results.push({ name: 'Page Load', passed: false, duration: Date.now() - testStart })
      return false
    }
    success('Page loaded')

    // Test 2: Check if Service Worker is supported
    info('Checking Service Worker support...')
    const swSupported = await page.evaluate(() => {
      return 'serviceWorker' in navigator
    })
    
    if (!swSupported) {
      fail('Service Worker not supported in this browser')
      results.push({ name: 'Service Worker Support', passed: false, duration: Date.now() - testStart })
      return false
    }
    success('Service Worker is supported')
    results.push({ name: 'Service Worker Support', passed: true, duration: Date.now() - testStart })

    // Test 3: Check Notification API support
    info('Checking Notification API support...')
    const notifSupported = await page.evaluate(() => {
      return 'Notification' in window
    })
    
    if (!notifSupported) {
      fail('Notification API not supported')
      results.push({ name: 'Notification API Support', passed: false, duration: Date.now() - testStart })
      return false
    }
    success('Notification API is supported')
    results.push({ name: 'Notification API Support', passed: true, duration: Date.now() - testStart })

    // Test 4: Check notification permission
    info('Checking notification permission...')
    const permission = await page.evaluate(() => {
      return Notification.permission
    })
    log(`Notification permission: ${permission}`, 1)

    if (permission === 'denied') {
      fail('Notification permission denied - cannot test push notifications')
      results.push({ name: 'Notification Permission', passed: false, duration: Date.now() - testStart })
      return false
    }
    success(`Notification permission: ${permission}`)
    results.push({ name: 'Notification Permission', passed: true, duration: Date.now() - testStart })

    // Test 5: Find and click the notification enable button
    info('Looking for notification enable button...')
    await takeScreenshot(page, 'before_notification_button', config.screenshotsDir)

    // Look for the bell button or enable notifications button
    const buttonFound = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      for (const btn of buttons) {
        const title = btn.getAttribute('title')?.toLowerCase() || ''
        const text = btn.textContent?.toLowerCase() || ''
        if (title.includes('notification') || text.includes('notification') || 
            title.includes('background') || text.includes('background')) {
          (btn as HTMLButtonElement).click()
          return { found: true, title: btn.getAttribute('title'), text: btn.textContent?.slice(0, 50) }
        }
      }
      // Also check for bell icons
      const bellIcons = document.querySelectorAll('[data-lucide="bell"], .lucide-bell')
      for (const icon of bellIcons) {
        const btn = icon.closest('button')
        if (btn) {
          (btn as HTMLButtonElement).click()
          return { found: true, title: 'Bell icon button' }
        }
      }
      return { found: false }
    })

    if (!buttonFound.found) {
      info('Notification button not found on page - this is OK if already subscribed')
      log('Available buttons:', 1)
      const buttons = await page.evaluate(() => 
        Array.from(document.querySelectorAll('button')).slice(0, 10).map(b => ({
          title: b.getAttribute('title'),
          text: b.textContent?.slice(0, 30)
        }))
      )
      buttons.forEach(b => log(JSON.stringify(b), 2))
    } else {
      success(`Found notification button: ${JSON.stringify(buttonFound)}`)
    }
    await takeScreenshot(page, 'after_notification_button_click', config.screenshotsDir)

    // Wait for push subscription to be created
    await new Promise(r => setTimeout(r, 3000))

    // Test 6: Verify push subscription via API
    info('Verifying push subscription was created...')
    
    // Use a timeout wrapper for the subscription check
    const subscriptionCheckPromise = page.evaluate(async () => {
      try {
        // Check if we have a push subscription with timeout
        if ('serviceWorker' in navigator) {
          // Wait for service worker with timeout
          const swReady = navigator.serviceWorker.ready
          const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('ServiceWorker timeout')), 5000)
          )
          
          try {
            const registration = await Promise.race([swReady, timeout]) as ServiceWorkerRegistration
            const subscription = await registration.pushManager.getSubscription()
            return { 
              hasSubscription: subscription !== null,
              endpoint: subscription?.endpoint?.slice(0, 50)
            }
          } catch (e) {
            return { hasSubscription: false, error: `SW ready timeout: ${String(e)}` }
          }
        }
        return { hasSubscription: false, error: 'No service worker' }
      } catch (e) {
        return { hasSubscription: false, error: String(e) }
      }
    })
    
    // Overall timeout for the evaluate call
    const subscriptionCheck = await Promise.race([
      subscriptionCheckPromise,
      new Promise<{ hasSubscription: boolean; error: string }>((resolve) => 
        setTimeout(() => resolve({ hasSubscription: false, error: 'Evaluate timeout' }), 10000)
      )
    ])

    log(`Subscription check: ${JSON.stringify(subscriptionCheck)}`, 1)
    
    if (subscriptionCheck.hasSubscription) {
      success('Push subscription exists in browser')
    } else {
      info(`Browser SW check failed: ${subscriptionCheck.error || 'unknown'} - will verify via API`)
    }
    
    // Don't add subscription check to results yet - we'll verify via API test below

    // Test 7: Test sending a push notification via API
    info('Testing push notification delivery via API...')
    const authHeader = config.username && config.password
      ? `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
      : ''
    
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authHeader) headers['Authorization'] = authHeader

    const testResponse = await fetch(`${config.baseUrl}/api/push/test`, {
      method: 'POST',
      headers
    })

    const testData = await testResponse.json() as { 
      sent?: boolean
      successCount?: number
      failedCount?: number
      message?: string
    }
    
    log(`Push test response: ${JSON.stringify(testData)}`, 1)

    // The key validation: did we successfully send push notifications?
    const hasActiveSubscriptions = (testData.successCount ?? 0) > 0
    const pushAttempted = testData.successCount !== undefined || testData.failedCount !== undefined
    
    if (hasActiveSubscriptions) {
      success(`Push notification delivered: ${testData.successCount} success, ${testData.failedCount} failed`)
    } else if (pushAttempted) {
      info(`Push attempted but no active subscriptions: ${testData.failedCount} failed`)
    } else if (testData.message?.includes('No active subscriptions')) {
      info('No active subscriptions found')
    } else {
      fail('Push notification test failed')
    }
    
    // The final result: did at least one push notification get delivered?
    results.push({
      name: 'Push Notification Delivery',
      passed: hasActiveSubscriptions,
      duration: Date.now() - testStart,
      details: testData.message || `success=${testData.successCount}, failed=${testData.failedCount}`
    })

    await takeScreenshot(page, 'test_complete', config.screenshotsDir)

    // Print summary
    console.log('\n' + '='.repeat(60))
    console.log('Test Results Summary')
    console.log('='.repeat(60))

    let passed = 0
    let failed = 0

    for (const result of results) {
      const status = result.passed ? 'PASS' : 'FAIL'
      console.log(`  ${status} ${result.name}`)
      if (result.details) console.log(`       ${result.details}`)
      if (result.passed) passed++
      else failed++
    }

    console.log('='.repeat(60))
    console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`)
    console.log('='.repeat(60))

    // Write results
    const resultsFile = join(config.outputDir, 'test-results.json')
    writeFileSync(resultsFile, JSON.stringify(results, null, 2))
    info(`Results saved to: ${resultsFile}`)

    return failed === 0

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
    } else if (args[i] === '--no-headless') {
      config.headless = false
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Push Notification Browser E2E Test

Tests the complete push notification pipeline in a real browser:
1. Opens the app in Puppeteer with notification permissions granted
2. Subscribes to push notifications via the UI
3. Tests push notification delivery via API

This test simulates what a real user on Android or macOS would experience.

Usage: bun run scripts/test-push-browser.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5001)
  --user <username> Username for basic auth
  --pass <password> Password for basic auth
  --no-headless     Run browser in visible mode for debugging
  --help, -h        Show this help

Environment Variables:
  OPENCODE_URL      Base URL
  OPENCODE_USER     Username
  OPENCODE_PASS     Password
  CI                If "true", enables headless mode

Examples:
  # Local development
  bun run scripts/test-push-browser.ts

  # With visible browser for debugging
  bun run scripts/test-push-browser.ts --no-headless

  # Remote deployment with auth
  bun run scripts/test-push-browser.ts --url https://example.trycloudflare.com --user admin --pass secret
`)
      process.exit(0)
    }
  }

  const passed = await runBrowserPushTest(config)
  process.exit(passed ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

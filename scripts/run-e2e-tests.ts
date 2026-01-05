#!/usr/bin/env bun

import { spawn, spawnSync } from 'child_process'

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
}

const DEFAULT_URL = process.env.OPENCODE_URL || 'http://localhost:5003'
const DEFAULT_USER = process.env.OPENCODE_USER || ''
const DEFAULT_PASS = process.env.OPENCODE_PASS || ''

async function runTest(name: string, script: string, args: string[]): Promise<TestResult> {
  const start = Date.now()
  
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', script, ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: process.cwd()
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
      process.stdout.write(data)
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
      process.stderr.write(data)
    })

    proc.on('close', (code) => {
      const duration = Date.now() - start
      resolve({
        name,
        passed: code === 0,
        duration,
        error: code !== 0 ? stderr || stdout : undefined
      })
    })

    proc.on('error', (err) => {
      resolve({
        name,
        passed: false,
        duration: Date.now() - start,
        error: err.message
      })
    })
  })
}

async function waitForHealth(url: string, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now()
  
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`)
      const data = await response.json()
      if (data.status === 'healthy') {
        return true
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  
  return false
}

async function main() {
  const args = process.argv.slice(2)
  let url = DEFAULT_URL
  let user = DEFAULT_USER
  let pass = DEFAULT_PASS
  let skipBrowser = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) url = args[++i]
    else if (args[i] === '--user' && args[i + 1]) user = args[++i]
    else if (args[i] === '--pass' && args[i + 1]) pass = args[++i]
    else if (args[i] === '--skip-browser') skipBrowser = true
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
OpenCode Manager - E2E Test Runner

Runs all E2E tests against a running OpenCode Manager instance.

Usage: bun run scripts/run-e2e-tests.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5003)
  --user <username> Username for basic auth
  --pass <password> Password for basic auth
  --skip-browser    Skip browser-based tests (Talk Mode browser test)
  --help, -h        Show this help

Tests run:
  1. Voice E2E (STT + TTS API tests)
  2. Talk Mode E2E (STT -> OpenCode -> TTS flow)
  3. Talk Mode Browser (Full browser test with audio injection)

Example:
  # Start local container first
  ./scripts/run-local-docker.sh &
  
  # Run tests
  bun run scripts/run-e2e-tests.ts
  
  # Or against remote deployment
  bun run scripts/run-e2e-tests.ts --url https://your-deployment.com --user admin --pass secret
`)
      process.exit(0)
    }
  }

  console.log('\n🧪 OpenCode Manager E2E Test Suite')
  console.log('═'.repeat(60))
  console.log(`URL: ${url}`)
  console.log(`Auth: ${user ? 'enabled' : 'disabled'}`)
  console.log('═'.repeat(60))

  console.log('\n⏳ Waiting for server to be healthy...')
  const healthy = await waitForHealth(url)
  
  if (!healthy) {
    console.log('❌ Server not healthy after 60s timeout')
    process.exit(1)
  }
  console.log('✅ Server is healthy\n')

  const testArgs: string[] = ['--url', url]
  if (user) testArgs.push('--user', user)
  if (pass) testArgs.push('--pass', pass)

  const results: TestResult[] = []

  console.log('─'.repeat(60))
  console.log('1. Voice E2E Tests (STT + TTS)')
  console.log('─'.repeat(60))
  results.push(await runTest('Voice E2E', 'scripts/test-voice-e2e.ts', testArgs))

  console.log('\n' + '─'.repeat(60))
  console.log('2. Talk Mode E2E Tests (API flow)')
  console.log('─'.repeat(60))
  results.push(await runTest('Talk Mode E2E', 'scripts/test-talkmode-e2e.ts', testArgs))

  if (!skipBrowser) {
    console.log('\n' + '─'.repeat(60))
    console.log('3. Talk Mode Browser Tests (Full browser with audio injection)')
    console.log('─'.repeat(60))
    results.push(await runTest('Talk Mode Browser', 'scripts/test-talkmode-browser.ts', testArgs))
  }

  console.log('\n' + '═'.repeat(60))
  console.log('Test Results Summary')
  console.log('═'.repeat(60))

  let allPassed = true
  for (const result of results) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL'
    const duration = `${(result.duration / 1000).toFixed(1)}s`
    console.log(`${status} ${result.name} (${duration})`)
    if (!result.passed) allPassed = false
  }

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
  console.log('─'.repeat(60))
  console.log(`Total: ${results.length} tests, ${results.filter(r => r.passed).length} passed, ${results.filter(r => !r.passed).length} failed`)
  console.log(`Duration: ${(totalDuration / 1000).toFixed(1)}s`)
  console.log('═'.repeat(60))

  process.exit(allPassed ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

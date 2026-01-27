#!/usr/bin/env bun

interface TestConfig {
  baseUrl: string
  username: string
  password: string
}

interface RoundTripResult {
  question: string
  expectedAnswer: string
  ttsText: string
  ttsAudioSize: number
  sttTranscription: string
  verified: boolean
  error?: string
}

function log(message: string, indent = 0) {
  const prefix = '  '.repeat(indent)
  const timestamp = new Date().toISOString().slice(11, 19)
  console.log(`[${timestamp}] ${prefix}${message}`)
}

function success(message: string) {
  log(`✓ ${message}`)
}

function fail(message: string) {
  log(`✗ ${message}`)
}

function info(message: string) {
  log(`→ ${message}`)
}

async function getAuthHeaders(config: TestConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.username && config.password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
  }
  return headers
}

async function checkHealth(config: TestConfig): Promise<boolean> {
  const headers = await getAuthHeaders(config)
  try {
    const response = await fetch(`${config.baseUrl}/api/health`, { headers })
    const data = await response.json() as { status: string }
    return data.status === 'healthy'
  } catch {
    return false
  }
}

async function checkSTTServer(config: TestConfig): Promise<boolean> {
  const headers = await getAuthHeaders(config)
  try {
    const response = await fetch(`${config.baseUrl}/api/stt/status`, { headers })
    const data = await response.json() as { server?: { running: boolean } }
    return data.server?.running === true
  } catch {
    return false
  }
}

async function checkTTSServer(config: TestConfig): Promise<boolean> {
  const headers = await getAuthHeaders(config)
  try {
    const response = await fetch(`${config.baseUrl}/api/tts/coqui/status`, { headers })
    const data = await response.json() as { running: boolean }
    return data.running === true
  } catch {
    return false
  }
}

async function synthesizeTTS(config: TestConfig, text: string): Promise<Buffer | null> {
  const headers = await getAuthHeaders(config)
  
  try {
    const response = await fetch(
      `${config.baseUrl}/api/tts/synthesize`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ text })
      }
    )
    
    if (!response.ok) {
      fail(`TTS synthesis failed: ${response.status} ${await response.text()}`)
      return null
    }
    
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (e) {
    fail(`TTS synthesis error: ${e}`)
    return null
  }
}

async function transcribeAudio(config: TestConfig, audioBuffer: Buffer): Promise<string | null> {
  const headers = await getAuthHeaders(config)
  const audioBase64 = audioBuffer.toString('base64')
  
  try {
    const response = await fetch(`${config.baseUrl}/api/stt/transcribe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ audio: audioBase64, format: 'wav' })
    })
    
    if (!response.ok) {
      fail(`STT transcription failed: ${response.status} ${await response.text()}`)
      return null
    }
    
    const data = await response.json() as { text: string }
    return data.text
  } catch (e) {
    fail(`STT transcription error: ${e}`)
    return null
  }
}

async function createSession(config: TestConfig, repoPath: string): Promise<string | null> {
  const headers = await getAuthHeaders(config)
  
  try {
    const response = await fetch(
      `${config.baseUrl}/api/opencode/session?directory=${encodeURIComponent(repoPath)}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      }
    )
    
    if (!response.ok) {
      fail(`Failed to create session: ${response.status}`)
      return null
    }
    
    const data = await response.json() as { id: string }
    return data.id
  } catch (e) {
    fail(`Session creation error: ${e}`)
    return null
  }
}

async function sendMessage(config: TestConfig, sessionId: string, repoPath: string, message: string): Promise<void> {
  const headers = await getAuthHeaders(config)
  
  await fetch(
    `${config.baseUrl}/api/opencode/session/${sessionId}/message?directory=${encodeURIComponent(repoPath)}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parts: [{ type: 'text', text: message }]
      })
    }
  )
}

async function waitForResponse(config: TestConfig, sessionId: string, repoPath: string, timeoutMs = 60000): Promise<string | null> {
  const headers = await getAuthHeaders(config)
  const startTime = Date.now()
  let lastResponse = ''
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(
        `${config.baseUrl}/api/opencode/session/${sessionId}/message?directory=${encodeURIComponent(repoPath)}`,
        { headers }
      )
      
      if (!response.ok) {
        await new Promise(r => setTimeout(r, 1000))
        continue
      }
      
      const messages = await response.json() as Array<{
        info?: { role: string; time?: { completed?: number } }
        parts?: Array<{ type: string; text?: string }>
      }>
      
      const assistantMsgs = messages.filter(m => m.info?.role === 'assistant')
      if (assistantMsgs.length > 0) {
        const lastMsg = assistantMsgs[assistantMsgs.length - 1]
        const textParts = (lastMsg.parts || [])
          .filter(p => p.type === 'text' && p.text)
          .map(p => p.text)
          .join('\n')
        
        if (textParts && textParts !== lastResponse) {
          lastResponse = textParts
          
          if (lastMsg.info?.time?.completed) {
            return textParts
          }
        }
      }
    } catch {
      // ignore
    }
    
    await new Promise(r => setTimeout(r, 1000))
  }
  
  return lastResponse || null
}

async function runRoundTrip(
  config: TestConfig, 
  sessionId: string, 
  repoPath: string,
  question: string, 
  expectedAnswer: string
): Promise<RoundTripResult> {
  const result: RoundTripResult = {
    question,
    expectedAnswer,
    ttsText: '',
    ttsAudioSize: 0,
    sttTranscription: '',
    verified: false
  }
  
  info(`Asking: "${question}"`)
  await sendMessage(config, sessionId, repoPath, question)
  
  info('Waiting for OpenCode response...')
  const response = await waitForResponse(config, sessionId, repoPath, 60000)
  
  if (!response) {
    result.error = 'No response from OpenCode'
    fail(result.error)
    return result
  }
  
  result.ttsText = response
  log(`OpenCode response: "${response.slice(0, 100)}${response.length > 100 ? '...' : ''}"`, 1)
  
  info('Synthesizing response with Coqui TTS...')
  const ttsAudio = await synthesizeTTS(config, response)
  
  if (!ttsAudio) {
    result.error = 'TTS synthesis failed'
    fail(result.error)
    return result
  }
  
  result.ttsAudioSize = ttsAudio.length
  success(`TTS audio generated: ${ttsAudio.length} bytes`)
  
  info('Sending TTS audio to Whisper STT...')
  const transcription = await transcribeAudio(config, ttsAudio)
  
  if (!transcription) {
    result.error = 'STT transcription failed'
    fail(result.error)
    return result
  }
  
  result.sttTranscription = transcription
  log(`Whisper heard: "${transcription}"`, 1)
  
  const transcriptionLower = transcription.toLowerCase()
  const expectedLower = expectedAnswer.toLowerCase()
  
  const numberWords: Record<string, string> = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
    '10': 'ten', '11': 'eleven', '12': 'twelve'
  }
  
  const expectedWord = numberWords[expectedAnswer] || expectedAnswer
  
  result.verified = 
    transcriptionLower.includes(expectedLower) || 
    transcriptionLower.includes(expectedWord) ||
    transcription.includes(expectedAnswer)
  
  if (result.verified) {
    success(`Verified: Whisper correctly heard "${expectedAnswer}" (transcribed: "${transcription}")`)
  } else {
    fail(`Verification failed: Expected "${expectedAnswer}" but got "${transcription}"`)
  }
  
  return result
}

async function main() {
  const args = process.argv.slice(2)
  const config: TestConfig = {
    baseUrl: process.env.OPENCODE_URL || 'http://localhost:5001',
    username: process.env.OPENCODE_USER || '',
    password: process.env.OPENCODE_PASS || ''
  }
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      config.baseUrl = args[++i]
    } else if (args[i] === '--user' && args[i + 1]) {
      config.username = args[++i]
    } else if (args[i] === '--pass' && args[i + 1]) {
      config.password = args[++i]
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
TTS → STT Round-Trip Verification Test

This test verifies that:
1. Coqui TTS can synthesize speech from text
2. Whisper STT can correctly transcribe that speech
3. The full loop works: Question → OpenCode → TTS → Audio → STT → Verify

Tests performed:
- Ask "What is 2+2? Reply with just the number." → Verify Whisper hears "4"
- Ask "What is 2*5? Reply with just the number." → Verify Whisper hears "10"

Usage: bun run scripts/test-tts-stt-roundtrip.ts [options]

Options:
  --url <url>       Base URL (default: http://localhost:5001)
  --user <username> Username for basic auth
  --pass <password> Password for basic auth
  --help, -h        Show this help
`)
      process.exit(0)
    }
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('TTS → STT Round-Trip Verification Test')
  console.log('='.repeat(60))
  console.log(`URL: ${config.baseUrl}`)
  console.log('='.repeat(60) + '\n')
  
  info('Checking backend health...')
  if (!await checkHealth(config)) {
    fail('Backend is not healthy')
    process.exit(1)
  }
  success('Backend is healthy')
  
  info('Checking STT server (Whisper)...')
  if (!await checkSTTServer(config)) {
    fail('STT server is not running')
    process.exit(1)
  }
  success('STT server is running')
  
  info('Checking TTS server (Coqui)...')
  if (!await checkTTSServer(config)) {
    fail('TTS server is not running')
    process.exit(1)
  }
  success('TTS server is running')
  
  info('Getting available repos...')
  const headers = await getAuthHeaders(config)
  const reposResponse = await fetch(`${config.baseUrl}/api/repos`, { headers })
  const repos = await reposResponse.json() as Array<{ id: string; fullPath: string }>
  
  if (!repos.length) {
    fail('No repos available')
    process.exit(1)
  }
  
  const repoPath = repos[0].fullPath
  success(`Using repo: ${repoPath}`)
  
  info('Creating new session...')
  const sessionId = await createSession(config, repoPath)
  if (!sessionId) {
    fail('Failed to create session')
    process.exit(1)
  }
  success(`Session created: ${sessionId}`)
  
  console.log('\n' + '-'.repeat(60))
  console.log('Test 1: What is 2+2?')
  console.log('-'.repeat(60))
  
  const result1 = await runRoundTrip(
    config, sessionId, repoPath,
    'What is 2+2? Reply with just the number, nothing else.',
    '4'
  )
  
  console.log('\n' + '-'.repeat(60))
  console.log('Test 2: What is 2*5?')
  console.log('-'.repeat(60))
  
  const result2 = await runRoundTrip(
    config, sessionId, repoPath,
    'What is 2*5? Reply with just the number, nothing else.',
    '10'
  )
  
  console.log('\n' + '='.repeat(60))
  console.log('Results Summary')
  console.log('='.repeat(60))
  
  console.log('\nTest 1 (2+2=4):')
  console.log(`  Question: ${result1.question}`)
  console.log(`  OpenCode said: "${result1.ttsText.slice(0, 50)}..."`)
  console.log(`  TTS audio size: ${result1.ttsAudioSize} bytes`)
  console.log(`  Whisper heard: "${result1.sttTranscription}"`)
  console.log(`  Verified: ${result1.verified ? '✓ PASS' : '✗ FAIL'}`)
  
  console.log('\nTest 2 (2*5=10):')
  console.log(`  Question: ${result2.question}`)
  console.log(`  OpenCode said: "${result2.ttsText.slice(0, 50)}..."`)
  console.log(`  TTS audio size: ${result2.ttsAudioSize} bytes`)
  console.log(`  Whisper heard: "${result2.sttTranscription}"`)
  console.log(`  Verified: ${result2.verified ? '✓ PASS' : '✗ FAIL'}`)
  
  const allPassed = result1.verified && result2.verified
  
  console.log('\n' + '='.repeat(60))
  if (allPassed) {
    console.log('✓ ALL TESTS PASSED')
    console.log('  TTS (Coqui) → Audio → STT (Whisper) round-trip verified!')
  } else {
    console.log('✗ SOME TESTS FAILED')
    if (!result1.verified) console.log('  - Test 1 (2+2) failed')
    if (!result2.verified) console.log('  - Test 2 (2*5) failed')
  }
  console.log('='.repeat(60) + '\n')
  
  process.exit(allPassed ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

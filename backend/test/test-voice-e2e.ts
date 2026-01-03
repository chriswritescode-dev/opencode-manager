import axios from 'axios'

const API_BASE = 'http://localhost:5001'

function generateToneWav(frequencyHz: number, durationSeconds: number, sampleRate = 16000): Buffer {
  const numSamples = Math.floor(sampleRate * durationSeconds)
  const headerSize = 44
  const dataSize = numSamples * 2
  const fileSize = headerSize + dataSize

  const buffer = Buffer.alloc(fileSize)
  const view = new DataView(buffer.buffer)

  buffer.write('RIFF', 0)
  view.setUint32(4, fileSize - 8, true)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  buffer.write('data', 36)
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const sample = Math.sin(2 * Math.PI * frequencyHz * t) * 0.5
    const intSample = Math.floor(sample * 32767)
    view.setInt16(44 + i * 2, intSample, true)
  }

  return buffer
}

async function testHealthEndpoint() {
  console.log('1. Testing health endpoint...')
  const { data } = await axios.get(`${API_BASE}/api/health`)
  console.log(`   Backend status: ${data.status}`)
  console.log(`   Database: ${data.database}`)
  return true
}

async function testSTTServerRunning() {
  console.log('2. Testing STT server status...')
  const { data } = await axios.get(`${API_BASE}/api/stt/status`)
  
  if (!data.server.running) {
    throw new Error('Whisper server is not running')
  }
  
  console.log(`   Server running: ${data.server.running}`)
  console.log(`   Model loaded: ${data.server.model}`)
  console.log(`   STT enabled: ${data.enabled}`)
  return true
}

async function testSTTModelsAvailable() {
  console.log('3. Testing STT models endpoint...')
  const { data } = await axios.get(`${API_BASE}/api/stt/models`)
  
  if (!data.models || data.models.length === 0) {
    throw new Error('No STT models available')
  }
  
  console.log(`   Models available: ${data.models.length}`)
  console.log(`   Current model: ${data.current}`)
  return true
}

async function testSTTTranscribeSilence() {
  console.log('4. Testing STT transcribe with silence...')
  
  const silentWav = Buffer.alloc(44 + 16000)
  silentWav.write('RIFF', 0)
  new DataView(silentWav.buffer).setUint32(4, silentWav.length - 8, true)
  silentWav.write('WAVE', 8)
  silentWav.write('fmt ', 12)
  new DataView(silentWav.buffer).setUint32(16, 16, true)
  new DataView(silentWav.buffer).setUint16(20, 1, true)
  new DataView(silentWav.buffer).setUint16(22, 1, true)
  new DataView(silentWav.buffer).setUint32(24, 16000, true)
  new DataView(silentWav.buffer).setUint32(28, 32000, true)
  new DataView(silentWav.buffer).setUint16(32, 2, true)
  new DataView(silentWav.buffer).setUint16(34, 16, true)
  silentWav.write('data', 36)
  new DataView(silentWav.buffer).setUint32(40, 16000, true)
  
  const base64 = silentWav.toString('base64')
  
  const { data } = await axios.post(`${API_BASE}/api/stt/transcribe`, {
    audio: base64,
    format: 'wav'
  })
  
  console.log(`   Transcription: "${data.text || '(empty)'}"`)
  console.log(`   Duration: ${data.duration}s`)
  console.log(`   Language: ${data.language}`)
  return true
}

async function testSTTTranscribeWithTone() {
  console.log('5. Testing STT transcribe with audio tone...')
  
  const toneWav = generateToneWav(440, 1.0)
  const base64 = toneWav.toString('base64')
  
  const { data } = await axios.post(`${API_BASE}/api/stt/transcribe`, {
    audio: base64,
    format: 'wav'
  })
  
  console.log(`   Transcription: "${data.text || '(empty)'}"`)
  console.log(`   Duration: ${data.duration}s`)
  return true
}

async function testTTSStatus() {
  console.log('6. Testing TTS status...')
  const { data } = await axios.get(`${API_BASE}/api/tts/status`)
  
  console.log(`   TTS enabled: ${data.enabled}`)
  console.log(`   Provider configured: ${data.configured}`)
  console.log(`   Cache entries: ${data.cache.count}`)
  return true
}

async function testSettingsVoiceConfig() {
  console.log('7. Testing voice settings configuration...')
  const { data } = await axios.get(`${API_BASE}/api/settings`)
  
  const stt = data.preferences.stt
  const tts = data.preferences.tts
  const talkMode = data.preferences.talkMode
  
  console.log(`   STT enabled: ${stt.enabled}, model: ${stt.model}`)
  console.log(`   TTS enabled: ${tts.enabled}, provider: ${tts.provider}`)
  console.log(`   Talk Mode enabled: ${talkMode.enabled}`)
  
  if (!stt.enabled) throw new Error('STT should be enabled')
  if (!tts.enabled) throw new Error('TTS should be enabled')
  if (!talkMode.enabled) throw new Error('Talk Mode should be enabled')
  
  return true
}

async function testTranscribeBase64API() {
  console.log('8. Testing transcribeBase64 API (used by Talk Mode)...')
  
  const toneWav = generateToneWav(880, 0.5)
  const base64 = toneWav.toString('base64')
  
  const { data } = await axios.post(`${API_BASE}/api/stt/transcribe`, {
    audio: base64,
    format: 'wav',
    model: 'base'
  })
  
  if (typeof data.text !== 'string') {
    throw new Error('Expected text field in response')
  }
  if (typeof data.duration !== 'number') {
    throw new Error('Expected duration field in response')
  }
  
  console.log(`   Response valid: text="${data.text || '(empty)'}", duration=${data.duration}s`)
  return true
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Voice Interface End-to-End Test Suite')
  console.log('═══════════════════════════════════════════')
  console.log('')
  
  const tests = [
    { name: 'Health Endpoint', fn: testHealthEndpoint },
    { name: 'STT Server Running', fn: testSTTServerRunning },
    { name: 'STT Models Available', fn: testSTTModelsAvailable },
    { name: 'STT Transcribe Silence', fn: testSTTTranscribeSilence },
    { name: 'STT Transcribe Tone', fn: testSTTTranscribeWithTone },
    { name: 'TTS Status', fn: testTTSStatus },
    { name: 'Voice Settings Config', fn: testSettingsVoiceConfig },
    { name: 'TranscribeBase64 API', fn: testTranscribeBase64API },
  ]
  
  const results: { name: string; passed: boolean; error?: string }[] = []
  
  for (const test of tests) {
    try {
      await test.fn()
      results.push({ name: test.name, passed: true })
      console.log(`   ✅ PASS\n`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      results.push({ name: test.name, passed: false, error: errorMsg })
      console.log(`   ❌ FAIL: ${errorMsg}\n`)
    }
  }
  
  console.log('═══════════════════════════════════════════')
  console.log('  Summary')
  console.log('═══════════════════════════════════════════')
  
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  
  results.forEach(r => {
    const status = r.passed ? '✅' : '❌'
    console.log(`  ${status} ${r.name}`)
  })
  
  console.log('')
  console.log(`  Total: ${passed} passed, ${failed} failed`)
  console.log('═══════════════════════════════════════════')
  
  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`)
    })
  }
  
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Test suite failed:', err)
  process.exit(1)
})

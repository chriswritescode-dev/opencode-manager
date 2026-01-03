import axios from 'axios'

const API_BASE = 'http://localhost:5001'

function generateSilentWav(durationSeconds: number, sampleRate = 16000): Buffer {
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

  return buffer
}

async function testSTTTranscribe() {
  console.log('\n=== Testing STT Transcribe Endpoint ===')
  
  try {
    const wavBuffer = generateSilentWav(0.5)
    const base64Audio = wavBuffer.toString('base64')
    
    console.log(`Generated silent WAV: ${wavBuffer.length} bytes`)
    
    const { data } = await axios.post(`${API_BASE}/api/stt/transcribe`, {
      audio: base64Audio,
      format: 'wav'
    })
    
    console.log('Transcription response:', JSON.stringify(data, null, 2))
    console.log('✅ STT transcribe endpoint works!')
    return true
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('STT Error:', error.response?.data || error.message)
    } else {
      console.error('STT Error:', error)
    }
    return false
  }
}

async function testSTTStatus() {
  console.log('\n=== Testing STT Status ===')
  try {
    const { data } = await axios.get(`${API_BASE}/api/stt/status`)
    console.log('Status:', {
      enabled: data.enabled,
      serverRunning: data.server.running,
      model: data.server.model
    })
    return data.enabled && data.server.running
  } catch (error) {
    console.error('Status Error:', error)
    return false
  }
}

async function testTTSStatus() {
  console.log('\n=== Testing TTS Status ===')
  try {
    const { data } = await axios.get(`${API_BASE}/api/tts/status`)
    console.log('Status:', {
      enabled: data.enabled,
      configured: data.configured,
      cacheCount: data.cache.count
    })
    return data.enabled
  } catch (error) {
    console.error('TTS Status Error:', error)
    return false
  }
}

async function main() {
  console.log('Voice Features Integration Test')
  console.log('================================')
  
  const results = {
    sttStatus: await testSTTStatus(),
    sttTranscribe: await testSTTTranscribe(),
    ttsStatus: await testTTSStatus()
  }
  
  console.log('\n=== Summary ===')
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${test}: ${passed ? '✅ PASS' : '❌ FAIL'}`)
  })
  
  const allPassed = Object.values(results).every(Boolean)
  process.exit(allPassed ? 0 : 1)
}

main()

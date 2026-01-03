import axios from 'axios'

const API_BASE = process.env.API_URL || 'http://localhost:5001'

async function testSTTStatus() {
  console.log('\n=== Testing STT Status ===')
  try {
    const { data } = await axios.get(`${API_BASE}/api/stt/status`)
    console.log('STT Status:', JSON.stringify(data, null, 2))
    return data.enabled && data.server.running
  } catch (error) {
    console.error('STT Status Error:', error instanceof Error ? error.message : error)
    return false
  }
}

async function testSTTModels() {
  console.log('\n=== Testing STT Models ===')
  try {
    const { data } = await axios.get(`${API_BASE}/api/stt/models`)
    console.log('Available models:', data.models?.join(', ') || 'none')
    console.log('Current model:', data.current || 'not loaded')
    return true
  } catch (error) {
    console.error('STT Models Error:', error instanceof Error ? error.message : error)
    return false
  }
}

async function testTTSStatus() {
  console.log('\n=== Testing TTS Status ===')
  try {
    const { data } = await axios.get(`${API_BASE}/api/tts/status`)
    console.log('TTS Status:', JSON.stringify(data, null, 2))
    return data.enabled
  } catch (error) {
    console.error('TTS Status Error:', error instanceof Error ? error.message : error)
    return false
  }
}

async function testTTSVoices() {
  console.log('\n=== Testing TTS Voices ===')
  try {
    const { data } = await axios.get(`${API_BASE}/api/tts/voices`)
    console.log('Available voices:', data.voices?.slice(0, 5).join(', ') || 'none')
    if (data.voices?.length > 5) {
      console.log(`  ... and ${data.voices.length - 5} more`)
    }
    return true
  } catch (error) {
    console.error('TTS Voices Error:', error instanceof Error ? error.message : error)
    return false
  }
}

async function testTTSSynthesize() {
  console.log('\n=== Testing TTS Synthesis ===')
  try {
    const { data, headers } = await axios.post(
      `${API_BASE}/api/tts/synthesize`,
      { text: 'Hello, this is a test.' },
      { responseType: 'arraybuffer' }
    )
    const contentType = headers['content-type']
    const size = data.byteLength
    console.log(`Synthesis successful: ${size} bytes, type: ${contentType}`)
    return size > 0
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 400) {
      console.log('TTS not configured (expected if using builtin provider)')
      return true
    }
    console.error('TTS Synthesis Error:', error instanceof Error ? error.message : error)
    return false
  }
}

async function main() {
  console.log('Voice Features Test Script')
  console.log('==========================')
  console.log(`Testing against: ${API_BASE}`)

  const results = {
    sttStatus: await testSTTStatus(),
    sttModels: await testSTTModels(),
    ttsStatus: await testTTSStatus(),
    ttsVoices: await testTTSVoices(),
    ttsSynthesize: await testTTSSynthesize(),
  }

  console.log('\n=== Summary ===')
  console.log('STT Status:', results.sttStatus ? 'PASS' : 'FAIL')
  console.log('STT Models:', results.sttModels ? 'PASS' : 'FAIL')
  console.log('TTS Status:', results.ttsStatus ? 'PASS' : 'FAIL')
  console.log('TTS Voices:', results.ttsVoices ? 'PASS' : 'FAIL')
  console.log('TTS Synthesize:', results.ttsSynthesize ? 'PASS' : 'FAIL')

  const allPassed = Object.values(results).every(Boolean)
  console.log('\nOverall:', allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED')
  
  process.exit(allPassed ? 0 : 1)
}

main()

import { describe, it, expect } from 'vitest'
import { AudioRecorder, downsampleAndConvert, encodeWavFromInt16 } from './audioRecorder'

const blobToArrayBuffer = (blob: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })

describe('downsampleAndConvert', () => {
  it('should produce correct output length for 48kHz to 16kHz', () => {
    const inputLength = 4800
    const input = new Float32Array(inputLength)
    const output = downsampleAndConvert(input, 48000, 16000)
    
    const expectedLength = Math.floor(inputLength * 16000 / 48000)
    expect(output.length).toBe(expectedLength)
    expect(output.length).toBe(inputLength / 3)
  })

  it('should produce correct output length for 44.1kHz to 16kHz', () => {
    const inputLength = 4410
    const input = new Float32Array(inputLength)
    const output = downsampleAndConvert(input, 44100, 16000)
    
    const expectedLength = Math.floor(inputLength * 16000 / 44100)
    expect(output.length).toBeCloseTo(expectedLength, 0)
  })

  it('should clamp values in range [-1, 1] to Int16 range', () => {
    const input = new Float32Array([1.0, -1.0, 0.5, -0.5, 0.0])
    const output = downsampleAndConvert(input, 16000, 16000)
    
    expect(output[0]).toBe(32767)
    expect(output[1]).toBe(-32768)
    expect(output[2]).toBeCloseTo(16383, 0)
    expect(output[3]).toBeCloseTo(-16384, 0)
    expect(output[4]).toBe(0)
  })

  it('should clamp values outside [-1, 1] range', () => {
    const input = new Float32Array([1.5, -1.5, 2.0, -2.0])
    const output = downsampleAndConvert(input, 16000, 16000)
    
    expect(output[0]).toBe(32767)
    expect(output[1]).toBe(-32768)
    expect(output[2]).toBe(32767)
    expect(output[3]).toBe(-32768)
  })

  it('should return Int16Array type', () => {
    const input = new Float32Array(100)
    const output = downsampleAndConvert(input, 48000, 16000)
    
    expect(output instanceof Int16Array).toBe(true)
  })
})

describe('encodeWavFromInt16', () => {
  it('should create a Blob with audio/wav type', () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    
    expect(blob.type).toBe('audio/wav')
  })

  it('should have RIFF header at offset 0', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    const arrayBuffer = await blobToArrayBuffer(blob)
    const view = new DataView(arrayBuffer)
    
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    )
    expect(riff).toBe('RIFF')
  })

  it('should have WAVE identifier at offset 8', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    const arrayBuffer = await blobToArrayBuffer(blob)
    const view = new DataView(arrayBuffer)
    
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    )
    expect(wave).toBe('WAVE')
  })

  it('should have sample rate at offset 24', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    const arrayBuffer = await blobToArrayBuffer(blob)
    const view = new DataView(arrayBuffer)
    
    const sampleRate = view.getUint32(24, true)
    expect(sampleRate).toBe(16000)
  })

  it('should have data identifier at offset 36', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    const arrayBuffer = await blobToArrayBuffer(blob)
    const view = new DataView(arrayBuffer)
    
    const data = String.fromCharCode(
      view.getUint8(36),
      view.getUint8(37),
      view.getUint8(38),
      view.getUint8(39)
    )
    expect(data).toBe('data')
  })

  it('should have correct file size for 1000 samples', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 1)
    const arrayBuffer = await blobToArrayBuffer(blob)
    
    expect(arrayBuffer.byteLength).toBe(44 + 1000 * 2)
  })

  it('should handle different sample rates', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 44100, 1)
    const arrayBuffer = await blobToArrayBuffer(blob)
    const view = new DataView(arrayBuffer)
    
    const sampleRate = view.getUint32(24, true)
    expect(sampleRate).toBe(44100)
  })

  it('should handle stereo channels', async () => {
    const samples = new Int16Array(1000)
    const blob = encodeWavFromInt16(samples, 16000, 2)
    const arrayBuffer = await blobToArrayBuffer(blob)
    const view = new DataView(arrayBuffer)
    
    const channels = view.getUint16(22, true)
    expect(channels).toBe(2)
  })
})

describe('AudioRecorder.isSupported', () => {
  it('should return boolean without throwing', () => {
    expect(() => {
      const result = AudioRecorder.isSupported()
      expect(typeof result).toBe('boolean')
    }).not.toThrow()
  })
})

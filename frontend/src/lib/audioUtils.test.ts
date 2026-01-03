import { describe, it, expect, vi, beforeEach } from 'vitest'
import { float32ToWav, blobToBase64 } from './audioUtils'

describe('audioUtils', () => {
  describe('float32ToWav', () => {
    it('should create a valid WAV blob', () => {
      const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
      const blob = float32ToWav(samples)

      expect(blob).toBeDefined()
      expect(blob.type).toBe('audio/wav')
    })

    it('should create WAV with correct size', () => {
      const samples = new Float32Array([0, 0.5, -0.5])
      const blob = float32ToWav(samples)

      const expectedSize = 44 + samples.length * 2
      expect(blob.size).toBe(expectedSize)
    })

    it('should use default sample rate of 16000', () => {
      const samples = new Float32Array([0])
      const blob = float32ToWav(samples)

      expect(blob.size).toBe(44 + 2)
    })

    it('should accept custom sample rate', () => {
      const samples = new Float32Array([0, 0.5])
      const blob = float32ToWav(samples, 44100)

      expect(blob).toBeDefined()
      expect(blob.type).toBe('audio/wav')
    })

    it('should clamp values to -1 to 1 range', () => {
      const samples = new Float32Array([2, -2, 0.5])
      const blob = float32ToWav(samples)

      expect(blob).toBeDefined()
      expect(blob.size).toBe(44 + samples.length * 2)
    })

    it('should handle empty array', () => {
      const samples = new Float32Array([])
      const blob = float32ToWav(samples)

      expect(blob.size).toBe(44)
    })

    it('should handle large arrays', () => {
      const samples = new Float32Array(10000).fill(0.5)
      const blob = float32ToWav(samples)

      expect(blob.size).toBe(44 + 20000)
    })

    it('should produce valid WAV header structure', async () => {
      const samples = new Float32Array([0.5, -0.5, 0.25, -0.25])
      const blob = float32ToWav(samples, 16000)

      const arrayBuffer = await blob.arrayBuffer()
      const view = new DataView(arrayBuffer)

      expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF')

      const fileSize = view.getUint32(4, true)
      expect(fileSize).toBe(36 + samples.length * 2)

      expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE')

      expect(String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))).toBe('fmt ')

      expect(view.getUint32(16, true)).toBe(16)
      expect(view.getUint16(20, true)).toBe(1)
      expect(view.getUint16(22, true)).toBe(1)
      expect(view.getUint32(24, true)).toBe(16000)
      expect(view.getUint32(28, true)).toBe(32000)
      expect(view.getUint16(32, true)).toBe(2)
      expect(view.getUint16(34, true)).toBe(16)

      expect(String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39))).toBe('data')
      expect(view.getUint32(40, true)).toBe(samples.length * 2)
    })

    it('should correctly convert float samples to 16-bit PCM', async () => {
      const samples = new Float32Array([0, 1, -1, 0.5, -0.5])
      const blob = float32ToWav(samples)

      const arrayBuffer = await blob.arrayBuffer()
      const view = new DataView(arrayBuffer)

      expect(view.getInt16(44, true)).toBe(0)
      expect(view.getInt16(46, true)).toBe(32767)
      expect(view.getInt16(48, true)).toBe(-32768)
      expect(view.getInt16(50, true)).toBeCloseTo(16383, -1)
      expect(view.getInt16(52, true)).toBeCloseTo(-16384, -1)
    })

    it('should handle different sample rates correctly', async () => {
      const samples = new Float32Array([0])

      const blob44100 = float32ToWav(samples, 44100)
      const arrayBuffer = await blob44100.arrayBuffer()
      const view = new DataView(arrayBuffer)

      expect(view.getUint32(24, true)).toBe(44100)
      expect(view.getUint32(28, true)).toBe(88200)
    })

    it('should handle silence (all zeros)', () => {
      const samples = new Float32Array(1000).fill(0)
      const blob = float32ToWav(samples)

      expect(blob.size).toBe(44 + 2000)
      expect(blob.type).toBe('audio/wav')
    })

    it('should handle maximum amplitude audio', () => {
      const samples = new Float32Array(100)
      for (let i = 0; i < 100; i++) {
        samples[i] = i % 2 === 0 ? 1 : -1
      }
      const blob = float32ToWav(samples)

      expect(blob.size).toBe(44 + 200)
    })
  })

  describe('blobToBase64', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should convert blob to base64 string', async () => {
      const blob = new Blob(['test'], { type: 'audio/wav' })
      const result = await blobToBase64(blob)

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should strip data URL prefix', async () => {
      const blob = new Blob(['test'], { type: 'audio/wav' })
      const result = await blobToBase64(blob)

      expect(result).not.toContain('data:')
      expect(result).not.toContain(';base64,')
    })

    it('should handle different blob types', async () => {
      const wavBlob = new Blob(['test'], { type: 'audio/wav' })
      const mp3Blob = new Blob(['test'], { type: 'audio/mp3' })

      const wavResult = await blobToBase64(wavBlob)
      const mp3Result = await blobToBase64(mp3Blob)

      expect(wavResult).toBeDefined()
      expect(mp3Result).toBeDefined()
    })
  })
})

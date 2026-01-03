import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import axios from 'axios'
import { sttApi } from './stt'

vi.mock('axios')
vi.mock('@/config', () => ({
  API_BASE_URL: 'http://localhost:5001'
}))

const mockedAxios = vi.mocked(axios)

describe('sttApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('transcribe', () => {
    it('should send audio blob as base64 with correct format', async () => {
      const mockResponse = {
        text: 'Hello world',
        language: 'en',
        language_probability: 0.95,
        duration: 1.5
      }
      mockedAxios.post.mockResolvedValueOnce({ data: mockResponse })

      const blob = new Blob(['test audio'], { type: 'audio/webm' })
      const result = await sttApi.transcribe(blob)

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:5001/api/stt/transcribe',
        expect.objectContaining({
          audio: expect.any(String),
          format: 'webm',
          model: undefined,
          language: undefined
        }),
        { params: { userId: 'default' } }
      )
      expect(result).toEqual(mockResponse)
    })

    it('should pass custom userId', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { text: '' } })

      const blob = new Blob(['test'], { type: 'audio/wav' })
      await sttApi.transcribe(blob, 'custom-user')

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        { params: { userId: 'custom-user' } }
      )
    })

    it('should pass model and language options', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { text: '' } })

      const blob = new Blob(['test'], { type: 'audio/wav' })
      await sttApi.transcribe(blob, 'default', { model: 'large-v3', language: 'es' })

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model: 'large-v3',
          language: 'es'
        }),
        expect.any(Object)
      )
    })

    it('should detect correct format for different mime types', async () => {
      mockedAxios.post.mockResolvedValue({ data: { text: '' } })

      const formats = [
        { mimeType: 'audio/webm', expected: 'webm' },
        { mimeType: 'audio/mp4', expected: 'mp4' },
        { mimeType: 'audio/ogg', expected: 'ogg' },
        { mimeType: 'audio/wav', expected: 'wav' },
        { mimeType: 'audio/mp3', expected: 'mp3' },
        { mimeType: 'audio/mpeg', expected: 'mp3' },
        { mimeType: 'audio/unknown', expected: 'webm' }
      ]

      for (const { mimeType, expected } of formats) {
        vi.clearAllMocks()
        const blob = new Blob(['test'], { type: mimeType })
        await sttApi.transcribe(blob)

        expect(mockedAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ format: expected }),
          expect.any(Object)
        )
      }
    })
  })

  describe('transcribeBase64', () => {
    it('should send raw base64 audio with format', async () => {
      const mockResponse = {
        text: 'Transcribed text',
        language: 'en',
        language_probability: 0.98,
        duration: 2.0
      }
      mockedAxios.post.mockResolvedValueOnce({ data: mockResponse })

      const base64Audio = 'SGVsbG8gV29ybGQ='
      const result = await sttApi.transcribeBase64(base64Audio, 'wav')

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:5001/api/stt/transcribe',
        {
          audio: 'SGVsbG8gV29ybGQ=',
          format: 'wav',
          model: undefined,
          language: undefined
        },
        { params: { userId: 'default' } }
      )
      expect(result).toEqual(mockResponse)
    })

    it('should pass model and language options', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { text: '' } })

      await sttApi.transcribeBase64('base64data', 'wav', {
        model: 'medium',
        language: 'fr'
      })

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          audio: 'base64data',
          format: 'wav',
          model: 'medium',
          language: 'fr'
        }),
        expect.any(Object)
      )
    })

    it('should pass custom userId', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { text: '' } })

      await sttApi.transcribeBase64('base64data', 'wav', undefined, 'user123')

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        { params: { userId: 'user123' } }
      )
    })

    it('should handle transcription errors', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Transcription failed'))

      await expect(sttApi.transcribeBase64('bad-data', 'wav')).rejects.toThrow('Transcription failed')
    })
  })

  describe('getModels', () => {
    it('should fetch available models', async () => {
      const mockModels = {
        models: ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3'],
        current: 'base',
        default: 'base'
      }
      mockedAxios.get.mockResolvedValueOnce({ data: mockModels })

      const result = await sttApi.getModels()

      expect(mockedAxios.get).toHaveBeenCalledWith('http://localhost:5001/api/stt/models')
      expect(result).toEqual(mockModels)
    })

    it('should handle fetch errors', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'))

      await expect(sttApi.getModels()).rejects.toThrow('Network error')
    })
  })

  describe('getStatus', () => {
    it('should fetch STT status with default userId', async () => {
      const mockStatus = {
        enabled: true,
        configured: true,
        server: {
          running: true,
          port: 5552,
          host: 'localhost',
          model: 'base',
          error: null
        },
        config: {
          model: 'base',
          language: 'auto',
          autoSubmit: false
        }
      }
      mockedAxios.get.mockResolvedValueOnce({ data: mockStatus })

      const result = await sttApi.getStatus()

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://localhost:5001/api/stt/status',
        { params: { userId: 'default' } }
      )
      expect(result).toEqual(mockStatus)
    })

    it('should pass custom userId', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: {} })

      await sttApi.getStatus('custom-user')

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        { params: { userId: 'custom-user' } }
      )
    })

    it('should handle status check errors', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Server unavailable'))

      await expect(sttApi.getStatus()).rejects.toThrow('Server unavailable')
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMkdir = vi.fn()
const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockReaddir = vi.fn()
const mockStat = vi.fn()
const mockUnlink = vi.fn()

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}

vi.mock('fs/promises', async () => {
  return {
    mkdir: mockMkdir,
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    readdir: mockReaddir,
    stat: mockStat,
    unlink: mockUnlink,
  }
})

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))
vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn(),
}))
vi.mock('../../src/utils/logger', async () => {
  return {
    logger: mockLogger,
  }
})

import { createTTSRoutes, cleanupExpiredCache, getCacheStats, generateCacheKey, ensureCacheDir, getCachedAudio, getCacheSize, cleanupOldestFiles } from '../../src/routes/tts'

describe('TTS Routes', () => {
  let mockDb: any
  let ttsApp: any
  let mockSettingsService: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    mockDb = {} as any
    mockSettingsService = {
      getSettings: vi.fn().mockReturnValue({
        preferences: {
          tts: {
            enabled: true,
            apiKey: 'test-key',
            endpoint: 'https://api.openai.com/v1/audio/speech',
            voice: 'alloy',
            model: 'tts-1',
            speed: 1.0,
          },
        },
      }),
    }
    
    ttsApp = createTTSRoutes(mockDb)
  })

  describe('generateCacheKey', () => {
    it('should generate consistent cache keys for identical inputs', () => {
      const text = 'Hello world'
      const voice = 'alloy'
      const model = 'tts-1'
      const speed = 1.0
      
      const key1 = generateCacheKey(text, voice, model, speed)
      const key2 = generateCacheKey(text, voice, model, speed)
      
      expect(key1).toBe(key2)
      expect(key1).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should generate different cache keys for different inputs', () => {
      const key1 = generateCacheKey('Hello', 'alloy', 'tts-1', 1.0)
      const key2 = generateCacheKey('World', 'alloy', 'tts-1', 1.0)
      
      expect(key1).not.toBe(key2)
    })
  })

  describe('ensureCacheDir', () => {
    it('should create cache directory when it does not exist', async () => {
      mockMkdir.mockResolvedValue(undefined)
      
      await ensureCacheDir()
      
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('cache/tts'),
        { recursive: true }
      )
    })
  })

  describe('getCachedAudio', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

beforeEach(() => {
      vi.useFakeTimers()
    })

    it('should return cached audio when file exists and is not expired', async () => {
      const cacheKey = 'test-key'
      const audioBuffer = Buffer.from('audio data')
      
      mockStat.mockResolvedValue({
        mtimeMs: Date.now() - 1000, // 1 second ago (not expired)
        size: 1024,
      })
      mockReadFile.mockResolvedValue(audioBuffer)
      
      const result = await getCachedAudio(cacheKey)
      
      expect(result).toBe(audioBuffer)
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining(`${cacheKey}.mp3`)
      )
    })

    it('should return null when cached file has expired', async () => {
      const cacheKey = 'test-key'
      
      mockStat.mockResolvedValue({
        mtimeMs: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago (expired)
        size: 1024,
      })
      mockUnlink.mockResolvedValue(undefined)
      
      const result = await getCachedAudio(cacheKey)
      
      expect(result).toBeNull()
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining(`${cacheKey}.mp3`)
      )
    })

    it('should return null when cached file does not exist', async () => {
      const cacheKey = 'nonexistent-key'
      
      mockStat.mockRejectedValue(new Error('File not found'))
      
      const result = await getCachedAudio(cacheKey)
      
      expect(result).toBeNull()
    })
  })

  describe('getCacheSize', () => {
    it('should calculate correct cache size', async () => {
      mockReaddir.mockResolvedValue(['file1.mp3', 'file2.mp3', 'readme.txt'])
      mockStat
        .mockResolvedValueOnce({ size: 1024, mtimeMs: Date.now() })
        .mockResolvedValueOnce({ size: 2048, mtimeMs: Date.now() })
      
      const size = await getCacheSize()
      
      expect(size).toBe(3072) // 1024 + 2048
    })

    it('should handle cache directory errors gracefully', async () => {
      mockReaddir.mockRejectedValue(new Error('Permission denied'))
      
      const size = await getCacheSize()
      
      expect(size).toBe(0)
    })
  })

  describe('cleanupMethods', () => {
    it('should remove oldest files when cache size limit exceeded', async () => {
      mockReaddir.mockResolvedValue(['file1.mp3', 'file2.mp3', 'file3.mp3'])
      mockStat
        .mockResolvedValueOnce({ size: 1024, mtimeMs: 1000 })
        .mockResolvedValueOnce({ size: 2048, mtimeMs: 2000 })
        .mockResolvedValueOnce({ size: 1536, mtimeMs: 3000 })
      mockUnlink.mockResolvedValue(undefined)
      
      await cleanupOldestFiles(1500) // Need 1500 bytes freed
      
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining('file1.mp3')
      )
    })

    it('should return cache statistics for files', async () => {
      const currentTime = Date.now()
      mockReaddir.mockResolvedValue(['file1.mp3', 'file2.mp3'])
      mockStat
        .mockResolvedValueOnce({ size: 1024, mtimeMs: currentTime })
        .mockResolvedValueOnce({ size: 2048, mtimeMs: currentTime })
      
      const stats = await getCacheStats()
      
      expect(stats.count).toBe(2)
      expect(stats.sizeBytes).toBe(3072)
      expect(stats.sizeMB).toBeCloseTo(0, 1)
    })

    it('should cleanup expired cache files', async () => {
      mockReaddir.mockResolvedValue(['file1.mp3', 'file2.mp3', 'expired.mp3'])
      mockStat
        .mockResolvedValueOnce({ size: 1024, mtimeMs: Date.now() })
        .mockResolvedValueOnce({ size: 2048, mtimeMs: Date.now() })
        .mockResolvedValueOnce({ size: 1536, mtimeMs: Date.now() - 25 * 60 * 60 * 1000 })
      mockUnlink.mockResolvedValue(undefined)
      
      const cleaned = await cleanupExpiredCache()
      
      expect(cleaned).toBe(1)
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining('expired.mp3')
      )
    })
  })
})
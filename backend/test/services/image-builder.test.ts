import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImageBuilder } from '../../src/services/image-builder'
import type { DevcontainerConfig } from '@opencode-manager/shared'
import { execCommand } from '../../src/utils/process'

vi.mock('../../src/utils/process', () => ({
  execCommand: vi.fn(),
}))

describe('ImageBuilder', () => {
  let builder: ImageBuilder
  let config: DevcontainerConfig

  beforeEach(() => {
    builder = new ImageBuilder()
    config = {
      name: 'minimal',
      build: {
        dockerfile: 'Dockerfile.nix',
        context: '.',
        args: {
          NIX_PACKAGES: 'git',
        },
      },
    }
    vi.clearAllMocks()
  })

  it('should return true when image exists', async () => {
    vi.mocked(execCommand).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

    const exists = await builder.imageExists('opencode-session:minimal-hash')

    expect(exists).toBe(true)
  })

  it('should build image when missing', async () => {
    vi.mocked(execCommand).mockImplementation(async (args: string[]) => {
      if (args[0] === 'docker' && args[1] === 'image') {
        return { exitCode: 1, stdout: '', stderr: '' }
      }
      if (args[0] === 'docker' && args[1] === 'build') {
        return ''
      }
      return ''
    })

    const imageId = await builder.ensureImage('minimal', 'hash123', config)

    expect(imageId).toBe('opencode-session:minimal-hash123')
    expect(execCommand).toHaveBeenCalledWith(
      expect.arrayContaining(['docker', 'build']),
      expect.any(Object)
    )
  })
})

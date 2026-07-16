import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WarpTarget } from '../src/warp.js'
import { setPendingWarp, takePendingWarp, buildAttachArgs, runPendingWarp } from '../src/warp.js'
import { REMOTE_MANAGER_URL_ENV, REMOTE_REPO_NAME_ENV } from '../src/remote-context.js'

const sampleTarget: WarpTarget = {
  managerUrl: 'https://manager.example.com',
  token: 'tok_abc123',
  directory: '/workspace/my-repo',
  sessionID: 'sess_42',
  repoName: 'my-repo',
}

describe('buildAttachArgs', () => {
  it('produces the exact argv array for a sample target', () => {
    const args = buildAttachArgs(sampleTarget)

    expect(args).toEqual([
      'attach',
      'https://manager.example.com/api/opencode-proxy',
      '--dir', '/workspace/my-repo',
      '--session', 'sess_42',
      '--password', 'tok_abc123',
      '--username', 'opencode',
    ])
  })
})

describe('setPendingWarp / takePendingWarp', () => {
  beforeEach(() => {
    takePendingWarp()
  })

  it('round-trips the target', () => {
    setPendingWarp(sampleTarget)
    expect(takePendingWarp()).toEqual(sampleTarget)
  })

  it('returns undefined on second take', () => {
    setPendingWarp(sampleTarget)
    takePendingWarp()
    expect(takePendingWarp()).toBeUndefined()
  })
})

describe('runPendingWarp', () => {
  beforeEach(() => {
    takePendingWarp()
  })

  it('is a no-op when nothing is pending', () => {
    const spawn = vi.fn()
    runPendingWarp(spawn)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('calls spawn once with the correct args and env', () => {
    const spawn = vi.fn()
    setPendingWarp(sampleTarget)

    runPendingWarp(spawn)

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      buildAttachArgs(sampleTarget),
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          [REMOTE_MANAGER_URL_ENV]: sampleTarget.managerUrl,
          [REMOTE_REPO_NAME_ENV]: sampleTarget.repoName,
        },
      },
    )
  })

  it('does not spawn again on a second invocation', () => {
    const spawn = vi.fn()
    setPendingWarp(sampleTarget)

    runPendingWarp(spawn)
    runPendingWarp(spawn)

    expect(spawn).toHaveBeenCalledOnce()
  })

  it('swallows a throwing spawn without propagating', () => {
    const spawn = vi.fn(() => { throw new Error('spawn failed') })
    setPendingWarp(sampleTarget)

    expect(() => runPendingWarp(spawn)).not.toThrow()
    expect(spawn).toHaveBeenCalledOnce()
  })
})
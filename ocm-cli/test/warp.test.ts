import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WarpTarget } from '../src/warp.js'
import { setPendingWarp, takePendingWarp, buildAttachInvocation, runPendingWarp } from '../src/warp.js'
import { REMOTE_MANAGER_URL_ENV, REMOTE_REPO_NAME_ENV } from '../src/remote-context.js'

const sampleTarget: WarpTarget = {
  managerUrl: 'https://manager.example.com',
  token: 'tok_abc123',
  repoId: 42,
  sessionID: 'sess_42',
  repoName: 'my-repo',
}

describe('buildAttachInvocation', () => {
  it('produces the server args and attach env for a target without a session', () => {
    const invocation = buildAttachInvocation({ managerUrl: 'https://manager.example.com', token: 'tok_abc123', repoId: 42, repoName: 'my-repo' })

    expect(invocation.args).toEqual([
      '--server',
      'https://manager.example.com/api/opencode-proxy/repos/42',
    ])
    expect(invocation.env).toEqual({
      ...process.env,
      OPENCODE_PASSWORD: 'tok_abc123',
      [REMOTE_MANAGER_URL_ENV]: 'https://manager.example.com',
      [REMOTE_REPO_NAME_ENV]: 'my-repo',
    })
  })

  it('appends the session arg when the target has one', () => {
    const invocation = buildAttachInvocation(sampleTarget)

    expect(invocation.args).toEqual([
      '--server',
      'https://manager.example.com/api/opencode-proxy/repos/42',
      '--session',
      'sess_42',
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
    const invocation = buildAttachInvocation(sampleTarget)

    runPendingWarp(spawn)

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      invocation.args,
      {
        stdio: 'inherit',
        env: invocation.env,
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

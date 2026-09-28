import { describe, expect, it } from 'vitest'
import {
  applyShellExit,
  childLifecycle,
  clearShellExitRecord,
  isRunningLifecycle,
  markShellDeleted,
  reconcileShellList,
  recordShellDeleted,
  recordShellExit,
  shellLifecycle,
  shellToolLifecycle,
  subagentLifecycle,
  upsertShell,
  type ShellRecord,
} from './backgroundWork'

const shell = (id: string, status: ShellRecord['status'], exit?: number, started = 1): ShellRecord => ({
  id,
  status,
  command: `npm run ${id}`,
  cwd: '/repo',
  shell: 'zsh',
  file: `/tmp/${id}.log`,
  metadata: { sessionID: 'session-1' },
  time: { started, ...(exit === undefined ? {} : { completed: started + 1 }) },
  ...(exit === undefined ? {} : { exit }),
})

describe('shellLifecycle', () => {
  it('maps every shell status to a lifecycle state', () => {
    expect(shellLifecycle(shell('a', 'running'))).toBe('running')
    expect(shellLifecycle(shell('b', 'exited', 0))).toBe('completed')
    expect(shellLifecycle(shell('c', 'exited', 1))).toBe('failed')
    expect(shellLifecycle(shell('d', 'timeout'))).toBe('failed')
    expect(shellLifecycle(shell('e', 'killed'))).toBe('killed')
    expect(shellLifecycle(shell('f', 'unavailable'))).toBe('unavailable')
  })

  it('treats an exited shell without an exit code as completed', () => {
    expect(shellLifecycle(shell('a', 'exited'))).toBe('completed')
  })

  it('never treats a missing shell as completed', () => {
    expect(shellLifecycle(undefined)).toBe('unknown')
    expect(isRunningLifecycle(shellLifecycle(undefined))).toBe(true)
  })
})

describe('childLifecycle', () => {
  it('never treats an unknown child as finished', () => {
    expect(childLifecycle({ type: 'idle' }, false, undefined)).toBe('unknown')
  })

  it('maps a known child status to a lifecycle state', () => {
    expect(childLifecycle({ type: 'idle' }, true, undefined)).toBe('completed')
    expect(childLifecycle({ type: 'idle' }, true, 'succeeded')).toBe('completed')
    expect(childLifecycle({ type: 'idle' }, true, 'failed')).toBe('failed')
    expect(childLifecycle({ type: 'idle' }, true, 'interrupted')).toBe('interrupted')
    expect(childLifecycle({ type: 'busy' }, true, undefined)).toBe('running')
    expect(childLifecycle({ type: 'compact' }, true, undefined)).toBe('running')
    expect(childLifecycle({ type: 'retry', attempt: 1, message: 'retry', next: 2 }, true, undefined)).toBe('running')
  })
})

describe('subagentLifecycle', () => {
  it('fails on a tool error', () => {
    expect(subagentLifecycle('error', false, 'completed')).toBe('failed')
  })

  it('keeps an unknown backgrounded child running', () => {
    expect(subagentLifecycle('completed', true, 'unknown')).toBe('unknown')
  })

  it('completes a backgrounded child once its status is known idle', () => {
    expect(subagentLifecycle('completed', true, 'completed')).toBe('completed')
  })

  it('reports a failed backgrounded child as failed', () => {
    expect(subagentLifecycle('completed', true, 'failed')).toBe('failed')
  })

  it('reports an interrupted backgrounded child as interrupted', () => {
    expect(subagentLifecycle('completed', true, 'interrupted')).toBe('interrupted')
  })

  it('completes a foreground subagent whose child is known idle', () => {
    expect(subagentLifecycle('running', false, 'completed')).toBe('completed')
  })

  it('keeps a foreground subagent running while its child status is unknown', () => {
    expect(subagentLifecycle('running', false, 'unknown')).toBe('running')
  })
})

describe('shellToolLifecycle', () => {
  it('reports a non-background shell call as completed', () => {
    expect(shellToolLifecycle(undefined, undefined, true)).toBe('completed')
  })

  it('reports a background shell from its live status', () => {
    expect(shellToolLifecycle('sh_1', shell('sh_1', 'killed'), true)).toBe('killed')
  })

  it('keeps a shell unknown until the list loads, then unavailable when absent', () => {
    expect(shellToolLifecycle('sh_1', undefined, false)).toBe('unknown')
    expect(shellToolLifecycle('sh_1', undefined, true)).toBe('unavailable')
  })
})

describe('reconcileShellList', () => {
  it('preserves a terminal shell when a stale list reports it running', () => {
    const cached = shell('a', 'exited', 0)
    const fetched = shell('a', 'running')

    expect(reconcileShellList([cached], [fetched], 100, '/repo')).toEqual([cached])
  })

  it('accepts a terminal status from the list', () => {
    const fetched = shell('a', 'exited', 0)

    expect(reconcileShellList([shell('a', 'running')], [fetched], 100, '/repo')).toEqual([fetched])
  })

  it('preserves a running shell created after a stale fetch started', () => {
    const cached = shell('a', 'running', undefined, 200)

    expect(reconcileShellList([cached], [], 100, '/repo')).toEqual([cached])
  })

  it('preserves terminal history omitted from a fresh fetch', () => {
    const cached = shell('a', 'exited', 0, 50)

    expect(reconcileShellList([cached], [], 100, '/repo')).toEqual([cached])
  })

  it('marks a running shell omitted from a fresh fetch as unavailable', () => {
    const cached = shell('a', 'running', undefined, 50)

    const [result] = reconcileShellList([cached], [], 100, '/repo')

    expect(result?.status).toBe('unavailable')
    expect(result?.time.completed).toBeDefined()
  })

  it('applies a shell exit recorded before the list was seeded', () => {
    recordShellExit('/repo', { id: 'a', status: 'exited', exit: 0 })

    const [result] = reconcileShellList([], [shell('a', 'running')], 100, '/repo')

    expect(result?.status).toBe('exited')
    expect(result?.exit).toBe(0)

    clearShellExitRecord('/repo', 'a')
  })

  it('applies a shell deletion recorded before the list was seeded', () => {
    recordShellDeleted('/repo', 'a')

    const [result] = reconcileShellList([], [shell('a', 'running')], 100, '/repo')

    expect(result?.status).toBe('unavailable')

    clearShellExitRecord('/repo', 'a')
  })

  it('does not apply a shell exit recorded for another directory', () => {
    recordShellExit('/other', { id: 'a', status: 'exited', exit: 0 })

    const [result] = reconcileShellList([], [shell('a', 'running')], 100, '/repo')

    expect(result?.status).toBe('running')

    clearShellExitRecord('/other', 'a')
  })
})

describe('upsertShell', () => {
  it('does not downgrade a terminal shell to running', () => {
    const cached = shell('a', 'exited', 0)

    expect(upsertShell([cached], shell('a', 'running'), '/repo')).toEqual([cached])
  })

  it('does not downgrade an unavailable shell to running', () => {
    const cached = shell('a', 'unavailable')

    expect(upsertShell([cached], shell('a', 'running'), '/repo')).toEqual([cached])
  })

  it('does not resurrect a shell deleted before the cache was seeded', () => {
    recordShellDeleted('/repo', 'a')

    const [result] = upsertShell([], shell('a', 'running'), '/repo')

    expect(result?.status).toBe('unavailable')

    clearShellExitRecord('/repo', 'a')
  })

  it('replaces a running shell with the latest info', () => {
    const next = shell('a', 'exited', 0)

    expect(upsertShell([shell('a', 'running')], next, '/repo')).toEqual([next])
  })

  it('appends a newly created shell', () => {
    expect(upsertShell([shell('a', 'running')], shell('b', 'running'), '/repo').map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('applyShellExit', () => {
  it('marks a matching shell terminal and records its completion', () => {
    const [result] = applyShellExit([shell('a', 'running')], { id: 'a', status: 'exited', exit: 0 })

    expect(result?.status).toBe('exited')
    expect(result?.exit).toBe(0)
    expect(result?.time.completed).toBeDefined()
  })

  it('does not turn an unavailable shell back into running', () => {
    const [result] = applyShellExit([shell('a', 'unavailable')], { id: 'a', status: 'running' })

    expect(result?.status).toBe('unavailable')
  })

  it('leaves unrelated shells untouched', () => {
    const other = shell('b', 'running')
    const [result] = applyShellExit([other], { id: 'a', status: 'killed' })

    expect(result).toBe(other)
  })
})

describe('markShellDeleted', () => {
  it('keeps the shell visible as unavailable instead of erasing it', () => {
    const [result] = markShellDeleted([shell('a', 'running')], 'a')

    expect(result?.id).toBe('a')
    expect(result?.status).toBe('unavailable')
  })

  it('does not reset a terminal shell to running', () => {
    const [result] = markShellDeleted([shell('a', 'exited', 0)], 'a')

    expect(result?.status).toBe('exited')
  })
})

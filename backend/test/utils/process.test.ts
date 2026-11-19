import { describe, expect, it } from 'vitest'
import { applyTestEnv } from '../helpers/test-env'
import { executeCommand } from '../../src/utils/process'
import { expectLoggedMessage, testLogEntries } from '../helpers/log-assertions'

describe('executeCommand signal handling', () => {
  it('reports a signal-terminated child as a non-zero exit code when exit codes are ignored', async () => {
    const result = await executeCommand(['sh', '-c', 'kill -KILL $$'], { ignoreExitCode: true, silent: true } as const)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Command terminated by signal SIGKILL')
  })

  it('rejects a signal-terminated child when exit codes are enforced', async () => {
    await expect(executeCommand(['sh', '-c', 'kill -KILL $$'], { silent: true })).rejects.toThrow(
      'Command failed with signal SIGKILL',
    )
  })

  it('resolves a zero exit code as success when exit codes are ignored', async () => {
    const result = await executeCommand(['sh', '-c', 'true'], { ignoreExitCode: true, silent: true } as const)

    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('truncates stdout at maxOutputChars and resolves instead of rejecting', async () => {
    const result = await executeCommand(
      ['sh', '-c', 'i=0; while [ $i -lt 1000 ]; do printf "0123456789"; i=$((i+1)); done'],
      { maxOutputChars: 100, silent: true },
    )

    expect(result).toHaveLength(100)
  })

  it('flags truncated output on the structured result when exit codes are ignored', async () => {
    const result = await executeCommand(
      ['sh', '-c', 'i=0; while [ $i -lt 1000 ]; do printf "0123456789"; i=$((i+1)); done'],
      { maxOutputChars: 100, silent: true, ignoreExitCode: true } as const,
    )

    expect(result.truncated).toBe(true)
    expect(result.stdout).toHaveLength(100)
  })

  it('returns the full stdout when it stays within maxOutputChars', async () => {
    const result = await executeCommand(['sh', '-c', 'printf "hello"'], { maxOutputChars: 100, silent: true })

    expect(result).toBe('hello')
  })

  it('logs only a git command at debug level', async () => {
    const restoreEnv = applyTestEnv({ DEBUG: '1' })
    try {
      await executeCommand(['git', '--version'], { silent: true })
      await executeCommand(['sh', '-c', 'true'], { silent: true })

      const debugEntries = testLogEntries('debug')
      expect(debugEntries).toHaveLength(1)
      expect(debugEntries[0]?.message).toContain('git --version')
      expect(testLogEntries().map((entry) => entry.level)).toEqual(['debug'])
    } finally {
      restoreEnv()
    }
  })

  it('logs a failing command at error level', async () => {
    await expect(executeCommand(['sh', '-c', 'exit 3'])).rejects.toThrow('Command failed')

    expectLoggedMessage('Command failed', 'error')
    expect(testLogEntries().map((entry) => entry.level)).toEqual(['error'])
  })
})

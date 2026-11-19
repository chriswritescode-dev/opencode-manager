import { describe, it, expect, vi } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import { confirmDialog, selectDialog, slashArgument } from '../src/tui-dialogs.js'
import type { DialogHost } from '../src/tui-dialogs.js'

function createFakeContext() {
  const confirm = vi.fn<Context['ui']['dialog']['confirm']>()
  const select = vi.fn()
  const context: DialogHost = { ui: { dialog: { confirm, select } } }
  return { context, confirm, select }
}

describe('confirmDialog', () => {
  it('resolves true when the dialog confirms', async () => {
    const { context, confirm } = createFakeContext()
    confirm.mockResolvedValue(true)

    expect(await confirmDialog(context, { title: 'Confirm', message: 'Continue?' })).toBe(true)
    expect(confirm).toHaveBeenCalledWith({ title: 'Confirm', message: 'Continue?' })
  })

  it.each([
    ['the dialog is dismissed', undefined],
    ['the dialog explicitly cancels', false],
  ])('resolves false when %s', async (_label, answer) => {
    const { context, confirm } = createFakeContext()
    confirm.mockResolvedValue(answer)

    expect(await confirmDialog(context, { title: 'Confirm', message: 'Continue?' })).toBe(false)
  })
})

describe('selectDialog', () => {
  it('resolves the chosen option value', async () => {
    const { context, select } = createFakeContext()
    const options = [
      { title: 'A', value: 'a' },
      { title: 'B', value: 'b' },
    ]
    select.mockResolvedValue('b')

    expect(await selectDialog(context, 'Pick one', options)).toBe('b')
    expect(select).toHaveBeenCalledWith({ title: 'Pick one', options })
  })

  it('resolves undefined when the dialog is dismissed', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValue(undefined)

    expect(await selectDialog(context, 'Pick', [{ title: 'X', value: 42 }])).toBeUndefined()
  })
})

describe('slashArgument', () => {
  it.each([
    [undefined, 'goal', ''],
    ['/goal  fix it ', 'goal', 'fix it'],
    ['  fix it  ', 'goal', 'fix it'],
    ['/goalie x', 'goal', '/goalie x'],
    ['/goal', 'goal', ''],
  ])('turns %s into %s', (input, name, expected) => {
    expect(slashArgument(input, name)).toBe(expected)
  })
})

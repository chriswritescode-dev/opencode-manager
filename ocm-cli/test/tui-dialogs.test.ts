import { describe, it, expect, vi } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import { confirmDialog, selectDialog } from '../src/tui-dialogs.js'

function createFakeContext() {
  const confirm = vi.fn()
  const select = vi.fn()
  const context = {
    ui: { dialog: { confirm, select } },
  } as unknown as Context
  return { context, confirm, select }
}

describe('confirmDialog', () => {
  it('resolves true when the dialog confirms', async () => {
    const { context, confirm } = createFakeContext()
    confirm.mockResolvedValue(true)

    expect(await confirmDialog(context, { title: 'Confirm', message: 'Continue?' })).toBe(true)
    expect(confirm).toHaveBeenCalledWith({ title: 'Confirm', message: 'Continue?' })
  })

  it('resolves false when the dialog is dismissed', async () => {
    const { context, confirm } = createFakeContext()
    confirm.mockResolvedValue(undefined)

    expect(await confirmDialog(context, { title: 'Confirm', message: 'Continue?' })).toBe(false)
  })

  it('resolves false when the dialog explicitly cancels', async () => {
    const { context, confirm } = createFakeContext()
    confirm.mockResolvedValue(false)

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

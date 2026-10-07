import { describe, it, expect, vi } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import { confirmDialog, multiSelectDialog, promptDialog, selectDialog, slashArgument } from '../src/tui-dialogs.js'

function createFakeContext() {
  const confirm = vi.fn()
  const select = vi.fn()
  const prompt = vi.fn()
  const context = {
    ui: { dialog: { confirm, select, prompt } },
  } as unknown as Context
  return { context, confirm, select, prompt }
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

describe('promptDialog', () => {
  it('forwards the options and resolves the trimmed value', async () => {
    const { context, prompt } = createFakeContext()
    prompt.mockResolvedValue('  fix it  ')

    const props = { title: 'Goal', description: 'What do you want?', placeholder: 'Describe it', value: 'seed' }

    expect(await promptDialog(context, props)).toBe('fix it')
    expect(prompt).toHaveBeenCalledWith(props)
  })

  it('resolves undefined when the dialog is dismissed', async () => {
    const { context, prompt } = createFakeContext()
    prompt.mockResolvedValue(undefined)

    expect(await promptDialog(context, { title: 'Goal' })).toBeUndefined()
  })

  it('resolves undefined when the value is blank', async () => {
    const { context, prompt } = createFakeContext()
    prompt.mockResolvedValue('   ')

    expect(await promptDialog(context, { title: 'Goal' })).toBeUndefined()
  })
})

describe('multiSelectDialog', () => {
  const options = [
    { title: 'A', value: 'a' },
    { title: 'B', value: 'b' },
    { title: 'C', value: 'c' },
  ]

  it('resolves selected values in option order', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(-1)

    expect(await multiSelectDialog(context, { title: 'Pick', options, min: 1, max: 3 })).toEqual(['a', 'b'])
    expect(select).toHaveBeenCalledTimes(3)
  })

  it('disables the done entry while fewer than min are selected', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1)

    await multiSelectDialog(context, { title: 'Pick', options, min: 2, max: 3 })

    expect(select.mock.calls[0][0].options[0]).toEqual({ title: 'Done (0 selected)', value: -1, disabled: true })
    expect(select.mock.calls[1][0].options[0]).toEqual({ title: 'Done (1 selected)', value: -1, disabled: true })
  })

  it('enables the done entry once min are selected', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1)

    await multiSelectDialog(context, { title: 'Pick', options, min: 1, max: 3 })

    expect(select.mock.calls[1][0].options[0]).toEqual({ title: 'Done (1 selected)', value: -1, disabled: false })
  })

  it('disables unselected options once max are selected', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1)

    await multiSelectDialog(context, { title: 'Pick', options, min: 1, max: 1 })

    const second = select.mock.calls[1][0].options
    expect(second[1]).toMatchObject({ title: '[x] A', value: 0, disabled: false })
    expect(second[2]).toMatchObject({ title: '[ ] B', value: 1, disabled: true })
    expect(second[3]).toMatchObject({ title: '[ ] C', value: 2, disabled: true })
  })

  it('marks selected options with an x marker', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(1).mockResolvedValueOnce(-1)

    await multiSelectDialog(context, { title: 'Pick', options, min: 1, max: 3 })

    const first = select.mock.calls[0][0].options
    expect(first[1]).toMatchObject({ title: '[ ] A' })
    expect(first[2]).toMatchObject({ title: '[ ] B' })
    const second = select.mock.calls[1][0].options
    expect(second[1]).toMatchObject({ title: '[ ] A' })
    expect(second[2]).toMatchObject({ title: '[x] B' })
  })

  it('keeps the cursor on the last toggled entry', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(2).mockResolvedValueOnce(0).mockResolvedValueOnce(-1)

    await multiSelectDialog(context, { title: 'Pick', options, min: 1, max: 3 })

    expect(select.mock.calls[0][0].current).toBeUndefined()
    expect(select.mock.calls[1][0].current).toBe(2)
    expect(select.mock.calls[2][0].current).toBe(0)
  })

  it('toggles a selected option off', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(-1)

    expect(await multiSelectDialog(context, { title: 'Pick', options, min: 1, max: 3 })).toEqual(['b'])
  })

  it('resolves undefined when dismissed before any selection', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(undefined)

    expect(await multiSelectDialog(context, { title: 'Pick', options, min: 1, max: 3 })).toBeUndefined()
  })

  it('resolves undefined when dismissed after a selection', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(0).mockResolvedValueOnce(undefined)

    expect(await multiSelectDialog(context, { title: 'Pick', options, min: 1, max: 3 })).toBeUndefined()
  })

  it('passes option descriptions through', async () => {
    const { context, select } = createFakeContext()
    select.mockResolvedValueOnce(-1)

    await multiSelectDialog(context, {
      title: 'Pick',
      options: [{ title: 'A', description: 'first', value: 'a' }],
      min: 0,
      max: 1,
    })

    expect(select.mock.calls[0][0].options[1]).toEqual({
      title: '[ ] A',
      description: 'first',
      value: 0,
      disabled: false,
    })
  })
})

describe('slashArgument', () => {
  it('resolves an empty string for undefined input', () => {
    expect(slashArgument(undefined, 'goal')).toBe('')
  })

  it('strips a leading slash token and trims the rest', () => {
    expect(slashArgument('/goal  fix it ', 'goal')).toBe('fix it')
  })

  it('returns the trimmed argument when no slash token is present', () => {
    expect(slashArgument('  fix it  ', 'goal')).toBe('fix it')
  })

  it('only strips a whole-token match', () => {
    expect(slashArgument('/goalie x', 'goal')).toBe('/goalie x')
  })

  it('resolves an empty string when only the slash token is present', () => {
    expect(slashArgument('/goal', 'goal')).toBe('')
  })
})

import { describe, it, expect, vi } from 'vitest'
import type { TuiPluginApi, TuiDialogConfirmProps, TuiDialogSelectProps } from '../src/tui-types.js'
import { confirmDialog, selectDialog } from '../src/tui-dialogs.js'

function createFakeApi() {
  let capturedRender: (() => unknown) | undefined
  let capturedOnClose: (() => void) | undefined
  let clearCount = 0

  const api = {
    route: { current: { name: 'session' as const, params: { sessionID: 's1' } } },
    state: { session: { get: () => undefined } },
    ui: {
      toast: vi.fn(),
      DialogConfirm: (props: TuiDialogConfirmProps) => props,
      DialogSelect: <Value,>(props: TuiDialogSelectProps<Value>) => props,
      dialog: {
        replace: vi.fn((render: () => unknown, onClose?: () => void) => {
          capturedRender = render
          capturedOnClose = onClose
        }),
        clear: vi.fn(() => { clearCount++ }),
      },
    },
    keymap: { registerLayer: vi.fn(), dispatchCommand: vi.fn() },
    slots: { register: vi.fn() },
    lifecycle: { signal: new AbortController().signal, onDispose: vi.fn() },
  } satisfies TuiPluginApi

  const getCaptured = () => {
    const render = capturedRender!
    const onClose = capturedOnClose
    return { render, onClose }
  }

  return { api, getCaptured, getClearCount: () => clearCount }
}

describe('confirmDialog', () => {
  it('resolves true when onConfirm fires', async () => {
    const { api, getCaptured } = createFakeApi()
    const p = confirmDialog(api, { title: 'Confirm', message: 'Continue?' })

    const { render } = getCaptured()
    const props = render() as TuiDialogConfirmProps
    props.onConfirm!()

    expect(await p).toBe(true)
    expect(api.ui.dialog.clear).toHaveBeenCalledOnce()
  })

  it('resolves false when onCancel fires', async () => {
    const { api, getCaptured } = createFakeApi()
    const p = confirmDialog(api, { title: 'Confirm', message: 'Continue?' })

    const { render } = getCaptured()
    const props = render() as TuiDialogConfirmProps
    props.onCancel!()

    expect(await p).toBe(false)
    expect(api.ui.dialog.clear).toHaveBeenCalledOnce()
  })

  it('resolves false when onClose fires without calling clear', async () => {
    const { api, getCaptured } = createFakeApi()
    const p = confirmDialog(api, { title: 'Confirm', message: 'Continue?' })

    const { onClose } = getCaptured()
    onClose!()

    expect(await p).toBe(false)
    expect(api.ui.dialog.clear).not.toHaveBeenCalled()
  })

  it('resolves only once when onConfirm then onClose both fire', async () => {
    const { api, getCaptured } = createFakeApi()
    const p = confirmDialog(api, { title: 'Confirm', message: 'Continue?' })

    const { render, onClose } = getCaptured()
    const props = render() as TuiDialogConfirmProps
    props.onConfirm!()
    onClose!()

    expect(await p).toBe(true)
    expect(api.ui.dialog.clear).toHaveBeenCalledOnce()
  })

  it('resolves only once when onClose then onConfirm both fire', async () => {
    const { api, getCaptured } = createFakeApi()
    const p = confirmDialog(api, { title: 'Confirm', message: 'Continue?' })

    const { render, onClose } = getCaptured()
    onClose!()
    const props = render() as TuiDialogConfirmProps
    props.onConfirm!()

    expect(await p).toBe(false)
    expect(api.ui.dialog.clear).not.toHaveBeenCalled()
  })
})

describe('selectDialog', () => {
  it('resolves the chosen option value via onSelect', async () => {
    const { api, getCaptured } = createFakeApi()
    const options = [
      { title: 'A', value: 'a' },
      { title: 'B', value: 'b' },
    ]
    const p = selectDialog(api, 'Pick one', options)

    const { render } = getCaptured()
    const props = render() as TuiDialogSelectProps<string>
    props.onSelect!(props.options[1]!)

    expect(await p).toBe('b')
    expect(api.ui.dialog.clear).toHaveBeenCalledOnce()
  })

  it('resolves undefined when onClose fires without calling clear', async () => {
    const { api, getCaptured } = createFakeApi()
    const options = [{ title: 'X', value: 42 }]
    const p = selectDialog(api, 'Pick', options)

    const { onClose } = getCaptured()
    onClose!()

    expect(await p).toBeUndefined()
    expect(api.ui.dialog.clear).not.toHaveBeenCalled()
  })

  it('resolves only once when onSelect then onClose both fire', async () => {
    const { api, getCaptured } = createFakeApi()
    const options = [{ title: 'A', value: 'a' }]
    const p = selectDialog(api, 'Pick', options)

    const { render, onClose } = getCaptured()
    const props = render() as TuiDialogSelectProps<string>
    props.onSelect!(props.options[0]!)
    onClose!()

    expect(await p).toBe('a')
    expect(api.ui.dialog.clear).toHaveBeenCalledOnce()
  })
})
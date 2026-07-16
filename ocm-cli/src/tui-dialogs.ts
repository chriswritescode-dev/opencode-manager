import type { TuiPluginApi } from './tui-types.js'

export function confirmDialog(api: TuiPluginApi, props: { title: string; message: string }): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (value: boolean, clearDialog = true) => {
      if (settled) return
      settled = true
      if (clearDialog) api.ui.dialog.clear()
      resolve(value)
    }
    api.ui.dialog.replace(
      () => api.ui.DialogConfirm({ ...props, onConfirm: () => settle(true), onCancel: () => settle(false) }),
      () => settle(false, false),
    )
  })
}

export function selectDialog<Value>(
  api: TuiPluginApi,
  title: string,
  options: { title: string; description?: string; value: Value }[],
): Promise<Value | undefined> {
  return new Promise<Value | undefined>((resolve) => {
    let settled = false
    const settle = (value: Value | undefined, clearDialog = true) => {
      if (settled) return
      settled = true
      if (clearDialog) api.ui.dialog.clear()
      resolve(value)
    }
    const mapped = options.map((o) => ({ ...o, onSelect: () => settle(o.value) }))
    api.ui.dialog.replace(
      () => api.ui.DialogSelect({ title, options: mapped, onSelect: (o) => settle(o.value as Value) }),
      () => settle(undefined, false),
    )
  })
}
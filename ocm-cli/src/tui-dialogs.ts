import type { Context } from '@opencode/plugin/tui/context'

export function confirmDialog(context: Context, props: { title: string; message: string }): Promise<boolean> {
  return context.ui.dialog.confirm(props).then((value) => value === true)
}

export function selectDialog<Value>(
  context: Context,
  title: string,
  options: { title: string; description?: string; value: Value }[],
): Promise<Value | undefined> {
  return context.ui.dialog.select({ title, options })
}

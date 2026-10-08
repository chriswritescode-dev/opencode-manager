import type { Context, DialogSelectOption } from '@opencode/plugin/tui/context'

export function confirmDialog(context: Context, props: { title: string; message: string }): Promise<boolean> {
  return context.ui.dialog.confirm(props).then((value) => value === true)
}

export function selectDialog<Value>(
  context: Context,
  title: string,
  options: readonly DialogSelectOption<Value>[],
): Promise<Value | undefined> {
  return context.ui.dialog.select({ title, options })
}

type SessionInfo = NonNullable<ReturnType<Context['data']['session']['get']>>

export type SessionTarget = { sessionID: string; directory: string; session: SessionInfo }

/** Resolves the routed session and its directory, or shows an error toast and returns undefined. */
export function requireSessionTarget(context: Context): SessionTarget | undefined {
  const route = context.ui.router.current()
  if (route.type !== 'session') {
    context.ui.toast.show({ variant: 'error', message: 'Not in a session' })
    return undefined
  }
  const session = context.data.session.get(route.sessionID)
  const directory = session?.location.directory
  if (!session || !directory) {
    context.ui.toast.show({ variant: 'error', message: 'Session has no directory' })
    return undefined
  }
  return { sessionID: route.sessionID, directory, session }
}

export function slashArgument(input: string | undefined, name: string): string {
  const trimmed = (input ?? '').trim()
  const prefix = `/${name}`
  if (trimmed === prefix) return ''
  if (trimmed.startsWith(`${prefix} `)) return trimmed.slice(prefix.length).trim()
  return trimmed
}

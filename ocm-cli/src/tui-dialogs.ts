import type { Context, DialogPromptOptions } from '@opencode/plugin/tui/context'

const DONE = -1

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

export function promptDialog(context: Context, props: DialogPromptOptions): Promise<string | undefined> {
  return context.ui.dialog.prompt(props).then((value) => {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
  })
}

export async function multiSelectDialog<Value>(
  context: Context,
  props: {
    title: string
    options: { title: string; description?: string; value: Value }[]
    min: number
    max: number
  },
): Promise<Value[] | undefined> {
  const selected = new Set<number>()
  let current: number | undefined

  for (;;) {
    const options = [
      {
        title: `Done (${selected.size} selected)`,
        value: DONE,
        disabled: selected.size < props.min,
      },
      ...props.options.map((option, index) => ({
        title: `${selected.has(index) ? '[x]' : '[ ]'} ${option.title}`,
        description: option.description,
        value: index,
        disabled: !selected.has(index) && selected.size >= props.max,
      })),
    ]

    const choice = await context.ui.dialog.select({ title: props.title, options, current })

    if (choice === undefined) return undefined
    if (choice === DONE) {
      return props.options.filter((_, index) => selected.has(index)).map((option) => option.value)
    }

    current = choice
    if (selected.has(choice)) {
      selected.delete(choice)
    } else {
      selected.add(choice)
    }
  }
}

export function slashArgument(input: string | undefined, name: string): string {
  const trimmed = (input ?? '').trim()
  const prefix = `/${name}`
  if (trimmed === prefix) return ''
  if (trimmed.startsWith(`${prefix} `)) return trimmed.slice(prefix.length).trim()
  return trimmed
}

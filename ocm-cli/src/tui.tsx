/** @jsxImportSource @opentui/solid */
import { createSignal, createEffect, onCleanup, Show } from 'solid-js'
import { setupOcm, readRemoteContext } from './tui-plugin.js'
import { formatMoveProgress } from './move-progress.js'
import type { MoveProgress } from './move-progress.js'
import type { TuiPluginApi, TuiPluginModule, TuiSlotContext } from './tui-types.js'

const SPINNER_INTERVAL_MS = 80

const tui = async (api: TuiPluginApi): Promise<void> => {
  const [moveProgress, setMoveProgress] = createSignal<MoveProgress | null>(null)
  await setupOcm(api, setMoveProgress)

  const moveIndicator = (ctx: TuiSlotContext) => {
    const theme = ctx.theme.current
    const [frame, setFrame] = createSignal(0)
    createEffect(() => {
      if (!moveProgress()) return
      const timer = setInterval(() => setFrame((f) => f + 1), SPINNER_INTERVAL_MS)
      onCleanup(() => clearInterval(timer))
    })
    return (
      <box flexDirection="row" flexShrink={0}>
        <Show when={moveProgress()}>
          {(progress) => <text fg={theme.accent}>{formatMoveProgress(progress(), frame())}</text>}
        </Show>
      </box>
    )
  }

  api.slots.register({
    order: 290,
    slots: { session_prompt_right: moveIndicator },
  })

  const remote = readRemoteContext(process.env)
  if (!remote) return

  const indicator = (ctx: TuiSlotContext) => {
    const theme = ctx.theme.current
    return (
      <box flexDirection="row" flexShrink={0} gap={1}>
        <text fg={theme.accent}>{remote.managerHost}</text>
        {remote.repoName && (
          <text fg={theme.textMuted}> · {remote.repoName}</text>
        )}
      </box>
    )
  }

  api.slots.register({
    order: 300,
    slots: {
      session_prompt_right: indicator,
      home_prompt_right: indicator,
    },
  })
}

export default { id: 'ocm', tui } satisfies TuiPluginModule

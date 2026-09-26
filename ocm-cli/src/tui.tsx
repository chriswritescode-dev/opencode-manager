/** @jsxImportSource @opentui/solid */
import { createSignal, createEffect, onCleanup, Show } from 'solid-js'
import { Plugin } from '@opencode/plugin/tui'
import { setupOcm } from './tui-plugin.js'
import { formatMoveProgress } from './move-progress.js'
import type { MoveProgress } from './move-progress.js'
import { readRemoteContext } from './remote-context.js'

const SPINNER_INTERVAL_MS = 80

export default Plugin.define({
  id: 'ocm',
  async setup(context) {
    const [moveProgress, setMoveProgress] = createSignal<MoveProgress | null>(null)

    const moveIndicator = () => {
      const [frame, setFrame] = createSignal(0)
      createEffect(() => {
        if (!moveProgress()) return
        const timer = setInterval(() => setFrame((f) => f + 1), SPINNER_INTERVAL_MS)
        onCleanup(() => clearInterval(timer))
      })
      return (
        <box flexDirection="row" flexShrink={0}>
          <Show when={moveProgress()}>
            {(progress) => <text fg={context.theme.hue.accent[200]}>{formatMoveProgress(progress(), frame())}</text>}
          </Show>
        </box>
      )
    }

    context.ui.slot({ append: 'prompt.footer.status', render: moveIndicator })

    const remote = readRemoteContext(process.env)
    if (remote) {
      const indicator = () => (
        <box flexDirection="row" flexShrink={0} gap={1}>
          <text fg={context.theme.hue.accent[200]}>{remote.managerHost}</text>
          {remote.repoName && <text fg={context.theme.text.muted}> · {remote.repoName}</text>}
        </box>
      )

      context.ui.slot({ append: 'prompt.footer.status', render: indicator })
      context.ui.slot({ append: 'home.footer.status', render: indicator })
    }

    return setupOcm(context, setMoveProgress)
  },
})

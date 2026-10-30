/** @jsxImportSource @opentui/solid */
import { createSignal, createEffect, onCleanup, Show } from 'solid-js'
import { Plugin } from '@opencode/plugin/tui'
import type { HueScale } from '@opencode/theme/tui'
import { setupOcm } from './tui-plugin.js'
import { showMultiRunLaunchDialog, showMultiRunsDialog } from './tui-multi-run-dialogs.js'
import { formatMoveProgress } from './move-progress.js'
import type { MoveProgress } from './move-progress.js'
import { readRemoteContext, remoteDisplayName } from './remote-context.js'
import { readState } from './state.js'

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
      const managerLabel = remoteDisplayName(remote, readState())
      const namedHues: Readonly<Record<string, HueScale | undefined>> = context.theme.hue
      const indicator = () => (
        <box flexDirection="row" flexShrink={0} gap={1}>
          <text fg={namedHues.orange?.[400] ?? context.theme.text.feedback.warning.base}>{managerLabel}</text>
          {remote.repoName && <text fg={context.theme.text.muted}> · {remote.repoName}</text>}
        </box>
      )

      context.ui.slot({ append: 'prompt.footer.status', render: indicator })
      context.ui.slot({ append: 'home.footer.status', render: indicator })
    }

    return setupOcm(context, setMoveProgress, {
      remote,
      dialogs: {
        multiRunLaunch: (props) => showMultiRunLaunchDialog(context, props),
        multiRuns: (props) => showMultiRunsDialog(context, props),
      },
    })
  },
})

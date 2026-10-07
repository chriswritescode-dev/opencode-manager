/** @jsxImportSource @opentui/solid */
import { createSignal, createEffect, onCleanup, Show } from 'solid-js'
import { Plugin } from '@opencode/plugin/tui'
import { setupOcm } from './tui-plugin.js'
import { formatMoveProgress } from './move-progress.js'
import type { MoveProgress } from './move-progress.js'
import { readRemoteContext } from './remote-context.js'
import { createGoalStore, isOpenGoal } from './goal-store.js'
import type { GoalStore } from './goal-store.js'
import { formatGoalStatus, goalOutcomeToast } from './tui-goal.js'
import { ManagerApi } from './manager-api.js'
import { resolveManagerAuth } from './manager-auth.js'
import type { SessionGoal } from '@opencode-manager/shared/schemas'

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

    const goals = remote
      ? createGoalStore({
          load: async (sessionID) => {
            const auth = await resolveManagerAuth(remote.managerUrl)
            if (!auth.ok) throw new Error(auth.message)
            return new ManagerApi(auth.managerUrl, auth.token).getLatestSessionGoal(sessionID)
          },
          onOutcome: (goal) => {
            context.ui.toast.show({ ...goalOutcomeToast(goal), sessionID: goal.sessionId })
          },
        })
      : undefined

    const GoalLine = (props: { sessionID: string; store: GoalStore }) => {
      const [goal, setGoal] = createSignal<SessionGoal | null>(null)
      createEffect(() => {
        const unsubscribe = props.store.watch(props.sessionID, (next) => setGoal(next))
        onCleanup(unsubscribe)
      })
      const openGoal = () => {
        const current = goal()
        return current && isOpenGoal(current) ? current : null
      }
      return (
        <Show when={openGoal()}>
          {(current) => (
            <box flexDirection="row" flexShrink={0}>
              <text fg={current().status === 'active' ? context.theme.hue.accent[200] : context.theme.text.muted}>
                {formatGoalStatus(current())}
              </text>
            </box>
          )}
        </Show>
      )
    }

    if (goals) {
      context.ui.slot({
        append: 'session.composer.top',
        render: (input) => <GoalLine sessionID={input.sessionID} store={goals} />,
      })
    }

    return setupOcm(context, setMoveProgress, { remote, goals })
  },
})

/** @jsxImportSource @opentui/solid */
import { TextAttributes } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import type { Context } from '@opencode/plugin/tui/context'
import type { SessionGoal } from '@opencode-manager/shared/schemas'
import { getGoalOutcomeTitle, getGoalTokenLabel, getGoalTurnLabel } from '@opencode-manager/shared/notifications'
import { isOpenGoal } from './goal-store.js'
import { goalReason } from './tui-goal.js'
import type { GoalDialogProps } from './tui-goal.js'
import { DialogShell, TextAreaField, TextField, isSubmitKey, useFieldFocus } from './tui-form.js'
import type { DialogTheme } from './tui-form.js'

const FORM_FIELDS = 3

export function showGoalDialog(context: Context, props: GoalDialogProps): void {
  context.ui.dialog.show(() => <GoalDialog context={context} {...props} />)
  context.ui.dialog.set({ size: 'large' })
}

function GoalDialog(props: GoalDialogProps & { context: Context }) {
  const theme: DialogTheme = props.context.theme.surface('dialog')
  const [goal, setGoal] = createSignal<SessionGoal | null>(props.initialGoal)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [confirmCancel, setConfirmCancel] = createSignal(false)
  const [objective, setObjective] = createSignal(props.initialObjective)
  const [maxTurns, setMaxTurns] = createSignal('')
  const [tokenBudget, setTokenBudget] = createSignal('')

  onCleanup(props.store.watch(props.sessionID, (next) => setGoal(next)))
  createEffect(on([objective, maxTurns, tokenBudget], () => setError(null), { defer: true }))

  const openGoal = () => {
    const current = goal()
    return isOpenGoal(current) ? current : null
  }
  const [field, setField] = useFieldFocus(() => FORM_FIELDS, () => openGoal() === null)

  const run = async (label: string, operation: () => Promise<string | null>): Promise<string | null | undefined> => {
    if (busy()) return undefined
    setBusy(label)
    setError(null)
    const failure = await operation()
    setBusy(null)
    setError(failure)
    return failure
  }

  const start = async () => {
    const failure = await run('Starting goal…', () =>
      props.actions.start({ objective: objective(), maxTurns: maxTurns(), tokenBudget: tokenBudget() }),
    )
    if (failure === null) props.context.ui.dialog.clear()
  }

  useKeyboard((event) => {
    const current = openGoal()
    if (!current) {
      if (!isSubmitKey(event)) return
      event.preventDefault()
      void start()
      return
    }
    if (event.name === 'p') {
      event.preventDefault()
      setConfirmCancel(false)
      void run(current.status === 'paused' ? 'Resuming goal…' : 'Pausing goal…', () =>
        current.status === 'paused' ? props.actions.resume(current) : props.actions.pause(current),
      )
      return
    }
    if (event.name === 'x') {
      event.preventDefault()
      if (!confirmCancel()) {
        setConfirmCancel(true)
        return
      }
      setConfirmCancel(false)
      void run('Cancelling goal…', () => props.actions.cancel(current))
    }
  })

  return (
    <Show
      when={openGoal()}
      fallback={
        <DialogShell
          theme={theme}
          title="Start goal"
          subtitle="Runs until the Manager's auditor says it is done"
          busy={busy()}
          error={error()}
          hints={[
            ['tab', 'next field'],
            ['ctrl+s', 'start goal'],
          ]}
        >
          <Show when={goal()}>{(last) => <LastGoal theme={theme} goal={last()} />}</Show>
          <TextAreaField
            theme={theme}
            label="Objective"
            initialValue={props.initialObjective}
            placeholder="What should this session accomplish?"
            height={4}
            focused={field() === 0}
            onInput={setObjective}
          />
          <box flexDirection="row" gap={4}>
            <box flexGrow={1}>
              <TextField
                theme={theme}
                label="Max turns"
                initialValue=""
                placeholder="Manager default"
                focused={field() === 1}
                onInput={setMaxTurns}
                onSubmit={() => setField(2)}
              />
            </box>
            <box flexGrow={1}>
              <TextField
                theme={theme}
                label="Token budget"
                initialValue=""
                placeholder="Manager default"
                focused={field() === 2}
                onInput={setTokenBudget}
                onSubmit={() => void start()}
              />
            </box>
          </box>
        </DialogShell>
      }
    >
      {(current) => (
        <DialogShell
          theme={theme}
          title="Session goal"
          busy={busy()}
          error={error()}
          hints={[
            ['p', current().status === 'paused' ? 'resume' : 'pause'],
            ['x', 'cancel goal'],
          ]}
        >
          <GoalStatus theme={theme} goal={current()} />
          <Show when={confirmCancel()}>
            <text fg={theme.text.feedback.warning.base}>Press x again to cancel the goal. This cannot be undone.</text>
          </Show>
        </DialogShell>
      )}
    </Show>
  )
}

function GoalStatus(props: { theme: DialogTheme; goal: SessionGoal }) {
  const tone = () => (props.goal.status === 'active' ? props.theme.text.feedback.info.base : props.theme.text.feedback.warning.base)
  return (
    <box gap={1}>
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <text fg={tone()} attributes={TextAttributes.BOLD}>
          {getGoalOutcomeTitle(props.goal.status)}
        </text>
        <text fg={props.theme.text.muted}>{getGoalTurnLabel(props.goal)}</text>
        <Show when={getGoalTokenLabel(props.goal)}>{(tokens) => <text fg={props.theme.text.muted}>{tokens()}</text>}</Show>
        <text fg={props.theme.text.muted}>{props.goal.turnState === 'running' ? 'working' : 'waiting'}</text>
      </box>
      <text fg={props.theme.text.base}>{props.goal.objective}</text>
      <Show when={goalReason(props.goal)}>
        {(reason) => (
          <text fg={props.theme.text.muted}>
            {props.goal.lastVerdict ? `Last verdict: ${props.goal.lastVerdict} · ` : ''}
            {reason()}
          </text>
        )}
      </Show>
    </box>
  )
}

function LastGoal(props: { theme: DialogTheme; goal: SessionGoal }) {
  return (
    <text fg={props.theme.text.muted} wrapMode="none" truncate>
      Last goal: {getGoalOutcomeTitle(props.goal.status)}
      {goalReason(props.goal) ? ` · ${goalReason(props.goal)}` : ''} · {props.goal.objective}
    </text>
  )
}

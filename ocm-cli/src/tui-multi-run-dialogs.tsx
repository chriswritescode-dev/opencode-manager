/** @jsxImportSource @opentui/solid */
import { useKeyboard } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, onMount, Show } from 'solid-js'
import type { Context } from '@opencode/plugin/tui/context'
import {
  MULTI_RUN_FUSION_MIN_SOURCES,
  MULTI_RUN_MAX_MODELS,
  type MultiRun,
  type MultiRunEntry,
  type MultiRunFusion,
} from '@opencode-manager/shared/schemas'
import {
  canDiscard,
  defaultMultiRunName,
  formatEntryStatus,
  runSummary,
  startedEntries,
  toggleFusionSource,
} from './tui-multi-run.js'
import type { ModelOption, MultiRunActions, MultiRunLaunchDialogProps, MultiRunsDialogProps } from './tui-multi-run.js'
import {
  ChoiceField,
  DialogShell,
  ModelPicker,
  TextAreaField,
  TextField,
  isSubmitKey,
  useFieldFocus,
} from './tui-form.js'
import type { DialogTheme } from './tui-form.js'

const ISOLATION_OPTIONS = [
  { title: 'Isolated worktrees (recommended)', value: true },
  { title: 'Shared repo directory', value: false },
] as const

const RUN_LIST_WIDTH = 34

export function showMultiRunLaunchDialog(context: Context, props: MultiRunLaunchDialogProps): void {
  context.ui.dialog.show(() => <MultiRunLaunchDialog context={context} {...props} />)
  context.ui.dialog.set({ size: 'large' })
}

export function showMultiRunsDialog(context: Context, props: MultiRunsDialogProps): void {
  context.ui.dialog.show(() => <MultiRunsDialog context={context} {...props} />)
  context.ui.dialog.set({ size: 'xlarge' })
}

function useModelOptions(actions: MultiRunActions, onError: (message: string) => void) {
  const [models, setModels] = createSignal<ModelOption[] | undefined>()
  onMount(async () => {
    const result = await actions.loadModels()
    if (result.ok) setModels(result.value)
    else onError(result.error)
  })
  return models
}

function MultiRunLaunchDialog(props: MultiRunLaunchDialogProps & { context: Context }) {
  const theme: DialogTheme = props.context.theme.surface('dialog')
  const [prompt, setPrompt] = createSignal(props.initialPrompt)
  const [name, setName] = createSignal('')
  const [selected, setSelected] = createSignal<string[]>([])
  const [isolate, setIsolate] = createSignal(true)
  const [baseRef, setBaseRef] = createSignal('')
  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const models = useModelOptions(props.actions, setError)
  const [field, setField] = useFieldFocus(() => (isolate() ? 5 : 4))
  createEffect(on([prompt, name, selected, isolate, baseRef], () => setError(null), { defer: true }))

  const launch = async () => {
    if (busy()) return
    setBusy('Launching…')
    setError(null)
    const failure = await props.actions.launch({
      prompt: prompt(),
      name: name(),
      models: selected(),
      isolate: isolate(),
      baseRef: baseRef(),
    })
    setBusy(null)
    if (failure === null) {
      props.context.ui.dialog.clear()
      return
    }
    setError(failure)
  }

  useKeyboard((event) => {
    if (!isSubmitKey(event)) return
    event.preventDefault()
    void launch()
  })

  const toggleModel = (value: string) =>
    setSelected((current) => (current.includes(value) ? current.filter((model) => model !== value) : [...current, value]))

  return (
    <DialogShell
      theme={theme}
      title="New multi-run"
      subtitle={`One prompt, up to ${MULTI_RUN_MAX_MODELS} models`}
      busy={busy()}
      error={error()}
      hints={[
        ['tab', 'next field'],
        ['enter', 'toggle model'],
        ['ctrl+s', 'launch'],
      ]}
    >
      <TextAreaField
        theme={theme}
        label="Prompt"
        initialValue={props.initialPrompt}
        placeholder="The prompt every model receives"
        height={5}
        focused={field() === 0}
        onInput={setPrompt}
      />
      <TextField
        theme={theme}
        label="Name"
        initialValue=""
        placeholder={defaultMultiRunName(prompt()) || 'Name this group of runs'}
        focused={field() === 1}
        onInput={setName}
        onSubmit={() => setField(2)}
      />
      <ModelPicker
        theme={theme}
        label="Models"
        options={models()}
        selected={selected()}
        multiple
        max={MULTI_RUN_MAX_MODELS}
        focused={field() === 2}
        onToggle={toggleModel}
      />
      <ChoiceField
        theme={theme}
        label="Workspace"
        focused={field() === 3}
        value={isolate()}
        options={ISOLATION_OPTIONS}
        onChange={setIsolate}
      />
      <Show when={isolate()}>
        <TextField
          theme={theme}
          label="Start from"
          initialValue=""
          placeholder="Current HEAD"
          focused={field() === 4}
          onInput={setBaseRef}
          onSubmit={() => void launch()}
        />
      </Show>
    </DialogShell>
  )
}

type DetailRow = { kind: 'entry'; entry: MultiRunEntry } | { kind: 'fusion'; fusion: MultiRunFusion }

type Pane = 'runs' | 'details' | 'fuse'

function MultiRunsDialog(props: MultiRunsDialogProps & { context: Context }) {
  const theme: DialogTheme = props.context.theme.surface('dialog')
  const [runs, setRuns] = createSignal<MultiRun[] | undefined>()
  const [runIndex, setRunIndex] = createSignal(0)
  const [rowIndex, setRowIndex] = createSignal(0)
  const [pane, setPane] = createSignal<Pane>('runs')
  const [fusionIds, setFusionIds] = createSignal<number[]>([])
  const [pendingDiscard, setPendingDiscard] = createSignal<number | null>(null)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const run = createMemo(() => runs()?.[runIndex()])
  const rows = createMemo<DetailRow[]>(() => {
    const current = run()
    if (!current) return []
    return [
      ...current.entries.map((entry) => ({ kind: 'entry' as const, entry })),
      ...current.fusions.map((fusion) => ({ kind: 'fusion' as const, fusion })),
    ]
  })

  const load = async () => {
    setBusy('Loading multi-runs…')
    const result = await props.actions.list()
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setRuns(result.value)
    setRunIndex((index) => Math.min(index, Math.max(0, result.value.length - 1)))
  }
  onMount(load)

  const selectRun = (index: number) => {
    setRunIndex(index)
    setRowIndex(0)
    setFusionIds([])
    setPendingDiscard(null)
  }

  const replaceRun = (updated: MultiRun) => setRuns((current) => current?.map((item) => (item.id === updated.id ? updated : item)))

  const discard = async (entry: MultiRunEntry) => {
    const current = run()
    if (!current || busy()) return
    if (pendingDiscard() !== entry.id) {
      setPendingDiscard(entry.id)
      return
    }
    setPendingDiscard(null)
    setBusy(`Discarding ${entry.model}…`)
    const result = await props.actions.discard(current, entry)
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    replaceRun(result.value)
    setFusionIds((ids) => ids.filter((id) => id !== entry.id))
  }

  const startFusion = () => {
    const current = run()
    if (!current) return
    const ids = fusionIds().length > 0 ? fusionIds() : startedEntries(current).slice(0, MULTI_RUN_MAX_MODELS).map((entry) => entry.id)
    if (ids.length < MULTI_RUN_FUSION_MIN_SOURCES) {
      setError(`Select at least ${MULTI_RUN_FUSION_MIN_SOURCES} started results to fuse (space selects).`)
      return
    }
    setFusionIds(ids)
    setError(null)
    setPane('fuse')
  }

  const moveIndex = (count: number, set: (fn: (value: number) => number) => void, up: boolean) => {
    if (count === 0) return
    set((value) => (value + (up ? count - 1 : 1)) % count)
  }

  useKeyboard((event) => {
    if (pane() === 'fuse') {
      if (event.ctrl && event.name === 'b') {
        event.preventDefault()
        setPane('details')
      }
      return
    }

    const current = run()
    const name = event.name
    if (name === 'n') {
      event.preventDefault()
      props.newRun()
      return
    }
    if (name === 'r') {
      event.preventDefault()
      void load()
      return
    }

    if (pane() === 'runs') {
      if (name === 'up' || name === 'down') {
        event.preventDefault()
        const count = runs()?.length ?? 0
        if (count > 0) selectRun((runIndex() + (name === 'up' ? count - 1 : 1)) % count)
        return
      }
      if ((name === 'return' || name === 'right') && current) {
        event.preventDefault()
        setPane('details')
      }
      return
    }

    if (name === 'left') {
      event.preventDefault()
      setPendingDiscard(null)
      setPane('runs')
      return
    }
    if (name === 'up' || name === 'down') {
      event.preventDefault()
      setPendingDiscard(null)
      moveIndex(rows().length, setRowIndex, name === 'up')
      return
    }
    if (name === 'f') {
      event.preventDefault()
      startFusion()
      return
    }

    const row = rows()[rowIndex()]
    if (!row || !current) return
    const sessionId = row.kind === 'entry' ? row.entry.sessionId : row.fusion.sessionId
    if ((name === 'return' || name === 'o') && sessionId) {
      event.preventDefault()
      props.actions.open(sessionId)
      props.context.ui.dialog.clear()
      return
    }
    if (row.kind !== 'entry') return
    if (name === 'space') {
      event.preventDefault()
      setFusionIds((ids) => toggleFusionSource(current, ids, row.entry.id))
      return
    }
    if (name === 'd' && canDiscard(row.entry)) {
      event.preventDefault()
      void discard(row.entry)
    }
  })

  const hints = createMemo(() => {
    if (pane() === 'fuse') return [['tab', 'next field'], ['enter', 'pick model'], ['ctrl+s', 'fuse'], ['ctrl+b', 'back']] as const
    if (pane() === 'runs') return [['↑↓', 'select run'], ['enter', 'open run'], ['n', 'new multi-run'], ['r', 'refresh']] as const
    return [
      ['↑↓', 'move'],
      ['enter', 'open session'],
      ['space', 'select for fusion'],
      ['f', 'fuse'],
      ['d', 'discard'],
      ['←', 'runs'],
    ] as const
  })

  return (
    <DialogShell theme={theme} title="Multi-runs" busy={busy()} error={error()} hints={hints()}>
      <Show
        when={(runs()?.length ?? 0) > 0}
        fallback={
          <text fg={theme.text.muted}>{runs() ? 'No multi-runs for this repo yet. Press n to start one.' : 'Loading…'}</text>
        }
      >
        <box flexDirection="row" gap={2}>
          <box width={RUN_LIST_WIDTH} flexShrink={0}>
            <For each={runs()}>
              {(item, index) => {
                const active = () => index() === runIndex()
                const focused = () => active() && pane() === 'runs'
                return (
                  <box backgroundColor={focused() ? theme.background.action.primary.focused : undefined}>
                    <text
                      fg={focused() ? theme.text.action.primary.focused : active() ? theme.text.formfield.selected : theme.text.base}
                      wrapMode="none"
                      truncate
                    >
                      {item.name}
                    </text>
                    <text fg={theme.text.muted} wrapMode="none" truncate>
                      {runSummary(item)}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
          <box flexGrow={1} flexShrink={1} gap={1}>
            <Show when={run()}>
              {(current) => (
                <Show
                  when={pane() === 'fuse'}
                  fallback={
                    <RunDetails
                      theme={theme}
                      run={current()}
                      rows={rows()}
                      rowIndex={rowIndex()}
                      focused={pane() === 'details'}
                      fusionIds={fusionIds()}
                      pendingDiscard={pendingDiscard()}
                    />
                  }
                >
                  <FusionForm
                    context={props.context}
                    theme={theme}
                    actions={props.actions}
                    run={current()}
                    entryIds={fusionIds()}
                    onError={setError}
                    onBusy={setBusy}
                  />
                </Show>
              )}
            </Show>
          </box>
        </box>
      </Show>
    </DialogShell>
  )
}

function RunDetails(props: {
  theme: DialogTheme
  run: MultiRun
  rows: DetailRow[]
  rowIndex: number
  focused: boolean
  fusionIds: number[]
  pendingDiscard: number | null
}) {
  return (
    <box>
      <text fg={props.theme.text.muted} wrapMode="none" truncate>
        {props.run.prompt.replace(/\s+/g, ' ')}
      </text>
      <For each={props.rows}>
        {(row, index) => {
          const active = () => props.focused && index() === props.rowIndex
          return (
            <box
              flexDirection="row"
              gap={1}
              backgroundColor={active() ? props.theme.background.action.primary.focused : undefined}
            >
              {row.kind === 'entry' ? (
                <EntryRow theme={props.theme} entry={row.entry} active={active()} selected={props.fusionIds.includes(row.entry.id)} />
              ) : (
                <FusionRow theme={props.theme} fusion={row.fusion} active={active()} />
              )}
            </box>
          )
        }}
      </For>
      <Show when={props.pendingDiscard !== null}>
        <text fg={props.theme.text.feedback.warning.base}>
          Press d again to discard this run
          {props.run.entries.find((entry) => entry.id === props.pendingDiscard)?.isolated ? ' and remove its worktree' : ''}. This cannot be
          undone.
        </text>
      </Show>
    </box>
  )
}

function EntryRow(props: { theme: DialogTheme; entry: MultiRunEntry; active: boolean; selected: boolean }) {
  return (
    <>
      <text fg={props.selected ? props.theme.text.formfield.selected : props.theme.text.muted} flexShrink={0}>
        {props.selected ? '[x]' : '[ ]'}
      </text>
      <text
        fg={props.active ? props.theme.text.action.primary.focused : props.entry.status === 'discarded' ? props.theme.text.muted : props.theme.text.base}
        flexShrink={0}
      >
        {props.entry.model}
      </text>
      <text
        fg={props.entry.status === 'failed' ? props.theme.text.feedback.error.base : props.theme.text.muted}
        wrapMode="none"
        truncate
      >
        {formatEntryStatus(props.entry)}
      </text>
    </>
  )
}

function FusionRow(props: { theme: DialogTheme; fusion: MultiRunFusion; active: boolean }) {
  return (
    <>
      <text fg={props.theme.text.muted} flexShrink={0}>
        {'  ⇢'}
      </text>
      <text fg={props.active ? props.theme.text.action.primary.focused : props.theme.text.base} flexShrink={0}>
        fusion {props.fusion.model}
      </text>
      <text
        fg={props.fusion.status === 'failed' ? props.theme.text.feedback.error.base : props.theme.text.muted}
        wrapMode="none"
        truncate
      >
        {[props.fusion.status, props.fusion.error].filter(Boolean).join(' · ')}
      </text>
    </>
  )
}

function FusionForm(props: {
  context: Context
  theme: DialogTheme
  actions: MultiRunActions
  run: MultiRun
  entryIds: number[]
  onError: (message: string | null) => void
  onBusy: (message: string | null) => void
}) {
  const [model, setModel] = createSignal('')
  const [baseRef, setBaseRef] = createSignal(props.run.baseRef ?? '')
  const [instructions, setInstructions] = createSignal('')
  const [submitting, setSubmitting] = createSignal(false)
  const models = useModelOptions(props.actions, props.onError)
  const [field] = useFieldFocus(() => 3)
  const sources = () => props.run.entries.filter((entry) => props.entryIds.includes(entry.id)).map((entry) => entry.model)

  const fuse = async () => {
    if (submitting()) return
    setSubmitting(true)
    props.onBusy('Starting fusion…')
    props.onError(null)
    const failure = await props.actions.fuse(props.run, {
      entryIds: props.entryIds,
      model: model(),
      baseRef: baseRef(),
      instructions: instructions(),
    })
    setSubmitting(false)
    props.onBusy(null)
    if (failure === null) {
      props.context.ui.dialog.clear()
      return
    }
    props.onError(failure)
  }

  useKeyboard((event) => {
    if (!isSubmitKey(event)) return
    event.preventDefault()
    void fuse()
  })

  return (
    <box gap={1}>
      <text fg={props.theme.text.base}>
        Fuse {props.entryIds.length} results: <span style={{ fg: props.theme.text.muted }}>{sources().join(', ')}</span>
      </text>
      <text fg={props.theme.text.muted}>The synthesis always runs in a new worktree.</text>
      <ModelPicker
        theme={props.theme}
        label="Synthesis model"
        options={models()}
        selected={model() ? [model()] : []}
        multiple={false}
        max={1}
        focused={field() === 0}
        onToggle={setModel}
      />
      <TextField
        theme={props.theme}
        label="Start from"
        initialValue={props.run.baseRef ?? ''}
        placeholder="Current HEAD"
        focused={field() === 1}
        onInput={setBaseRef}
      />
      <TextAreaField
        theme={props.theme}
        label="Instructions (optional)"
        initialValue=""
        placeholder="Optional guidance for the synthesis"
        height={3}
        focused={field() === 2}
        onInput={setInstructions}
      />
    </box>
  )
}

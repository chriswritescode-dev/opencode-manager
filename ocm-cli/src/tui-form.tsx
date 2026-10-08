/** @jsxImportSource @opentui/solid */
import { TextAttributes, type KeyEvent, type TextareaRenderable } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { Context } from '@opencode/plugin/tui/context'
import { filterModelOptions } from './tui-multi-run.js'
import type { ModelOption } from './tui-multi-run.js'

export type DialogTheme = ReturnType<Context['theme']['surface']>

export type KeyHint = readonly [key: string, label: string]

const PICKER_ROWS = 8

/**
 * Row colors matching OpenCode's select dialogs: every text in the cursor row uses the
 * primary-action focused color on the focused background; a chosen row away from the
 * cursor uses the selected form-field color for its marker and title.
 */
export function rowColors(theme: DialogTheme, state: { active: boolean; chosen?: boolean }) {
  if (state.active) {
    const text = theme.text.action.primary.focused
    return { background: theme.background.action.primary.focused, title: text, detail: text, marker: text, bold: true }
  }
  return {
    background: undefined,
    title: state.chosen ? theme.text.formfield.selected : theme.text.base,
    detail: theme.text.muted,
    marker: state.chosen ? theme.text.formfield.selected : theme.text.muted,
    bold: false,
  }
}

/** True for the dialog-wide submit chord. */
export function isSubmitKey(event: KeyEvent): boolean {
  return event.ctrl && event.name === 's'
}

/** Tab / Shift+Tab focus cycling over `count` fields; returns the focused index accessor. */
export function useFieldFocus(count: () => number, enabled: () => boolean = () => true) {
  const [index, setIndex] = createSignal(0)
  createEffect(() => {
    if (index() >= count()) setIndex(Math.max(0, count() - 1))
  })
  useKeyboard((event) => {
    if (!enabled() || event.name !== 'tab') return
    event.preventDefault()
    setIndex((current) => (current + (event.shift ? count() - 1 : 1)) % count())
  })
  return [index, setIndex] as const
}

export function DialogShell(props: {
  theme: DialogTheme
  title: string
  subtitle?: string
  hints: readonly KeyHint[]
  error?: string | null
  busy?: string | null
  children: JSX.Element
}) {
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <box flexDirection="row" gap={2} flexShrink={1}>
          <text attributes={TextAttributes.BOLD} fg={props.theme.text.base} flexShrink={0}>
            {props.title}
          </text>
          <Show when={props.subtitle}>
            {(subtitle) => (
              <text fg={props.theme.text.muted} wrapMode="none" truncate>
                {subtitle()}
              </text>
            )}
          </Show>
        </box>
        <text fg={props.theme.text.muted} flexShrink={0}>
          esc
        </text>
      </box>
      {props.children}
      <Show when={props.busy}>{(message) => <text fg={props.theme.text.feedback.info.base}>{message()}</text>}</Show>
      <Show when={props.error}>{(message) => <text fg={props.theme.text.feedback.error.base}>{message()}</text>}</Show>
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <For each={props.hints}>
          {(hint) => (
            <text fg={props.theme.text.base}>
              {hint[0]} <span style={{ fg: props.theme.text.muted }}>{hint[1]}</span>
            </text>
          )}
        </For>
      </box>
    </box>
  )
}

export function FieldLabel(props: { theme: DialogTheme; label: string; focused: boolean; detail?: string }) {
  return (
    <box flexDirection="row" gap={2}>
      <text fg={props.focused ? props.theme.text.formfield.focused : props.theme.text.muted}>{props.label}</text>
      <Show when={props.detail}>{(detail) => <text fg={props.theme.text.muted}>{detail()}</text>}</Show>
    </box>
  )
}

export function TextField(props: {
  theme: DialogTheme
  label: string
  initialValue: string
  placeholder?: string
  focused: boolean
  onInput: (value: string) => void
  onSubmit?: () => void
}) {
  const initial = props.initialValue
  return (
    <box>
      <FieldLabel theme={props.theme} label={props.label} focused={props.focused} />
      <input
        value={initial}
        focused={props.focused}
        placeholder={props.placeholder}
        placeholderColor={props.theme.text.muted}
        textColor={props.theme.text.formfield.base}
        focusedTextColor={props.theme.text.formfield.focused}
        focusedBackgroundColor={props.theme.background.formfield.focused}
        cursorColor={props.theme.text.formfield.focused}
        onInput={props.onInput}
        onSubmit={() => props.onSubmit?.()}
      />
    </box>
  )
}

export function TextAreaField(props: {
  theme: DialogTheme
  label: string
  initialValue: string
  placeholder?: string
  focused: boolean
  height: number
  onInput: (value: string) => void
}) {
  const initial = props.initialValue
  let textarea: TextareaRenderable | undefined
  return (
    <box>
      <FieldLabel theme={props.theme} label={props.label} focused={props.focused} />
      <textarea
        ref={(value: TextareaRenderable) => (textarea = value)}
        initialValue={initial}
        height={props.height}
        focused={props.focused}
        placeholder={props.placeholder}
        placeholderColor={props.theme.text.muted}
        textColor={props.theme.text.formfield.base}
        focusedTextColor={props.theme.text.formfield.focused}
        focusedBackgroundColor={props.theme.background.formfield.focused}
        cursorColor={props.theme.text.formfield.focused}
        onContentChange={() => props.onInput(textarea?.plainText ?? '')}
      />
    </box>
  )
}

/** A two-way choice rendered as radio buttons; ←/→/space switch it while focused. */
export function ChoiceField<Value>(props: {
  theme: DialogTheme
  label: string
  focused: boolean
  value: Value
  options: readonly { title: string; value: Value }[]
  onChange: (value: Value) => void
}) {
  useKeyboard((event) => {
    if (!props.focused || !['left', 'right', 'space'].includes(event.name)) return
    event.preventDefault()
    const index = props.options.findIndex((option) => option.value === props.value)
    const step = event.name === 'left' ? props.options.length - 1 : 1
    props.onChange(props.options[(index + step) % props.options.length]!.value)
  })
  return (
    <box>
      <FieldLabel theme={props.theme} label={props.label} focused={props.focused} />
      <box flexDirection="row" gap={3}>
        <For each={props.options}>
          {(option) => {
            const active = () => option.value === props.value
            return (
              <text fg={active() ? props.theme.text.formfield.selected : props.theme.text.muted}>
                {active() ? '●' : '○'} {option.title}
              </text>
            )
          }}
        </For>
      </box>
    </box>
  )
}

/**
 * Filterable model list. Typing filters, ↑/↓ move, Enter toggles (multiple) or picks (single).
 * Selection state is owned by the caller.
 */
export function ModelPicker(props: {
  theme: DialogTheme
  label: string
  options: readonly ModelOption[] | undefined
  selected: readonly string[]
  multiple: boolean
  max: number
  focused: boolean
  onToggle: (value: string) => void
}) {
  const [query, setQuery] = createSignal('')
  const [cursor, setCursor] = createSignal(0)
  const filtered = createMemo(() => filterModelOptions(props.options ?? [], query()))
  const windowStart = createMemo(() => Math.max(0, Math.min(cursor() - Math.floor(PICKER_ROWS / 2), filtered().length - PICKER_ROWS)))
  const visible = createMemo(() => filtered().slice(windowStart(), windowStart() + PICKER_ROWS))

  createEffect(() => {
    if (cursor() >= filtered().length) setCursor(Math.max(0, filtered().length - 1))
  })

  useKeyboard((event) => {
    if (!props.focused || (event.name !== 'up' && event.name !== 'down')) return
    event.preventDefault()
    const count = filtered().length
    if (count === 0) return
    setCursor((current) => (current + (event.name === 'up' ? count - 1 : 1)) % count)
  })

  const toggleCurrent = () => {
    const option = filtered()[cursor()]
    if (!option) return
    if (props.multiple && !props.selected.includes(option.value) && props.selected.length >= props.max) return
    props.onToggle(option.value)
  }

  const marker = (value: string) => {
    const chosen = props.selected.includes(value)
    if (props.multiple) return chosen ? '[x]' : '[ ]'
    return chosen ? '●' : '○'
  }

  return (
    <box>
      <FieldLabel
        theme={props.theme}
        label={props.label}
        focused={props.focused}
        detail={props.multiple ? `${props.selected.length}/${props.max} selected` : props.selected[0]}
      />
      <input
        focused={props.focused}
        placeholder="Type to filter models"
        placeholderColor={props.theme.text.muted}
        textColor={props.theme.text.formfield.base}
        focusedTextColor={props.theme.text.formfield.focused}
        focusedBackgroundColor={props.theme.background.formfield.focused}
        cursorColor={props.theme.text.formfield.focused}
        onInput={(value) => {
          setQuery(value)
          setCursor(0)
        }}
        onSubmit={toggleCurrent}
      />
      <Show
        when={props.options}
        fallback={<text fg={props.theme.text.muted}>Loading models…</text>}
      >
        <Show when={filtered().length > 0} fallback={<text fg={props.theme.text.muted}>No matching models</text>}>
          <For each={visible()}>
            {(option, index) => {
              const colors = () =>
                rowColors(props.theme, {
                  active: props.focused && windowStart() + index() === cursor(),
                  chosen: props.selected.includes(option.value),
                })
              return (
                <box flexDirection="row" gap={1} backgroundColor={colors().background}>
                  <text fg={colors().marker} flexShrink={0}>
                    {marker(option.value)}
                  </text>
                  <text fg={colors().title} attributes={colors().bold ? TextAttributes.BOLD : undefined} flexShrink={0}>
                    {option.title}
                  </text>
                  <text fg={colors().detail} wrapMode="none" truncate>
                    {option.description}
                  </text>
                </box>
              )
            }}
          </For>
          <Show when={filtered().length > PICKER_ROWS}>
            <text fg={props.theme.text.muted}>
              {cursor() + 1}/{filtered().length}
            </text>
          </Show>
        </Show>
      </Show>
    </box>
  )
}

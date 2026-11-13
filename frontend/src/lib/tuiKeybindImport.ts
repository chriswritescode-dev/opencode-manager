import { JsonValueSchema, type JsonValue } from '@opencode-manager/shared/utils'
import { z } from 'zod'
import type { KeyboardShortcutAction } from '@/api/types/settings'
import { parseJsonc } from '@/lib/jsonc'
import { normalizeShortcut } from '@/lib/keyboardShortcuts'

export interface TuiKeybindImport {
  leaderKey?: string
  shortcuts: Record<string, string>
  leaderActions: string[]
  directActions: string[]
  skipped: Array<{ name: string; reason: string }>
}

const KeyStrokeSchema = z.looseObject({
  name: z.string(),
  ctrl: z.boolean().optional(),
  shift: z.boolean().optional(),
  meta: z.boolean().optional(),
  super: z.boolean().optional(),
  hyper: z.boolean().optional(),
})

type KeyStroke = z.infer<typeof KeyStrokeSchema>

type Alternative = { text: string } | { stroke: KeyStroke }

const KeybindFileSchema = z.looseObject({
  keybinds: z.record(z.string(), JsonValueSchema),
})

const KeyedAlternativeSchema = z.looseObject({ key: JsonValueSchema })

type ResolvedBinding =
  | { kind: 'disabled' }
  | { kind: 'leader'; shortcut: string }
  | { kind: 'direct'; shortcut: string }
  | { kind: 'unconvertible'; reason: string }

type ConvertedAlternative = { shortcut: string; leader: boolean } | { reason: string }

const ACTION_BY_TUI_NAME = new Map<string, KeyboardShortcutAction>([
  ['session.interrupt', 'abort'],
  ['prompt.clear', 'clearPrompt'],
  ['agent.cycle', 'toggleMode'],
  ['variant.cycle', 'variantCycle'],
  ['model.cycle_favorite', 'favoriteCycle'],
  ['session.undo', 'undo'],
  ['session.redo', 'redo'],
  ['session.compact', 'compact'],
  ['session.fork', 'fork'],
  ['opencode.settings', 'settings'],
  ['session.list', 'sessions'],
  ['session.new', 'newSession'],
  ['session.tab.close', 'closeSession'],
  ['session.sidebar.toggle', 'toggleSidebar'],
  ['model.list', 'selectModel'],
  ['terminal.toggle', 'toggleTerminal'],
  ['diff.open', 'toggleSourceControl'],
  ['session.timeline', 'timeline'],
  ['session.export', 'exportSession'],
  ['session.half.page.up', 'halfPageUp'],
  ['session.half.page.down', 'halfPageDown'],
])

const ACTION_BY_LEGACY_NAME = new Map<string, KeyboardShortcutAction>([
  ['session_interrupt', 'abort'],
  ['input_clear', 'clearPrompt'],
  ['agent_cycle', 'toggleMode'],
  ['variant_cycle', 'variantCycle'],
  ['model_cycle_favorite', 'favoriteCycle'],
  ['messages_undo', 'undo'],
  ['messages_redo', 'redo'],
  ['session_compact', 'compact'],
  ['session_fork', 'fork'],
  ['session_list', 'sessions'],
  ['session_new', 'newSession'],
  ['session_tab_close', 'closeSession'],
  ['sidebar_toggle', 'toggleSidebar'],
  ['model_list', 'selectModel'],
  ['diff_open', 'toggleSourceControl'],
  ['session_timeline', 'timeline'],
  ['session_export', 'exportSession'],
  ['messages_half_page_up', 'halfPageUp'],
  ['messages_half_page_down', 'halfPageDown'],
])

const MODIFIER_LABELS = new Map<string, string | null>([
  ['ctrl', 'Ctrl'],
  ['shift', 'Shift'],
  ['meta', 'Alt'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['super', 'Cmd'],
  ['cmd', 'Cmd'],
  ['hyper', null],
])

const KEY_LABELS = new Map<string, string>([
  ['return', 'Return'],
  ['enter', 'Return'],
  ['escape', 'Esc'],
  ['esc', 'Esc'],
  ['space', 'Space'],
  ['tab', 'Tab'],
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
  ['home', 'Home'],
  ['end', 'End'],
  ['delete', 'Delete'],
  ['backspace', 'Backspace'],
  ['insert', 'Insert'],
])

function convertKey(name: string): string | null {
  const lower = name.toLowerCase()
  const mapped = KEY_LABELS.get(lower)
  if (mapped) return mapped
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return `F${lower.slice(1)}`
  if (name.length === 1) return name.toUpperCase()
  return null
}

function splitToken(token: string): string[] {
  const trailingPlus = token.endsWith('+')
  const body = trailingPlus ? token.slice(0, -1) : token
  const parts = body.split('+').filter((part) => part.length > 0)
  return trailingPlus ? [...parts, '+'] : parts
}

function convertToken(token: string): ConvertedAlternative {
  const lower = token.trim().toLowerCase()
  if (!lower) return { reason: 'empty key' }
  const leader = lower.startsWith('<leader>')
  const body = leader ? lower.slice('<leader>'.length) : lower
  if (!body) return { reason: 'missing key after <leader>' }
  const parts = splitToken(body)
  if (parts.length === 0) return { reason: `unsupported key "${token.trim()}"` }
  const keyPart = parts[parts.length - 1]!
  const key = convertKey(keyPart)
  if (!key) return { reason: `unsupported key "${keyPart}"` }
  const modifiers: string[] = []
  for (const part of parts.slice(0, -1)) {
    const label = MODIFIER_LABELS.get(part)
    if (!label) return { reason: `unsupported modifier "${part}"` }
    modifiers.push(label)
  }
  return { shortcut: normalizeShortcut([...modifiers, key].join('+')), leader }
}

function convertAlternative(alternative: Alternative): ConvertedAlternative {
  if ('text' in alternative) return convertToken(alternative.text)
  const { stroke } = alternative
  const leader = stroke.name.startsWith('<leader>')
  const name = leader ? stroke.name.slice('<leader>'.length) : stroke.name
  if (!name) return { reason: 'missing key after <leader>' }
  if (stroke.hyper) return { reason: 'unsupported modifier "hyper"' }
  const key = convertKey(name)
  if (!key) return { reason: `unsupported key "${name}"` }
  const modifiers: string[] = []
  if (stroke.ctrl) modifiers.push('Ctrl')
  if (stroke.shift) modifiers.push('Shift')
  if (stroke.meta) modifiers.push('Alt')
  if (stroke.super) modifiers.push('Cmd')
  return { shortcut: normalizeShortcut([...modifiers, key].join('+')), leader }
}

function collectAlternatives(value: JsonValue): Alternative[] {
  const text = z.string().safeParse(value)
  if (text.success) {
    return text.data
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => ({ text: part }))
  }
  if (Array.isArray(value)) return value.flatMap(collectAlternatives)
  const stroke = KeyStrokeSchema.safeParse(value)
  if (stroke.success) return [{ stroke: stroke.data }]
  const keyed = KeyedAlternativeSchema.safeParse(value)
  if (keyed.success) return collectAlternatives(keyed.data.key)
  return []
}

function isMeaningfulAlternative(alternative: Alternative): boolean {
  return 'stroke' in alternative || alternative.text.toLowerCase() !== 'none'
}

function resolveBinding(value: JsonValue, preferLeader: boolean): ResolvedBinding {
  if (value === false) return { kind: 'disabled' }
  const text = z.string().safeParse(value)
  if (text.success && (text.data.trim() === '' || text.data.trim().toLowerCase() === 'none')) {
    return { kind: 'disabled' }
  }
  const alternatives = collectAlternatives(value).filter(isMeaningfulAlternative)
  let reason: string | null = null
  let leaderShortcut: string | null = null
  let directShortcut: string | null = null
  for (const alternative of alternatives) {
    const result = convertAlternative(alternative)
    if ('reason' in result) {
      reason ??= result.reason
      continue
    }
    if (result.leader) {
      leaderShortcut ??= result.shortcut
      continue
    }
    directShortcut ??= result.shortcut
  }
  if (preferLeader && leaderShortcut !== null) return { kind: 'leader', shortcut: leaderShortcut }
  if (directShortcut !== null) return { kind: 'direct', shortcut: directShortcut }
  return { kind: 'unconvertible', reason: reason ?? 'unsupported value' }
}

export function parseTuiKeybindConfig(content: string): TuiKeybindImport {
  const root = KeybindFileSchema.safeParse(parseJsonc(content))
  if (!root.success) {
    throw new Error('No keybinds found in this file')
  }
  const { keybinds } = root.data
  const shortcuts: Record<string, string> = {}
  const leaderActions: string[] = []
  const directActions: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  let leaderKey: string | undefined

  if (keybinds.leader !== undefined) {
    const resolved = resolveBinding(keybinds.leader, false)
    if (resolved.kind === 'disabled') {
      skipped.push({ name: 'leader', reason: 'leader key is disabled' })
    } else if (resolved.kind === 'unconvertible') {
      skipped.push({ name: 'leader', reason: resolved.reason })
    } else {
      leaderKey = resolved.shortcut
    }
  }

  const byAction = new Map<KeyboardShortcutAction, { name: string; value: JsonValue; dotted: boolean }>()
  for (const [name, value] of Object.entries(keybinds)) {
    if (name === 'leader') continue
    const action = ACTION_BY_TUI_NAME.get(name) ?? ACTION_BY_LEGACY_NAME.get(name)
    if (!action) continue
    const dotted = ACTION_BY_TUI_NAME.has(name)
    const existing = byAction.get(action)
    if (!existing || (dotted && !existing.dotted)) byAction.set(action, { name, value, dotted })
  }

  for (const [action, entry] of byAction) {
    const resolved = resolveBinding(entry.value, true)
    if (resolved.kind === 'disabled') {
      shortcuts[action] = ''
      continue
    }
    if (resolved.kind === 'unconvertible') {
      skipped.push({ name: entry.name, reason: resolved.reason })
      continue
    }
    shortcuts[action] = resolved.shortcut
    if (resolved.kind === 'leader') leaderActions.push(action)
    else directActions.push(action)
  }

  return { leaderKey, shortcuts, leaderActions, directActions, skipped }
}

export function applyTuiKeybindImport(
  imported: TuiKeybindImport,
  current: { keyboardShortcuts: Record<string, string>; directShortcuts: string[] },
): { keyboardShortcuts: Record<string, string>; directShortcuts: string[]; leaderKey?: string; cleared: string[] } {
  const leaderSet = new Set<string>(imported.leaderActions)
  const directShortcuts = [
    ...current.directShortcuts.filter((action) => !leaderSet.has(action)),
    ...imported.directActions.filter((action) => !current.directShortcuts.includes(action)),
  ]
  const bindingKey = (action: string, keys: string) => `${directShortcuts.includes(action) ? 'direct' : 'leader'}:${normalizeShortcut(keys)}`
  const importedBindings = new Set(
    Object.entries(imported.shortcuts).filter(([, keys]) => Boolean(keys)).map(([action, keys]) => bindingKey(action, keys ?? '')),
  )
  const cleared = Object.entries(current.keyboardShortcuts)
    .filter(([action, keys]) => !(action in imported.shortcuts) && Boolean(keys) && importedBindings.has(bindingKey(action, keys)))
    .map(([action]) => action)
  const keyboardShortcuts = {
    ...current.keyboardShortcuts,
    ...Object.fromEntries(cleared.map((action) => [action, ''])),
    ...imported.shortcuts,
  }
  return imported.leaderKey !== undefined
    ? { keyboardShortcuts, directShortcuts, leaderKey: imported.leaderKey, cleared }
    : { keyboardShortcuts, directShortcuts, cleared }
}

export function applyRecordedShortcut(
  action: string,
  shortcut: string,
  leader: boolean,
  current: { keyboardShortcuts: Record<string, string>; directShortcuts: string[] },
): { keyboardShortcuts: Record<string, string>; directShortcuts: string[]; cleared: string[] } {
  return applyTuiKeybindImport(
    {
      shortcuts: { [action]: shortcut },
      leaderActions: leader ? [action] : [],
      directActions: leader ? [] : [action],
      skipped: [],
    },
    current,
  )
}

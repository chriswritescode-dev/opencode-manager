import { describe, expect, it } from 'vitest'
import {
  applyTuiKeybindImport,
  parseTuiKeybindConfig,
  type TuiKeybindImport,
} from './tuiKeybindImport'

const REAL_FILE = `{
  "$schema": "https://opencode.ai/config.json",
  "theme": "system",
  "keybinds": {
    "leader": "ctrl+o",
    "terminal.toggle": "<leader>t",
    "session.new": "ctrl+n,<leader>n",
    "session.interrupt": "ctrl+s",
    "session.compact": "<leader>c",
    "model.list": "<leader>m",
    "agent.cycle": "tab",
    "session.undo": "<leader>u",
    "session.redo": "none",
    "session.tab.next": "ctrl+tab",
    "app.exit": "ctrl+c,ctrl+d,<leader>q"
  }
}`

describe('parseTuiKeybindConfig', () => {
  it('converts the real cli.json keybinds excerpt', () => {
    const result = parseTuiKeybindConfig(REAL_FILE)
    expect(result.leaderKey).toBe('Ctrl+O')
    expect(result.shortcuts).toEqual({
      toggleTerminal: 'T',
      newSession: 'N',
      abort: 'Ctrl+S',
      compact: 'C',
      selectModel: 'M',
      toggleMode: 'Tab',
      undo: 'U',
      redo: '',
    })
    expect(result.leaderActions).toEqual(['toggleTerminal', 'newSession', 'compact', 'selectModel', 'undo'])
    expect(result.directActions).toEqual(['abort', 'toggleMode'])
    expect(result.skipped).toEqual([])
  })

  it('parses JSONC with comments and trailing commas', () => {
    const content = `{
      // leader is ctrl+o
      "keybinds": {
        "leader": "ctrl+o",
        "session.compact": "<leader>c", // compact
      },
    }`
    const result = parseTuiKeybindConfig(content)
    expect(result.leaderKey).toBe('Ctrl+O')
    expect(result.shortcuts.compact).toBe('C')
    expect(result.leaderActions).toEqual(['compact'])
  })

  it('reads legacy snake_case names', () => {
    const content = `{
      "keybinds": {
        "session_new": "ctrl+n",
        "messages_undo": "<leader>u",
        "sidebar_toggle": "<leader>b",
        "session_list": "<leader>l"
      }
    }`
    const result = parseTuiKeybindConfig(content)
    expect(result.shortcuts).toEqual({
      newSession: 'Ctrl+N',
      undo: 'U',
      toggleSidebar: 'B',
      sessions: 'L',
    })
    expect(result.leaderActions).toEqual(['undo', 'toggleSidebar', 'sessions'])
    expect(result.directActions).toEqual(['newSession'])
  })

  it('prefers the dotted name over the legacy alias', () => {
    const content = `{
      "keybinds": {
        "session_new": "ctrl+n",
        "session.new": "<leader>n"
      }
    }`
    const result = parseTuiKeybindConfig(content)
    expect(result.shortcuts.newSession).toBe('N')
    expect(result.leaderActions).toEqual(['newSession'])
    expect(result.directActions).toEqual([])
  })

  it('converts KeyStroke, binding object and array values', () => {
    const content = `{
      "keybinds": {
        "session.interrupt": { "name": "t", "ctrl": true },
        "session.compact": { "key": "ctrl+k", "preventDefault": false },
        "agent.cycle": ["ctrl+a", "<leader>z"],
        "model.list": { "name": "pageup", "meta": true }
      }
    }`
    const result = parseTuiKeybindConfig(content)
    expect(result.shortcuts).toEqual({
      abort: 'Ctrl+T',
      compact: 'Ctrl+K',
      toggleMode: 'Z',
      selectModel: 'Alt+PageUp',
    })
    expect(result.leaderActions).toEqual(['toggleMode'])
    expect(result.directActions).toEqual(['abort', 'compact', 'selectModel'])
  })

  it('converts <leader>pageup and ctrl++', () => {
    const pageUp = parseTuiKeybindConfig('{ "keybinds": { "session.compact": "<leader>pageup" } }')
    expect(pageUp.shortcuts.compact).toBe('PageUp')
    expect(pageUp.leaderActions).toEqual(['compact'])

    const ctrlPlus = parseTuiKeybindConfig('{ "keybinds": { "session.interrupt": "ctrl++" } }')
    expect(ctrlPlus.shortcuts.abort).toBe('Ctrl++')
    expect(ctrlPlus.directActions).toEqual(['abort'])
  })

  it('imports prompt.clear as a direct clearPrompt binding', () => {
    const result = parseTuiKeybindConfig('{ "keybinds": { "prompt.clear": "ctrl+c" } }')
    expect(result.shortcuts.clearPrompt).toBe('Ctrl+C')
    expect(result.directActions).toEqual(['clearPrompt'])
    expect(result.leaderActions).toEqual([])
  })

  it('imports the legacy input_clear alias as clearPrompt', () => {
    const result = parseTuiKeybindConfig('{ "keybinds": { "input_clear": "ctrl+c" } }')
    expect(result.shortcuts.clearPrompt).toBe('Ctrl+C')
    expect(result.directActions).toEqual(['clearPrompt'])
  })

  it('records unconvertible bindings in skipped', () => {
    const result = parseTuiKeybindConfig('{ "keybinds": { "session.undo": "gg" } }')
    expect(result.shortcuts.undo).toBeUndefined()
    expect(result.leaderActions).toEqual([])
    expect(result.directActions).toEqual([])
    expect(result.skipped).toEqual([{ name: 'session.undo', reason: 'unsupported key "gg"' }])
  })

  it('treats false and empty strings as disabled', () => {
    const result = parseTuiKeybindConfig(`{
      "keybinds": {
        "session.fork": false,
        "session.redo": ""
      }
    }`)
    expect(result.shortcuts).toEqual({ fork: '', redo: '' })
    expect(result.leaderActions).toEqual([])
    expect(result.directActions).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('ignores unknown keys silently', () => {
    const result = parseTuiKeybindConfig('{ "keybinds": { "unknown.binding": "ctrl+x" } }')
    expect(result.shortcuts).toEqual({})
    expect(result.skipped).toEqual([])
  })

  it('throws when the file has no keybinds', () => {
    expect(() => parseTuiKeybindConfig('{ "theme": "system" }')).toThrow('No keybinds found in this file')
    expect(() => parseTuiKeybindConfig('[]')).toThrow('No keybinds found in this file')
    expect(() => parseTuiKeybindConfig('{ "keybinds": [] }')).toThrow('No keybinds found in this file')
  })

  it('throws a SyntaxError for invalid JSONC', () => {
    expect(() => parseTuiKeybindConfig('{ "keybinds": {')).toThrow(SyntaxError)
  })
})

describe('applyTuiKeybindImport', () => {
  it('merges shortcuts and updates the direct list', () => {
    const imported: TuiKeybindImport = {
      leaderKey: 'Ctrl+O',
      shortcuts: { newSession: 'N', redo: '' },
      leaderActions: ['newSession'],
      directActions: ['abort'],
      skipped: [],
    }
    const applied = applyTuiKeybindImport(imported, {
      keyboardShortcuts: { abort: 'Escape', submit: 'Ctrl+Return', newSession: 'Ctrl+N' },
      directShortcuts: ['submit', 'abort', 'newSession'],
    })
    expect(applied.keyboardShortcuts).toEqual({
      abort: 'Escape',
      submit: 'Ctrl+Return',
      newSession: 'N',
      redo: '',
    })
    expect(applied.directShortcuts).toEqual(['submit', 'abort'])
    expect(applied.leaderKey).toBe('Ctrl+O')
  })

  it('adds new direct actions without duplicates and omits an undefined leader', () => {
    const applied = applyTuiKeybindImport(
      { shortcuts: {}, leaderActions: [], directActions: ['compact', 'submit'], skipped: [] },
      { keyboardShortcuts: {}, directShortcuts: ['submit'] },
    )
    expect(applied.directShortcuts).toEqual(['submit', 'compact'])
    expect(applied.leaderKey).toBeUndefined()
    expect('leaderKey' in applied).toBe(false)
  })

  it('unbinds a current action that conflicts with an imported binding of the same kind', () => {
    const applied = applyTuiKeybindImport(
      { shortcuts: { toggleTerminal: 'T', abort: 'Ctrl+S' }, leaderActions: ['toggleTerminal'], directActions: ['abort'], skipped: [] },
      {
        keyboardShortcuts: { toggleMode: 'T', toggleTerminal: 'Ctrl+`', variantCycle: 't', submit: 'Ctrl+S', abort: 'Escape' },
        directShortcuts: ['submit', 'abort', 'variantCycle', 'toggleTerminal'],
      },
    )
    expect(applied.cleared).toEqual(['toggleMode', 'submit'])
    expect(applied.keyboardShortcuts).toMatchObject({ toggleMode: '', submit: '', variantCycle: 't', toggleTerminal: 'T', abort: 'Ctrl+S' })
    expect(applied.directShortcuts).toEqual(['submit', 'abort', 'variantCycle'])
  })
})

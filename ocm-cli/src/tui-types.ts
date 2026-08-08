import type { RGBA } from '@opentui/core'

export type TuiThemeColors = {
  accent: RGBA
  text: RGBA
  textMuted: RGBA
  backgroundElement: RGBA
}

export type TuiSlotContext = { theme: { readonly current: TuiThemeColors } }

export type TuiSlotRegistration = {
  order?: number
  slots: Record<string, (ctx: TuiSlotContext, props: Record<string, unknown>) => unknown>
}

export type TuiRouteCurrent = { name: 'session'; params: { sessionID: string } } | { name: string; params?: Record<string, unknown> }
export type TuiSessionInfo = { id: string; directory: string; title?: string }
export type TuiToast = { title?: string; message: string; variant?: 'info' | 'success' | 'error' | 'warning'; duration?: number }
export type TuiCommandDef = { name: string; title: string; desc?: string; category?: string; namespace?: string; slashName?: string; run: () => void | Promise<void> }
export type TuiDialogConfirmProps = { title: string; message: string; onConfirm?: () => void; onCancel?: () => void }
export type TuiDialogSelectOption<Value = unknown> = { title: string; value?: Value; description?: string; disabled?: boolean; onSelect?: () => void }
export type TuiDialogSelectProps<Value = unknown> = { title: string; placeholder?: string; options: TuiDialogSelectOption<Value>[]; onSelect?: (option: TuiDialogSelectOption<Value>) => void }
export type TuiDialogStack = { replace: (render: () => unknown, onClose?: () => void) => void; clear: () => void }
export type TuiLifecycle = { readonly signal: AbortSignal; onDispose: (fn: () => void | Promise<void>) => () => void }
export type TuiPluginApi = {
  route: { readonly current: TuiRouteCurrent }
  state: { session: { get: (sessionID: string) => TuiSessionInfo | undefined } }
  ui: { toast: (input: TuiToast) => void; DialogConfirm: (props: TuiDialogConfirmProps) => unknown; DialogSelect: <Value = unknown>(props: TuiDialogSelectProps<Value>) => unknown; dialog: TuiDialogStack }
  keymap: { registerLayer: (layer: { commands: TuiCommandDef[]; bindings?: Record<string, unknown> }) => unknown; dispatchCommand: (name: string) => unknown }
  slots: { register: (registration: TuiSlotRegistration) => string }
  lifecycle: TuiLifecycle
}
export type TuiPluginModule = { id?: string; tui: (api: TuiPluginApi, options?: Record<string, unknown>) => Promise<void> }

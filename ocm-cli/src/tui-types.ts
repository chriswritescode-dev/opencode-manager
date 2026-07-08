export type TuiRouteCurrent = { name: 'session'; params: { sessionID: string } } | { name: string; params?: Record<string, unknown> }
export type TuiSessionInfo = { id: string; directory: string; title?: string }
export type TuiToast = { title?: string; message: string; variant?: 'info' | 'success' | 'error' | 'warning'; duration?: number }
export type TuiCommandDef = { name: string; title: string; desc?: string; category?: string; namespace?: string; slashName?: string; run: () => void | Promise<void> }
export type TuiPluginApi = {
  route: { readonly current: TuiRouteCurrent }
  state: { session: { get: (sessionID: string) => TuiSessionInfo | undefined } }
  ui: { toast: (input: TuiToast) => void }
  keymap: { registerLayer: (layer: { commands: TuiCommandDef[]; bindings?: Record<string, unknown> }) => unknown }
}
export type TuiPluginModule = { id?: string; tui: (api: TuiPluginApi, options?: Record<string, unknown>) => Promise<void> }

import type { Context } from '@opencode/plugin/tui/context'

export type OcmTuiContext = {
  readonly ui: {
    readonly toast: Pick<Context['ui']['toast'], 'show'>
    readonly dialog: Pick<Context['ui']['dialog'], 'confirm' | 'select' | 'prompt'>
    readonly router: Pick<Context['ui']['router'], 'current' | 'navigate'>
    readonly tabs: Pick<Context['ui']['tabs'], 'enabled' | 'open' | 'focus'>
    readonly slot: Context['ui']['slot']
  }
  readonly data: {
    readonly session: Pick<Context['data']['session'], 'get'>
    readonly location: {
      readonly model: Pick<Context['data']['location']['model'], 'list' | 'sync'>
      readonly provider: Pick<Context['data']['location']['provider'], 'list' | 'sync'>
    }
  }
  readonly keymap: Pick<Context['keymap'], 'layer' | 'dispatch'>
  readonly client: {
    readonly session: Pick<Context['client']['session'], 'export'>
  }
}

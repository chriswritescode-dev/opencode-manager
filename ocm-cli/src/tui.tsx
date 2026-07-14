/** @jsxImportSource @opentui/solid */
import { setupOcm, readRemoteContext } from './tui-plugin.js'
import type { TuiPluginApi, TuiPluginModule, TuiSlotContext } from './tui-types.js'

const tui = async (api: TuiPluginApi): Promise<void> => {
  await setupOcm(api)

  const remote = readRemoteContext(process.env)
  if (!remote) return

  const label = remote.repoName ? `${remote.managerHost} · ${remote.repoName}` : remote.managerHost
  const indicator = (ctx: TuiSlotContext) => {
    const theme = ctx.theme.current
    return (
      <box flexDirection="row" flexShrink={0} gap={1}>
        <text fg={theme.accent}>
          <b>REMOTE</b>
        </text>
        <text fg={theme.textMuted}>{label}</text>
      </box>
    )
  }

  api.slots.register({
    order: 300,
    slots: {
      session_prompt_right: indicator,
      home_prompt_right: indicator,
    },
  })
}

export default { id: 'ocm', tui } satisfies TuiPluginModule
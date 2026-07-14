/** @jsxImportSource @opentui/solid */
import { setupOcm, readRemoteContext } from './tui-plugin.js'
import type { TuiPluginApi, TuiPluginModule, TuiSlotContext } from './tui-types.js'

const tui = async (api: TuiPluginApi): Promise<void> => {
  await setupOcm(api)

  const remote = readRemoteContext(process.env)
  if (!remote) return

  api.slots.register({
    order: 300,
    slots: {
      app_bottom(ctx: TuiSlotContext) {
        const theme = ctx.theme.current
        const label = remote.repoName ? `${remote.managerHost} · ${remote.repoName}` : remote.managerHost
        return (
          <box flexDirection="row" flexShrink={0} gap={1} paddingLeft={1} paddingRight={1}>
            <text fg={theme.accent}>
              <b>⇅ REMOTE</b>
            </text>
            <text fg={theme.text}>{label}</text>
          </box>
        )
      },
    },
  })
}

export default { id: 'ocm', tui } satisfies TuiPluginModule
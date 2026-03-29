/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui'
import { createMemo, createSignal, onCleanup, Show, For } from 'solid-js'
import { VERSION } from './version'
import { compareVersions } from './utils/upgrade'
import { loadPluginConfig } from './setup'

type TuiOptions = {
  sidebar: boolean
  showLoops: boolean
  showVersion: boolean
}

type LoopInfo = {
  name: string
  phase: string
  iteration: number
  maxIterations: number
  sessionId: string
  status: string
}

function Sidebar(props: { api: TuiPluginApi; opts: TuiOptions }) {
  const [open, setOpen] = createSignal(true)
  const [loops, setLoops] = createSignal<LoopInfo[]>([])
  const theme = () => props.api.theme.current

  const title = createMemo(() => {
    return props.opts.showVersion ? `Memory v${VERSION}` : 'Memory'
  })

  const dot = (phase: string, status: string) => {
    if (status === 'error') return theme().error
    if (phase === 'auditing') return theme().warning
    if (status === 'busy') return theme().success
    return theme().textMuted
  }

  const statusText = (loop: LoopInfo) => {
    const max = loop.maxIterations > 0 ? `/${loop.maxIterations}` : ''
    return `${loop.phase} · iter ${loop.iteration}${max}`
  }

  let pollInterval: ReturnType<typeof setInterval> | undefined
  let isPolling = true

  async function refreshLoops() {
    if (!isPolling) return
    try {
      const result = await props.api.client.session.status()
      if (!result.data) return

      const sessions = await props.api.client.session.list()
      if (!sessions.data) return

      const active: LoopInfo[] = []
      for (const session of sessions.data) {
        const status = result.data[session.id]
        if (status && (status.type === 'busy' || status.type === 'retry')) {
          if (session.workspaceID?.startsWith('wrk-loop-')) {
            const name = session.workspaceID.replace('wrk-loop-', '')
            active.push({
              name,
              phase: 'coding',
              iteration: 0,
              maxIterations: 0,
              sessionId: session.id,
              status: status.type,
            })
          }
        }
      }
      setLoops(active)
    } catch {
    }
  }

  refreshLoops()
  pollInterval = setInterval(refreshLoops, 5000)

  const unsub = props.api.event.on('session.status', () => {
    refreshLoops()
  })

  onCleanup(() => {
    isPolling = false
    if (pollInterval) clearInterval(pollInterval)
    unsub()
  })

  const hasContent = createMemo(() => {
    if (props.opts.showLoops && loops().length > 0) return true
    return false
  })

  return (
    <Show when={props.opts.sidebar}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => hasContent() && setOpen((x) => !x)}>
          <Show when={hasContent()}>
            <text fg={theme().text}>{open() ? '▼' : '▶'}</text>
          </Show>
          <text fg={theme().text}>
            <b>{title()}</b>
            <Show when={!open() && loops().length > 0}>
              <span style={{ fg: theme().textMuted }}>
                {' '}({loops().length} active loop{loops().length !== 1 ? 's' : ''})
              </span>
            </Show>
          </text>
        </box>
        <Show when={open() && props.opts.showLoops && loops().length > 0}>
          <For each={loops()}>
            {(loop) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} style={{ fg: dot(loop.phase, loop.status) }}>•</text>
                <text fg={theme().text} wrapMode="word">
                  {loop.name}{' '}
                  <span style={{ fg: theme().textMuted }}>{statusText(loop)}</span>
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const id = '@opencode-manager/memory'
const MIN_OPENCODE_VERSION = '1.3.5'

const tui: TuiPlugin = async (api) => {
  const v = api.app.version
  if (v !== 'local' && compareVersions(v, MIN_OPENCODE_VERSION) < 0) return

  const config = loadPluginConfig()
  const opts: TuiOptions = {
    sidebar: config.tui?.sidebar ?? true,
    showLoops: config.tui?.showLoops ?? true,
    showVersion: config.tui?.showVersion ?? true,
  }

  if (!opts.sidebar) return

  api.slots.register({
    order: 150,
    slots: {
      sidebar_content() {
        return <Sidebar api={api} opts={opts} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }

export default plugin

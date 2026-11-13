import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { useComposerDraftStore } from '@/stores/composerDraftStore'
import { useModelStore } from '@/stores/modelStore'
import { useRecentCommandsStore } from '@/stores/recentCommandsStore'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { useUIState } from '@/stores/uiStateStore'
import { useUserBash } from '@/stores/userBashStore'

export function resetTestStores(): void {
  useComposerDraftStore.setState({ drafts: {} })
  useModelStore.setState({ newSessionPicks: {}, sessionPicks: {}, activeAgent: null })
  useRecentCommandsStore.setState({ names: [] })
  useSendErrorStore.setState({ errors: {} })
  useSessionAgentStore.setState({ agents: {} })
  useSessionStatus.setState({
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    knownSessions: new Set(),
    outcomes: new Map(),
    parents: new Map(),
    directories: new Map(),
    sessionServers: new Map(),
    runningShells: new Map(),
    shellRevisions: new Map(),
    shellRevision: 0,
    revision: 0,
  })
  useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
  useUIState.setState({ isEditingMessage: false, isToolRailMounted: false })
  useUserBash.setState({ userBashCommands: new Map() })
}

import { useNavigate, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Command as CommandIcon, FileText } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useMemoryPluginStatus } from '@/hooks/useMemoryPluginStatus'
import { useCommands } from '@/hooks/useCommands'
import { useFileSearch } from '@/hooks/useFileSearch'
import { useUIState } from '@/stores/uiStateStore'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { SideDrawer, SideDrawerHeader, SideDrawerContent } from '@/components/ui/side-drawer'
import { buildMoreItems } from './moreDrawerItems'
import { getDirectory, getFilename } from '@/lib/promptParser'
import type { components } from '@/api/opencode-types'

type CommandType = components['schemas']['Command']

interface MoreDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export function MoreDrawer({ isOpen, onClose }: MoreDrawerProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const { logout } = useAuth()
  const { data: health } = useServerHealth()
  const { memoryPluginEnabled } = useMemoryPluginStatus()
  const isSessionDetail = /^\/repos\/\d+\/sessions\/[^/]+$/.test(location.pathname)
  const { filterCommands } = useCommands(isSessionDetail ? OPENCODE_API_ENDPOINT : null)
  const activePromptDirectory = useUIState((state) => state.activePromptDirectory)
  const selectPromptCommand = useUIState((state) => state.selectPromptCommand)
  const selectPromptFile = useUIState((state) => state.selectPromptFile)
  const { files, isLoading: filesLoading } = useFileSearch(
    OPENCODE_API_ENDPOINT,
    fileQuery,
    isSessionDetail && filesOpen && fileQuery.trim().length > 0,
    activePromptDirectory ?? undefined,
  )

  const handleSettingsClick = () => {
    const newParams = new URLSearchParams(location.search)
    newParams.delete('mobileTab')
    newParams.set('settings', 'open')
    newParams.set('tab', 'account')
    navigate({ search: newParams.toString() }, { replace: true })
  }

  const handleLogoutClick = async () => {
    try {
      await logout()
    } finally {
      onClose()
    }
  }

  const handleItemClick = (item: ReturnType<typeof buildMoreItems>[0]) => {
    if (item.to) {
      navigate(item.to)
    } else if (item.dialog) {
      const newParams = new URLSearchParams(location.search)
      newParams.set('dialog', item.dialog)
      newParams.delete('mobileTab')
      navigate({ search: newParams.toString() }, { replace: true })
    }
  }

  const handleCommandClick = (command: CommandType) => {
    selectPromptCommand(command)
    onClose()
  }

  const handleFileClick = (path: string) => {
    selectPromptFile(path)
    onClose()
  }

  const items = buildMoreItems(location.pathname, { memoryPluginEnabled })
  const commands = filterCommands('')

  const opencodeVersion = health?.opencodeVersion
  const managerVersion = health?.opencodeManagerVersion

  return (
    <SideDrawer isOpen={isOpen} onClose={onClose} side="right" ariaLabel="More">
      <SideDrawerHeader
        title={opencodeVersion ? `OpenCode v${opencodeVersion}` : 'OpenCode'}
        onClose={onClose}
        meta={
          managerVersion ? (
            <div className="text-xs text-muted-foreground">Manager v{managerVersion}</div>
          ) : null
        }
      />
      <SideDrawerContent className="flex flex-col gap-1">
        {isSessionDetail && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setCommandsOpen((open) => !open)}
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left w-full"
              aria-expanded={commandsOpen}
            >
              <CommandIcon className="w-5 h-5 text-muted-foreground" />
              <span className="font-medium text-foreground flex-1">Commands</span>
              {commandsOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {commandsOpen && (
              <div className="ml-4 max-h-64 overflow-y-auto rounded-lg border border-border bg-muted/30 p-1">
                {commands.map((command) => (
                  <button
                    key={command.name}
                    type="button"
                    onClick={() => handleCommandClick(command)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <span className="font-mono text-sm text-foreground">/{command.name}</span>
                    {command.description && (
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{command.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setFilesOpen((open) => !open)}
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left w-full"
              aria-expanded={filesOpen}
            >
              <FileText className="w-5 h-5 text-muted-foreground" />
              <span className="font-medium text-foreground flex-1">Mention File</span>
              {filesOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {filesOpen && (
              <div className="ml-4 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2">
                <input
                  type="text"
                  value={fileQuery}
                  onChange={(event) => setFileQuery(event.target.value)}
                  placeholder="Search files..."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="max-h-64 overflow-y-auto">
                  {fileQuery.trim().length === 0 ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground">Type to search files</div>
                  ) : filesLoading ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground">Searching files...</div>
                  ) : files.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground">No files found</div>
                  ) : (
                    files.map((file) => (
                      <button
                        key={file}
                        type="button"
                        onClick={() => handleFileClick(file)}
                        className="flex w-full flex-col rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <span className="truncate font-mono text-sm text-foreground">{getFilename(file)}</span>
                        <span className="truncate text-xs text-muted-foreground">{getDirectory(file)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              if (item.key === 'settings') {
                handleSettingsClick()
              } else if (item.key === 'logout') {
                handleLogoutClick()
              } else {
                handleItemClick(item)
              }
            }}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left w-full"
          >
            <item.icon className="w-5 h-5 text-muted-foreground" />
            <span className="font-medium text-foreground">{item.label}</span>
          </button>
        ))}
      </SideDrawerContent>
    </SideDrawer>
  )
}

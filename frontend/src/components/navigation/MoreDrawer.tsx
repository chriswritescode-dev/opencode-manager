import { useNavigate, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Command as CommandIcon, FileText, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useMemoryPluginStatus } from '@/hooks/useMemoryPluginStatus'
import { useCommands } from '@/hooks/useCommands'
import { useUIState } from '@/stores/uiStateStore'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { SideDrawer, SideDrawerContent } from '@/components/ui/side-drawer'
import { FileBrowserSheet } from '@/components/file-browser/FileBrowserSheet'
import { buildMoreItems } from './moreDrawerItems'
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
  const [mentionFileBrowserOpen, setMentionFileBrowserOpen] = useState(false)
  const { logout } = useAuth()
  const { data: health } = useServerHealth()
  const { memoryPluginEnabled } = useMemoryPluginStatus()
  const isSessionDetail = /^\/repos\/\d+\/sessions\/[^/]+$/.test(location.pathname)
  const { filterCommands } = useCommands(isSessionDetail ? OPENCODE_API_ENDPOINT : null)
  const activePromptFileBasePath = useUIState((state) => state.activePromptFileBasePath)
  const selectPromptCommand = useUIState((state) => state.selectPromptCommand)
  const selectPromptFile = useUIState((state) => state.selectPromptFile)

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

  const getPromptFilePath = (path: string) => {
    if (!activePromptFileBasePath) return path

    const normalizedPath = path.replace(/^\.\//, '')
    const normalizedBasePath = activePromptFileBasePath.replace(/^\.\//, '').replace(/\/+$/, '')
    const basePrefix = `${normalizedBasePath}/`

    return normalizedPath.startsWith(basePrefix)
      ? normalizedPath.slice(basePrefix.length)
      : normalizedPath
  }

  const handleFileClick = (path: string) => {
    selectPromptFile(getPromptFilePath(path))
    setMentionFileBrowserOpen(false)
    onClose()
  }

  const items = buildMoreItems(location.pathname, { memoryPluginEnabled })
  const commands = filterCommands('')

  const opencodeVersion = health?.opencodeVersion
  const managerVersion = health?.opencodeManagerVersion
  const versionLabel = [
    opencodeVersion ? `v${opencodeVersion}` : null,
    managerVersion ? `Manager v${managerVersion}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <SideDrawer isOpen={isOpen} onClose={onClose} side="right" ariaLabel="More" widthClass="w-screen sm:w-[min(90vw,420px)]">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-1.5">
        {versionLabel && (
          <span className="truncate text-xs leading-tight text-muted-foreground">{versionLabel}</span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-sm p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
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
              <div className="-mx-4 max-h-64 overflow-y-auto border-y border-border bg-muted/30 p-1 sm:mx-0 sm:rounded-lg sm:border">
                {commands.map((command) => (
                  <button
                    key={command.name}
                    type="button"
                    onClick={() => handleCommandClick(command)}
                    className="flex w-full min-w-0 items-start gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <span className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">{command.name}</span>
                    {command.description && (
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{command.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setMentionFileBrowserOpen(true)}
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left w-full"
            >
              <FileText className="w-5 h-5 text-muted-foreground" />
              <span className="font-medium text-foreground flex-1">Mention File</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
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
      <FileBrowserSheet
        isOpen={mentionFileBrowserOpen}
        onClose={() => setMentionFileBrowserOpen(false)}
        basePath={activePromptFileBasePath ?? ''}
        onFileSelect={(file) => handleFileClick(file.path)}
      />
    </SideDrawer>
  )
}

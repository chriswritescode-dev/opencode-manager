import { useState, useEffect, useCallback } from 'react'
import { GeneralSettings } from '@/components/settings/GeneralSettings'
import { GitSettings } from '@/components/settings/GitSettings'
import { KeyboardShortcuts } from '@/components/settings/KeyboardShortcuts'
import { OpenCodeConfigManager } from '@/components/settings/OpenCodeConfigManager'
import { LogsViewer } from '@/components/settings/LogsViewer'
import { OpenCodeServerAuthSettings } from '@/components/settings/OpenCodeServerAuthSettings'
import { ManagerTokenSettings } from '@/components/settings/ManagerTokenSettings'
import { ServerEnvVarsSettings } from '@/components/settings/ServerEnvVarsSettings'
import { SandboxSettings } from '@/components/settings/SandboxSettings'
import { ServerHealthStatus } from '@/components/settings/ServerHealthStatus'
import { ProviderSettings } from '@/components/settings/ProviderSettings'
import { AccountSettings } from '@/components/settings/AccountSettings'
import { VoiceSettings } from '@/components/settings/VoiceSettings'
import { NotificationSettings } from '@/components/settings/NotificationSettings'
import { VersionSelectDialog } from '@/components/settings/VersionSelectDialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Settings2, Keyboard, Code, ChevronLeft, Key, GitBranch, User, Volume2, Bell, X, ScrollText, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsDialog, isSettingsContentTab, type SettingsContentTab } from '@/hooks/useSettingsDialog'
import { DESKTOP_MEDIA_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'

type SettingsView = 'menu' | SettingsContentTab

const TAB_TRIGGER_CLASS = 'data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200 sm:px-2 sm:text-xs md:px-3 md:text-sm'

export function SettingsDialog() {
  const { isOpen, close, activeTab, selectedTab, setActiveTab } = useSettingsDialog()
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY)
  const [mobileView, setMobileView] = useState<SettingsView>('menu')
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false)
  const [sectionHistory, setSectionHistory] = useState<SettingsView[]>([])
  const [authSectionsOpen, setAuthSectionsOpen] = useState(true)
  const toggleAuthSections = useCallback(() => setAuthSectionsOpen((open) => !open), [])

  const pushSectionHistory = useCallback((view: SettingsView) => {
    if (view === 'menu') return
    setSectionHistory((history) => {
      if (history.at(-1) === view) return history
      return [...history, view]
    })
  }, [])

  const handleSettingsBack = useCallback(() => {
    if (mobileView === 'menu') {
      close()
      return
    }

    const currentIndex = sectionHistory.lastIndexOf(mobileView)
    const previousHistory = currentIndex >= 0
      ? sectionHistory.slice(0, currentIndex)
      : sectionHistory
    const previousView = previousHistory.at(-1)

    if (previousView && previousView !== 'menu') {
      setSectionHistory(previousHistory)
      setMobileView(previousView)
      setActiveTab(previousView)
      return
    }

    setSectionHistory([])
    setMobileView('menu')
  }, [mobileView, sectionHistory, close, setActiveTab])

  useEffect(() => {
    if (!isOpen) {
      setMobileView('menu')
      setSectionHistory([])
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isVersionDialogOpen) {
        const target = e.target
        if (target instanceof Element) {
          const closestDialog = target.closest('[role="dialog"]')
          if (closestDialog && !closestDialog.hasAttribute('data-settings-dialog')) {
            return
          }
        }
        close()
      }
    }
    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [isOpen, close, isVersionDialogOpen])

  useEffect(() => {
    if (!isOpen || !selectedTab) return
    setMobileView(selectedTab)
    pushSectionHistory(selectedTab)
  }, [isOpen, selectedTab, pushSectionHistory])

  const menuItems: Array<{ id: SettingsContentTab; icon: LucideIcon; label: string; description: string }> = [
    { id: 'account', icon: User, label: 'Account', description: 'Profile, passkeys, and sign out' },
    { id: 'general', icon: Settings2, label: 'General Settings', description: 'App preferences and behavior' },
    { id: 'notifications', icon: Bell, label: 'Notifications', description: 'Push notification preferences' },
    { id: 'voice', icon: Volume2, label: 'Voice', description: 'Text-to-speech and speech-to-text settings' },
    { id: 'git', icon: GitBranch, label: 'Git', description: 'Git identity and credentials for repositories' },
    { id: 'shortcuts', icon: Keyboard, label: 'Keyboard Shortcuts', description: 'Customize keyboard shortcuts' },
    { id: 'opencode', icon: Code, label: 'OpenCode Config', description: 'Manage OpenCode configurations, commands, and agents' },
    { id: 'logs', icon: ScrollText, label: 'Logs', description: 'Live manager and OpenCode server logs' },
    { id: 'providers', icon: Key, label: 'Providers', description: 'Manage AI provider API keys' },
  ]

  const handleOpenMobileView = useCallback((view: SettingsContentTab) => {
    setMobileView(view)
    setActiveTab(view)
    pushSectionHistory(view)
  }, [setActiveTab, pushSectionHistory])

  const handleTabChange = (tab: string) => {
    if (!isSettingsContentTab(tab)) return
    setActiveTab(tab)
    setMobileView(tab)
    pushSectionHistory(tab)
  }

   return (
      <Dialog open={isOpen} modal={false} onOpenChange={(open) => !open && close()}>
         <DialogContent
          className="inset-0 w-full h-full max-w-none max-h-none p-0 rounded-none bg-gradient-to-br from-background via-background to-background border-border overflow-hidden !flex !flex-col !gap-0"
          fullscreen
          canSwipeBack={() => mobileView !== 'menu'}
          onSwipeBack={handleSettingsBack}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          data-settings-dialog
        >
         <DialogTitle className="sr-only">Settings</DialogTitle>
         <div className="hidden sm:flex sm:flex-col sm:h-full sm:min-h-0">
           <div className="sticky top-0 z-10 bg-gradient-to-b from-background via-background to-transparent border-b border-border backdrop-blur-sm px-6 py-4 flex-shrink-0 flex items-center justify-between">
             <h2 className="text-2xl font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
               Settings
             </h2>
             <Button
               variant="ghost"
               size="icon"
               onClick={close}
               className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px]"
             >
               <X className="w-5 h-5" />
             </Button>
           </div>
          <Tabs defaultValue="account" value={activeTab} onValueChange={handleTabChange} className="w-full flex flex-col flex-1 min-h-0">
            <div className="px-6 pt-6 pb-4 flex-shrink-0">
              <TabsList className="grid w-full grid-cols-9 bg-card p-1">
                <TabsTrigger value="account" className={TAB_TRIGGER_CLASS}>
                  Account
                </TabsTrigger>
                <TabsTrigger value="general" className={TAB_TRIGGER_CLASS}>
                  General
                </TabsTrigger>
                <TabsTrigger value="notifications" className={TAB_TRIGGER_CLASS}>
                  Notify
                </TabsTrigger>
                <TabsTrigger value="voice" className={TAB_TRIGGER_CLASS}>
                  Voice
                </TabsTrigger>
                <TabsTrigger value="git" className={TAB_TRIGGER_CLASS}>
                  Git
                </TabsTrigger>
                <TabsTrigger value="shortcuts" className={TAB_TRIGGER_CLASS}>
                  Shortcuts
                </TabsTrigger>
                <TabsTrigger value="opencode" className={TAB_TRIGGER_CLASS}>
                  OpenCode
                </TabsTrigger>
                <TabsTrigger value="logs" className={TAB_TRIGGER_CLASS}>
                  Logs
                </TabsTrigger>
                <TabsTrigger value="providers" className={TAB_TRIGGER_CLASS}>
                  Providers
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-6 pb-6">
                <TabsContent key="account" value="account" className="mt-0"><AccountSettings /></TabsContent>
                <TabsContent key="general" value="general" className="mt-0"><GeneralSettings /></TabsContent>
                <TabsContent key="notifications" value="notifications" className="mt-0"><NotificationSettings /></TabsContent>
                <TabsContent key="voice" value="voice" className="mt-0"><VoiceSettings /></TabsContent>
                <TabsContent key="git" value="git" className="mt-0"><GitSettings /></TabsContent>
                <TabsContent key="shortcuts" value="shortcuts" className="mt-0"><KeyboardShortcuts /></TabsContent>
                <TabsContent key="opencode" value="opencode" className="mt-0">
                  <div className="space-y-6">
                    <ServerHealthStatus onOpenVersionDialog={() => setIsVersionDialogOpen(true)} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <OpenCodeServerAuthSettings isOpen={authSectionsOpen} onToggle={toggleAuthSections} />
                      <ManagerTokenSettings isOpen={authSectionsOpen} onToggle={toggleAuthSections} />
                    </div>
                    <ServerEnvVarsSettings />
                    <SandboxSettings />
                    <OpenCodeConfigManager />
                  </div>
                </TabsContent>
                <TabsContent key="logs" value="logs" className="mt-0">{isDesktop && <LogsViewer />}</TabsContent>
                <TabsContent key="providers" value="providers" className="mt-0"><ProviderSettings /></TabsContent>
              </div>
            </div>
          </Tabs>
        </div>

        <div className="sm:hidden flex flex-col h-full min-h-0">
           <div className="flex-shrink-0 bg-gradient-to-b from-background via-background to-transparent border-b border-border backdrop-blur-sm px-3 py-3 flex items-center justify-between">
             <div className="flex items-center gap-2 flex-1">
                {mobileView !== 'menu' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSettingsBack}
                    className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px]"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </Button>
                )}
               <h2 className="text-xl font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                 {mobileView === 'menu' ? 'Settings' : menuItems.find(item => item.id === mobileView)?.label}
               </h2>
             </div>
             <Button
               variant="ghost"
               size="icon"
               onClick={close}
               className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex-shrink-0"
             >
               <X className="w-6 h-6" />
             </Button>
           </div>

             <div className="flex-1 min-h-0 overflow-y-auto p-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
             {mobileView === 'menu' && (
               <div className="space-y-3">
                 {menuItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleOpenMobileView(item.id)}
                      className="w-full bg-gradient-to-br from-card to-card-hover border border-border rounded-xl p-4 hover:border-border transition-all duration-200 text-left"
                    >
                     <div className="flex items-center gap-4">
                       <div className="p-3 bg-accent rounded-lg">
                         <item.icon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                       </div>
                       <div className="flex-1 min-w-0">
                         <h3 className="font-semibold text-foreground mb-1">{item.label}</h3>
                         <p className="text-sm text-muted-foreground">{item.description}</p>
                       </div>
                     </div>
                   </button>
                 ))}
               </div>
             )}

             {mobileView === 'account' && <div key="account"><AccountSettings /></div>}
             {mobileView === 'general' && <div key="general"><GeneralSettings /></div>}
             {mobileView === 'notifications' && <div key="notifications"><NotificationSettings /></div>}
             {mobileView === 'voice' && <div key="voice"><VoiceSettings /></div>}
             {mobileView === 'git' && <div key="git"><GitSettings /></div>}
              {mobileView === 'shortcuts' && <div key="shortcuts"><KeyboardShortcuts /></div>}
                {mobileView === 'opencode' && (
                   <div key="opencode" className="space-y-4">
                    <ServerHealthStatus onOpenVersionDialog={() => setIsVersionDialogOpen(true)} />
                    <OpenCodeServerAuthSettings />
                    <ManagerTokenSettings />
                    <ServerEnvVarsSettings />
                    <SandboxSettings />
                    <OpenCodeConfigManager />
                  </div>
                )}
              {mobileView === 'providers' && <div key="providers"><ProviderSettings /></div>}
              {mobileView === 'logs' && !isDesktop && <div key="logs"><LogsViewer /></div>}
           </div>
        </div>

      </DialogContent>
      <VersionSelectDialog
        open={isVersionDialogOpen}
        onOpenChange={setIsVersionDialogOpen}
      />
    </Dialog>
  )
}

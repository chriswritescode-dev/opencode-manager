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

function OpenCodeSettings({ onOpenVersionDialog }: { onOpenVersionDialog: () => void }) {
  const [authSectionsOpen, setAuthSectionsOpen] = useState(true)
  const toggleAuthSections = useCallback(() => setAuthSectionsOpen((open) => !open), [])

  return (
    <div className="space-y-6">
      <ServerHealthStatus onOpenVersionDialog={onOpenVersionDialog} />
      <OpenCodeConfigManager />
      <section className="space-y-4 border-t border-border pt-6" aria-label="Server maintenance">
        <h2 className="text-lg font-semibold">Server maintenance</h2>
        <div className="grid grid-cols-1 items-start gap-4 @min-[1000px]:grid-cols-2">
          <OpenCodeServerAuthSettings isOpen={authSectionsOpen} onToggle={toggleAuthSections} />
          <ManagerTokenSettings isOpen={authSectionsOpen} onToggle={toggleAuthSections} />
        </div>
        <ServerEnvVarsSettings />
        <SandboxSettings />
      </section>
    </div>
  )
}

export function SettingsDialog() {
  const { isOpen, close, activeTab, setActiveTab } = useSettingsDialog()
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY)
  const [mobileView, setMobileView] = useState<SettingsView>('menu')
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false)
  const [sectionHistory, setSectionHistory] = useState<SettingsView[]>([])

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
         <div className="hidden sm:flex sm:h-full sm:min-h-0 sm:flex-col">
           <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
             <h2 className="text-lg font-semibold text-foreground">Settings</h2>
             <Button
               variant="ghost"
               size="icon"
               onClick={close}
               aria-label="Close"
               className="text-muted-foreground hover:text-foreground"
             >
               <X className="w-4 h-4" />
             </Button>
           </div>
          <Tabs
            defaultValue="account"
            value={activeTab}
            onValueChange={handleTabChange}
            orientation="vertical"
            className="flex min-h-0 w-full flex-1"
          >
            <TabsList className="flex h-full min-h-0 w-56 shrink-0 flex-col items-stretch justify-start overflow-y-auto rounded-none border-r border-border bg-card p-1">
              {menuItems.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className="shrink-0 justify-start gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className={`@container min-h-0 min-w-0 flex-1 p-6 ${activeTab === 'logs' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              <TabsContent key="account" value="account" className="mt-0 px-0 max-w-7xl"><AccountSettings /></TabsContent>
              <TabsContent key="general" value="general" className="mt-0 px-0 max-w-4xl"><GeneralSettings /></TabsContent>
              <TabsContent key="notifications" value="notifications" className="mt-0 px-0 max-w-7xl"><NotificationSettings /></TabsContent>
              <TabsContent key="voice" value="voice" className="mt-0 px-0 max-w-7xl"><VoiceSettings /></TabsContent>
              <TabsContent key="git" value="git" className="mt-0 px-0 max-w-7xl"><GitSettings /></TabsContent>
              <TabsContent key="shortcuts" value="shortcuts" className="mt-0 px-0 max-w-7xl"><KeyboardShortcuts /></TabsContent>
              <TabsContent key="opencode" value="opencode" className="mt-0 px-0">
                <OpenCodeSettings onOpenVersionDialog={() => setIsVersionDialogOpen(true)} />
              </TabsContent>
              <TabsContent key="logs" value="logs" className="mt-0 h-full min-h-0 px-0">{isDesktop && <LogsViewer />}</TabsContent>
              <TabsContent key="providers" value="providers" className="mt-0 px-0 max-w-7xl"><ProviderSettings /></TabsContent>
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
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex-shrink-0"
              >
               <X className="w-6 h-6" />
             </Button>
           </div>

             <div className={`@container flex-1 min-h-0 p-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] ${mobileView === 'logs' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
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
                   <OpenCodeSettings key="opencode" onOpenVersionDialog={() => setIsVersionDialogOpen(true)} />
                )}
              {mobileView === 'providers' && <div key="providers"><ProviderSettings /></div>}
              {mobileView === 'logs' && !isDesktop && <div key="logs" className="h-full min-h-0"><LogsViewer /></div>}
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

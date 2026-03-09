import { useState, useRef, useEffect, useCallback } from 'react'
import { GeneralSettings } from '@/components/settings/GeneralSettings'
import { GitSettings } from '@/components/settings/GitSettings'
import { KeyboardShortcuts } from '@/components/settings/KeyboardShortcuts'
import { OpenCodeConfigManager } from '@/components/settings/OpenCodeConfigManager'
import { ProviderSettings } from '@/components/settings/ProviderSettings'
import { AccountSettings } from '@/components/settings/AccountSettings'
import { VoiceSettings } from '@/components/settings/VoiceSettings'
import { NotificationSettings } from '@/components/settings/NotificationSettings'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Settings2, Keyboard, Code, ChevronLeft, Key, GitBranch, User, Volume2, Bell, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSwipeBack } from '@/hooks/useMobile'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { cn } from '@/lib/utils'

type SettingsView = 'menu' | 'general' | 'git' | 'shortcuts' | 'opencode' | 'providers' | 'account' | 'voice' | 'notifications'
type SettingsSection = Exclude<SettingsView, 'menu'>

interface SettingsMenuItem {
  id: SettingsSection
  icon: LucideIcon
  label: string
  description: string
}

export function SettingsDialog() {
  const { isOpen, close, activeTab, setActiveTab } = useSettingsDialog()
  const [mobileView, setMobileView] = useState<SettingsView>('menu')
  const contentRef = useRef<HTMLDivElement>(null)

  const handleSwipeBack = useCallback(() => {
    if (mobileView === 'menu') {
      setMobileView('menu')
      close()
    } else {
      setMobileView('menu')
    }
  }, [mobileView, close])

  const { bind: bindSwipe, swipeStyles } = useSwipeBack(handleSwipeBack, {
    enabled: isOpen,
  })

  useEffect(() => {
    return bindSwipe(contentRef.current)
  }, [bindSwipe])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, close])

  const menuItems: SettingsMenuItem[] = [
    { id: 'account', icon: User, label: 'Account', description: 'Profile, passkeys, and sign out' },
    { id: 'general', icon: Settings2, label: 'General Settings', description: 'App preferences and behavior' },
    { id: 'notifications', icon: Bell, label: 'Notifications', description: 'Push notification preferences' },
    { id: 'voice', icon: Volume2, label: 'Voice', description: 'Text-to-speech and speech-to-text settings' },
    { id: 'git', icon: GitBranch, label: 'Git', description: 'Git identity and credentials for repositories' },
    { id: 'shortcuts', icon: Keyboard, label: 'Keyboard Shortcuts', description: 'Customize keyboard shortcuts' },
    { id: 'opencode', icon: Code, label: 'OpenCode Config', description: 'Manage OpenCode configurations, commands, and agents' },
    { id: 'providers', icon: Key, label: 'Providers', description: 'Manage AI provider API keys' },
  ]

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as SettingsSection)
  }

  const activeItem = menuItems.find((item) => item.id === activeTab) ?? menuItems[0]
  const mobileActiveItem = mobileView === 'menu'
    ? activeItem
    : menuItems.find((item) => item.id === mobileView) ?? activeItem

  const renderSectionIntro = (item: SettingsMenuItem, compact = false) => (
    <div className={cn('surface-panel rounded-[1.5rem]', compact ? 'p-4' : 'p-5')}>
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Current Section</p>
      <div className="mt-3 flex items-start gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <item.icon className="size-5" />
        </div>
        <div className="min-w-0">
          <h3 className={cn('font-semibold text-foreground', compact ? 'text-xl' : 'text-2xl')}>{item.label}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
        </div>
      </div>
    </div>
  )

  const renderSettingsContent = (value: SettingsSection) => {
    switch (value) {
      case 'account':
        return <AccountSettings />
      case 'general':
        return <GeneralSettings />
      case 'notifications':
        return <NotificationSettings />
      case 'voice':
        return <VoiceSettings />
      case 'git':
        return <GitSettings />
      case 'shortcuts':
        return <KeyboardShortcuts />
      case 'opencode':
        return <OpenCodeConfigManager />
      case 'providers':
        return <ProviderSettings />
    }
  }

   return (
     <Dialog open={isOpen} modal={false}>
       <DialogContent 
         ref={contentRef}
         className="inset-0 w-full h-full max-w-none max-h-none p-0 rounded-none bg-gradient-to-br from-background via-background to-background border-border overflow-hidden !flex !flex-col"
         style={swipeStyles}
         fullscreen
        >
          <div className="hidden sm:flex sm:flex-col sm:h-full">
            <div className="sticky top-0 z-10 border-b border-border/70 bg-background/84 px-6 py-4 supports-[backdrop-filter]:bg-background/68 backdrop-blur-xl flex-shrink-0 flex items-center justify-between">
              <h2 className="heading-ink text-2xl font-semibold">
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
             <Tabs defaultValue="account" value={activeTab} onValueChange={handleTabChange} orientation="vertical" className="w-full flex flex-col flex-1 min-h-0">
                 <ResizablePanelGroup orientation="horizontal" resizeTargetMinimumSize={{ coarse: 28, fine: 14 }} className="min-h-0 flex-1">
                  <ResizablePanel defaultSize={28} minSize={22} maxSize={40}>
                   <div className="flex h-full flex-col border-r border-border/70 bg-panel/60">
                     <div className="px-5 pt-5 pb-3">
                       <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Workspace Preferences</p>
                       <p className="mt-2 text-sm text-muted-foreground">Manage your account, git identity, provider access, and OpenCode behavior.</p>
                    </div>
                    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                      <TabsList className="h-auto w-full flex-col items-stretch justify-start gap-1 rounded-none border-0 bg-transparent p-0 shadow-none">
                        {menuItems.map((item) => {
                          const isActive = activeTab === item.id

                          return (
                             <TabsTrigger
                               key={item.id}
                               value={item.id}
                               className="h-auto w-full justify-start whitespace-normal px-3 py-3 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                             >
                              <div className="flex items-start gap-3">
                                <div className={cn(
                                  'mt-0.5 flex size-10 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground transition-colors',
                                  isActive && 'border-transparent bg-primary-foreground/14 text-primary-foreground'
                                )}>
                                  <item.icon className="size-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium leading-none">{item.label}</p>
                                  <p className={cn('mt-1.5 text-xs leading-5 text-muted-foreground', isActive && 'text-primary-foreground/78')}>
                                    {item.description}
                                  </p>
                                </div>
                              </div>
                            </TabsTrigger>
                          )
                       })}
                      </TabsList>
                     </div>
                     <div className="border-t border-border/60 px-4 py-4">
                       <div className="surface-panel-muted rounded-2xl p-4">
                         <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Quick Tip</p>
                         <p className="mt-2 text-sm text-foreground">Drag the divider to resize the sidebar and use `Esc` to close settings.</p>
                       </div>
                     </div>
                   </div>
                 </ResizablePanel>
                <ResizableHandle withHandle className="w-3 bg-transparent" />
                  <ResizablePanel defaultSize={72} minSize={48}>
                   <div className="scrollbar-thin h-full overflow-y-auto">
                     <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
                       {renderSectionIntro(activeItem)}
                       {menuItems.map((item) => (
                         <TabsContent key={item.id} value={item.id} className="mt-0">
                           {renderSettingsContent(item.id)}
                        </TabsContent>
                      ))}
                    </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </Tabs>
          </div>

         <div className="sm:hidden flex flex-col h-full min-h-0 pt-safe">
            <div className="flex-shrink-0 border-b border-border/70 bg-background/84 px-4 py-4 supports-[backdrop-filter]:bg-background/68 backdrop-blur-xl flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
               {mobileView !== 'menu' && (
                 <Button
                   variant="ghost"
                   size="icon"
                   onClick={() => setMobileView('menu')}
                   className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px]"
                 >
                   <ChevronLeft className="w-6 h-6" />
                 </Button>
               )}
                <h2 className="heading-ink text-xl font-semibold">
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

            <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto p-4 pb-32">
               {mobileView === 'menu' && (
                 <div className="space-y-4">
                   <div className="surface-panel rounded-[1.5rem] p-4">
                     <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Workspace Preferences</p>
                     <h3 className="mt-3 text-xl font-semibold text-foreground">Choose a settings area</h3>
                     <p className="mt-2 text-sm text-muted-foreground">Jump between account, provider, voice, git, and OpenCode controls without leaving the current repo context.</p>
                     <Button
                       variant="outline"
                       size="sm"
                       className="mt-4 w-full justify-start"
                       onClick={() => {
                         setMobileView(activeItem.id)
                         setActiveTab(activeItem.id)
                       }}
                     >
                       Open {activeItem.label}
                     </Button>
                   </div>
                   {menuItems.map((item) => (
                    <button
                      key={item.id}
                     onClick={() => {
                        setMobileView(item.id)
                        setActiveTab(item.id)
                     }}
                      className="surface-panel w-full rounded-2xl p-4 transition-[transform,border-color,background-color] duration-200 hover:border-primary/25 hover:-translate-y-0.5 active:translate-y-0 text-left"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-xs">
                          <item.icon className="w-6 h-6" />
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

               {mobileView !== 'menu' && (
                 <div key={mobileView} className="space-y-4">
                   {renderSectionIntro(mobileActiveItem, true)}
                   {renderSettingsContent(mobileView)}
                 </div>
               )}
             </div>
         </div>
      </DialogContent>
    </Dialog>
  )
}

import { useState, useRef, useEffect, useCallback } from 'react'
import { GeneralSettings } from '@/components/settings/GeneralSettings'
import { KeyboardShortcuts } from '@/components/settings/KeyboardShortcuts'
import { OpenCodeConfigManager } from '@/components/settings/OpenCodeConfigManager'
import { ProviderSettings } from '@/components/settings/ProviderSettings'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Settings2, Keyboard, Code, ChevronLeft, X, Key } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSwipeBack } from '@/hooks/useMobile'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsView = 'menu' | 'general' | 'shortcuts' | 'opencode' | 'providers'

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [mobileView, setMobileView] = useState<SettingsView>('menu')
  const contentRef = useRef<HTMLDivElement>(null)

  const handleSwipeBack = useCallback(() => {
    if (mobileView === 'menu') {
      setMobileView('menu')
      onOpenChange(false)
    } else {
      setMobileView('menu')
    }
  }, [mobileView, onOpenChange])

  const { bind: bindSwipe, swipeStyles } = useSwipeBack(handleSwipeBack, {
    enabled: open,
  })

  useEffect(() => {
    return bindSwipe(contentRef.current)
  }, [bindSwipe])

  const menuItems = [
    { id: 'general', icon: Settings2, label: 'General Settings', description: 'App preferences and behavior' },
    { id: 'shortcuts', icon: Keyboard, label: 'Keyboard Shortcuts', description: 'Customize keyboard shortcuts' },
    { id: 'opencode', icon: Code, label: 'OpenCode Config', description: 'Manage OpenCode configurations, commands, and agents' },
    { id: 'providers', icon: Key, label: 'Providers', description: 'Manage AI provider API keys' },
  ]

  const handleClose = () => {
    setMobileView('menu')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent 
        ref={contentRef}
        className="max-w-4xl w-full h-[100vh] sm:h-auto sm:w-[95vw] sm:max-h-[90vh] bg-gradient-to-br from-background via-background to-background border-border p-0 sm:rounded-lg overflow-hidden !flex !flex-col left-0 top-0 translate-x-0 translate-y-0 max-h-[100vh] sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] [&>button:last-child]:hidden"
        style={swipeStyles}
      >
        
        <div className="hidden sm:flex sm:flex-col sm:h-[90vh]">
          <div className="sticky top-0 z-10 bg-gradient-to-b from-background via-background to-transparent border-b border-border backdrop-blur-sm px-6 py-4 flex-shrink-0">
            <h2 className="text-2xl font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              Settings
            </h2>
          </div>
          <Tabs defaultValue="general" className="w-full flex flex-col flex-1 min-h-0">
            <div className="px-6 pt-6 pb-4 flex-shrink-0">
              <TabsList className="grid w-full grid-cols-4 bg-card border border-border p-1">
                <TabsTrigger value="general" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  General
                </TabsTrigger>
                <TabsTrigger value="shortcuts" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  Shortcuts
                </TabsTrigger>
                <TabsTrigger value="opencode" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  OpenCode
                </TabsTrigger>
                <TabsTrigger value="providers" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  Providers
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="px-6 pb-6">
                <TabsContent value="general" className="mt-0"><GeneralSettings /></TabsContent>
                <TabsContent value="shortcuts" className="mt-0"><KeyboardShortcuts /></TabsContent>
                <TabsContent value="opencode" className="mt-0"><OpenCodeConfigManager /></TabsContent>
                <TabsContent value="providers" className="mt-0"><ProviderSettings /></TabsContent>
              </div>
            </div>
          </Tabs>
        </div>

        <div className="sm:hidden flex flex-col h-full min-h-0">
          <div className="flex-shrink-0 bg-gradient-to-b from-background via-background to-transparent border-b border-border backdrop-blur-sm px-4 py-4 flex items-center justify-between">
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
              <h2 className="text-xl font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                {mobileView === 'menu' ? 'Settings' : menuItems.find(item => item.id === mobileView)?.label}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex-shrink-0"
            >
              <X className="w-6 h-6" />
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-32">
            {mobileView === 'menu' && (
              <div className="space-y-3">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setMobileView(item.id as SettingsView)}
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

            {mobileView === 'general' && <GeneralSettings />}
            {mobileView === 'shortcuts' && <KeyboardShortcuts />}
            {mobileView === 'opencode' && <OpenCodeConfigManager />}
            {mobileView === 'providers' && <ProviderSettings />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

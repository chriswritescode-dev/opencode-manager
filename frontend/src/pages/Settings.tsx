import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Header } from '@/components/layout/Header'
import { GeneralSettings } from '@/components/settings/GeneralSettings'
import { KeyboardShortcuts } from '@/components/settings/KeyboardShortcuts'
import { OpenCodeConfigManager } from '@/components/settings/OpenCodeConfigManager'
import { usePermissionContext } from '@/contexts/PermissionContext'

export function Settings() {
  const { pendingCount, setShowDialog } = usePermissionContext()

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#0d0d0d] to-[#0a0a0a]">
      <Header title="Settings" backTo="/" pendingPermissions={pendingCount} onPendingPermissionsClick={() => setShowDialog(true)} />

      <div className="max-w-4xl mx-auto p-6">
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8 bg-[#141414] border border-[#262626] p-1">
            <TabsTrigger 
              value="general"
              className="data-[state=active]:bg-blue-800 data-[state=active]:text-white text-zinc-400"
            >
              General
            </TabsTrigger>
            <TabsTrigger 
              value="shortcuts"
              className="data-[state=active]:bg-blue-800 data-[state=active]:text-white text-zinc-400"
            >
              Shortcuts
            </TabsTrigger>
            <TabsTrigger 
              value="opencode"
              className="data-[state=active]:bg-blue-800 data-[state=active]:text-white text-zinc-400"
            >
              OpenCode
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <GeneralSettings />
          </TabsContent>

          <TabsContent value="shortcuts">
            <KeyboardShortcuts />
          </TabsContent>

<TabsContent value="opencode">
            <OpenCodeConfigManager />
          </TabsContent>

          <TabsContent value="commands">
            <div className="bg-[#141414] border border-[#262626] rounded-lg p-8 text-center">
              <p className="text-zinc-500">Commands manager coming soon</p>
            </div>
          </TabsContent>

          <TabsContent value="agents">
            <div className="bg-[#141414] border border-[#262626] rounded-lg p-8 text-center">
              <p className="text-zinc-500">Agents manager coming soon</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

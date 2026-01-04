import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Header } from '@/components/ui/header'
import { GeneralSettings } from '@/components/settings/GeneralSettings'
import { KeyboardShortcuts } from '@/components/settings/KeyboardShortcuts'
import { OpenCodeConfigManager } from '@/components/settings/OpenCodeConfigManager'

export function Settings() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background">
      <Header>
        <Header.BackButton to="/" />
        <Header.Title>Settings</Header.Title>
        <Header.Settings />
      </Header>

      <div className="max-w-4xl mx-auto p-6">
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
            <TabsTrigger value="opencode">OpenCode</TabsTrigger>
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
            <div className="border border-border rounded-lg p-8 text-center">
              <p className="text-muted-foreground">Commands manager coming soon</p>
            </div>
          </TabsContent>

          <TabsContent value="agents">
            <div className="border border-border rounded-lg p-8 text-center">
              <p className="text-muted-foreground">Agents manager coming soon</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

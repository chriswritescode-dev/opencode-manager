import { useSettings } from '@/hooks/useSettings'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { TTSSettings } from './TTSSettings'

export function GeneralSettings() {
  const { preferences, isLoading, updateSettings, isUpdating } = useSettings()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6">General Preferences</h2>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="theme">Theme</Label>
          <Select
            value={preferences?.theme || 'dark'}
            onValueChange={(value) => updateSettings({ theme: value as 'dark' | 'light' | 'system' })}
          >
            <SelectTrigger id="theme">
              <SelectValue placeholder="Select a theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Choose your preferred color scheme
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mode">Mode</Label>
          <Select
            value={preferences?.mode || 'build'}
            onValueChange={(value) => updateSettings({ mode: value as 'plan' | 'build' })}
          >
            <SelectTrigger id="mode">
              <SelectValue placeholder="Select a mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plan">Plan</SelectItem>
              <SelectItem value="build">Build</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Plan mode: Read-only. Build mode: File changes enabled
          </p>
        </div>

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="autoScroll" className="text-base">Auto-scroll</Label>
            <p className="text-sm text-muted-foreground">
              Automatically scroll to bottom when new messages arrive
            </p>
          </div>
          <Switch
            id="autoScroll"
            checked={preferences?.autoScroll ?? true}
            onCheckedChange={(checked) => updateSettings({ autoScroll: checked })}
          />
        </div>

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="showReasoning" className="text-base">Show reasoning</Label>
            <p className="text-sm text-muted-foreground">
              Display model reasoning and thought process
            </p>
          </div>
          <Switch
            id="showReasoning"
            checked={preferences?.showReasoning ?? false}
            onCheckedChange={(checked) => updateSettings({ showReasoning: checked })}
          />
        </div>

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="expandToolCalls" className="text-base">Expand tool calls</Label>
            <p className="text-sm text-muted-foreground">
              Automatically expand tool call details by default
            </p>
          </div>
          <Switch
            id="expandToolCalls"
            checked={preferences?.expandToolCalls ?? false}
            onCheckedChange={(checked) => updateSettings({ expandToolCalls: checked })}
          />
        </div>

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="expandDiffs" className="text-base">Expand diffs</Label>
            <p className="text-sm text-muted-foreground">
              Show file diffs expanded by default for edit operations
            </p>
          </div>
          <Switch
            id="expandDiffs"
            checked={preferences?.expandDiffs ?? true}
            onCheckedChange={(checked) => updateSettings({ expandDiffs: checked })}
          />
        </div>

        {isUpdating && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Saving...</span>
          </div>
        )}
      </div>

      <div className="mt-6">
        <TTSSettings />
      </div>
    </div>
  )
}

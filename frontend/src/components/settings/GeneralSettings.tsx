import { useSettings } from '@/hooks/useSettings'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export function GeneralSettings() {
  const { preferences, isLoading, updateSettings, isUpdating } = useSettings()
  const { data: versionInfo, isLoading: isVersionLoading } = useVersionCheck()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">General Preferences</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>OpenCode Manager</span>
          {isVersionLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : versionInfo?.currentVersion ? (
            <>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                {versionInfo.currentVersion}
              </span>
              {versionInfo.updateAvailable && versionInfo.latestVersion && (
                <a
                  href={versionInfo.releaseUrl ?? ''}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-green-500 hover:text-green-400 transition-colors"
                >
                  v{versionInfo.latestVersion} available
                </a>
              )}
            </>
          ) : (
            <span>unknown</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="theme">Theme</Label>
          <p className="text-sm text-muted-foreground">
            Choose your preferred color scheme
          </p>
        </div>
        <Select
          value={preferences?.theme || 'dark'}
          onValueChange={(value) => updateSettings({ theme: value as 'dark' | 'light' | 'system' })}
        >
          <SelectTrigger id="theme" className="w-full shrink-0 sm:w-40">
            <SelectValue placeholder="Select a theme" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="divide-y divide-border">
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="simpleChatMode">Simple chat mode</Label>
            <p className="text-sm text-muted-foreground">
              Show only your messages and the assistant's replies. Hides tool calls, reasoning, diffs, and agent details.
            </p>
          </div>
          <Switch
            id="simpleChatMode"
            checked={preferences?.simpleChatMode ?? false}
            onCheckedChange={(checked) => updateSettings({ simpleChatMode: checked })}
          />
        </div>

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="autoScroll">Auto-scroll</Label>
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

        {!preferences?.simpleChatMode && (
          <>
            <div className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="showReasoning">Show reasoning</Label>
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

            <div className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="expandToolCalls">Expand tool calls</Label>
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

            <div className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="expandDiffs">Expand diffs</Label>
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
          </>
        )}
      </div>

      {isUpdating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}
    </div>
  )
}

import { useSettings } from '@/hooks/useSettings'
import { useTheme } from '@/hooks/useTheme'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_THEME_PRESET, getThemeLabel, OPENCODE_THEME_OPTIONS, resolveOpenCodeTheme } from '@/lib/opencodeThemes'

function PreferenceToggle({
  id,
  title,
  description,
  checked,
  onCheckedChange,
}: {
  id: string
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-4 py-3">
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor={id} className="text-sm font-medium text-foreground">{title}</Label>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </div>
  )
}

export function GeneralSettings() {
  const { preferences, isLoading, updateSettings, isUpdating } = useSettings()
  const { data: versionInfo, isLoading: isVersionLoading } = useVersionCheck()
  const currentMode = useTheme()

  const appearance = preferences?.theme || 'dark'
  const themePreset = preferences?.themePreset || DEFAULT_THEME_PRESET
  const previewMode = appearance === 'system' ? currentMode : appearance
  const previewTheme = resolveOpenCodeTheme(themePreset, previewMode)
  const previewSwatches = [
    previewTheme.primary,
    previewTheme.secondary,
    previewTheme.info,
    previewTheme.success,
    previewTheme.warning,
    previewTheme.error,
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="surface-panel rounded-xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Preferences</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">General Settings</h2>
        </div>
        <div className="flex items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2">
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">OpenCode Manager</span>
          {isVersionLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : versionInfo?.currentVersion ? (
            <>
              <span className="rounded border border-border/70 bg-background px-2 py-0.5 text-sm font-mono">
                {versionInfo.currentVersion}
              </span>
              {versionInfo.updateAvailable && versionInfo.latestVersion && (
                <a
                  href={versionInfo.releaseUrl ?? ''}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-success transition-colors hover:text-success/80"
                >
                  v{versionInfo.latestVersion} available
                </a>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">unknown</span>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
            <div className="space-y-2">
              <Label htmlFor="themePreset">Theme Palette</Label>
              <Select value={themePreset} onValueChange={(value) => updateSettings({ themePreset: value })}>
                <SelectTrigger id="themePreset">
                  <SelectValue placeholder="Select an OpenCode theme" />
                </SelectTrigger>
                <SelectContent className="max-h-[24rem]">
                  {OPENCODE_THEME_OPTIONS.map((themeOption) => (
                    <SelectItem key={themeOption.id} value={themeOption.id}>
                      {themeOption.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">Matches the built-in palettes available in OpenCode's `/theme` picker.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="theme">Appearance</Label>
              <Select
                value={appearance}
                onValueChange={(value) => updateSettings({ theme: value as 'dark' | 'light' | 'system' })}
              >
                <SelectTrigger id="theme">
                  <SelectValue placeholder="Select an appearance mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">Controls whether the selected OpenCode palette renders in light, dark, or system mode.</p>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Live Preview</p>
                <p className="mt-2 text-sm font-medium text-foreground">{getThemeLabel(themePreset)}</p>
                <p className="text-sm text-muted-foreground">{previewMode === 'dark' ? 'Dark mode' : 'Light mode'} palette preview</p>
              </div>
              <span className="rounded border border-border/70 bg-background px-2 py-1 text-xs font-mono text-muted-foreground">
                {previewMode}
              </span>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {previewSwatches.map((color) => (
                <div key={color} className="space-y-1">
                  <div className="h-8 rounded-md border border-border/70" style={{ backgroundColor: color }} />
                </div>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-border/70 p-3" style={{ backgroundColor: previewTheme.backgroundPanel }}>
                <div className="text-xs uppercase tracking-[0.16em]" style={{ color: previewTheme.textMuted }}>Panel</div>
                <div className="mt-2 text-sm font-medium" style={{ color: previewTheme.text }}>Workspace shell</div>
              </div>
              <div className="rounded-md border p-3" style={{ backgroundColor: previewTheme.backgroundElement, borderColor: previewTheme.borderSubtle }}>
                <div className="text-xs uppercase tracking-[0.16em]" style={{ color: previewTheme.textMuted }}>Element</div>
                <div className="mt-2 text-sm font-medium" style={{ color: previewTheme.text }}>Inputs and cards</div>
              </div>
              <div className="rounded-md border p-3" style={{ backgroundColor: previewTheme.diffAddedBg, borderColor: previewTheme.border }}>
                <div className="text-xs uppercase tracking-[0.16em]" style={{ color: previewTheme.textMuted }}>Diff</div>
                <div className="mt-2 text-sm font-medium" style={{ color: previewTheme.diffAdded }}>Added lines</div>
              </div>
            </div>
          </div>
        </div>

        <PreferenceToggle
          id="autoScroll"
          title="Auto-scroll"
          description="Automatically scroll to the latest agent output as new messages arrive."
          checked={preferences?.autoScroll ?? true}
          onCheckedChange={(checked) => updateSettings({ autoScroll: checked })}
        />

        <PreferenceToggle
          id="showReasoning"
          title="Show reasoning"
          description="Display model reasoning and thought process when it is available."
          checked={preferences?.showReasoning ?? false}
          onCheckedChange={(checked) => updateSettings({ showReasoning: checked })}
        />

        <PreferenceToggle
          id="expandToolCalls"
          title="Expand tool calls"
          description="Keep tool call details expanded by default so command output stays visible."
          checked={preferences?.expandToolCalls ?? false}
          onCheckedChange={(checked) => updateSettings({ expandToolCalls: checked })}
        />

        <PreferenceToggle
          id="expandDiffs"
          title="Expand diffs"
          description="Show file diffs expanded by default for edits, patches, and source-control panels."
          checked={preferences?.expandDiffs ?? true}
          onCheckedChange={(checked) => updateSettings({ expandDiffs: checked })}
        />

        {isUpdating && (
          <div className="flex items-center gap-2 rounded-md border border-border/70 bg-card px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Saving theme and preference changes...</span>
          </div>
        )}
      </div>
    </div>
  )
}

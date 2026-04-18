import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { SideDrawer, SideDrawerHeader, SideDrawerContent } from '@/components/ui/side-drawer'
import { Settings, LogOut, Info, Moon, Sun, Monitor } from 'lucide-react'

interface MoreDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export function MoreDrawer({ isOpen, onClose }: MoreDrawerProps) {
  const { open: openSettingsDialog } = useSettingsDialog()
  const { preferences, updateSettings } = useSettings()
  const { logout } = useAuth()

  const handleSettingsClick = () => {
    openSettingsDialog()
    onClose()
  }

  const handleLogoutClick = async () => {
    try {
      await logout()
    } finally {
      onClose()
    }
  }

  const handleThemeChange = (theme: 'light' | 'dark' | 'system') => {
    updateSettings({ theme })
  }

  const currentTheme = preferences?.theme || 'dark'

  return (
    <SideDrawer isOpen={isOpen} onClose={onClose} side="right" ariaLabel="More">
      <SideDrawerHeader title="More" onClose={onClose} />
      <SideDrawerContent className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleSettingsClick}
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left w-full"
        >
          <Settings className="w-5 h-5 text-muted-foreground" />
          <span className="font-medium text-foreground">Settings</span>
        </button>

        <div className="p-3">
          <p className="text-sm font-medium text-foreground mb-2">Theme</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleThemeChange('light')}
              className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border transition-colors ${
                currentTheme === 'light'
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'border-border hover:bg-accent'
              }`}
            >
              <Sun className="w-4 h-4" />
              <span className="text-sm">Light</span>
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange('dark')}
              className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border transition-colors ${
                currentTheme === 'dark'
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'border-border hover:bg-accent'
              }`}
            >
              <Moon className="w-4 h-4" />
              <span className="text-sm">Dark</span>
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange('system')}
              className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border transition-colors ${
                currentTheme === 'system'
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'border-border hover:bg-accent'
              }`}
            >
              <Monitor className="w-4 h-4" />
              <span className="text-sm">System</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogoutClick}
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left w-full"
        >
          <LogOut className="w-5 h-5 text-muted-foreground" />
          <span className="font-medium text-foreground">Logout</span>
        </button>

        <div className="mt-auto p-3 border-t border-border">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Info className="w-4 h-4" />
            <span className="text-sm">
              {import.meta.env.VITE_APP_VERSION ? `v${import.meta.env.VITE_APP_VERSION}` : 'OpenCode'}
            </span>
          </div>
        </div>
      </SideDrawerContent>
    </SideDrawer>
  )
}

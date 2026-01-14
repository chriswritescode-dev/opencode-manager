import { useNotifications } from '@/hooks/useNotifications'
import { useSettings } from '@/hooks/useSettings'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { DEFAULT_NOTIFICATION_CONFIG } from '@opencode-manager/shared'

export function NotificationSettings() {
  const { preferences, updateSettings } = useSettings()
  const { isSupported, permission, requestPermission } = useNotifications()
  
  const notificationConfig = preferences?.notifications ?? DEFAULT_NOTIFICATION_CONFIG

  const handleChange = (updates: Partial<typeof notificationConfig>) => {
    updateSettings({
      notifications: {
        ...notificationConfig,
        ...updates,
      },
    })
  }

  const getPermissionStatus = () => {
    if (!isSupported) return { icon: BellOff, text: 'Not supported', color: 'text-muted-foreground' }
    if (permission === 'granted') return { icon: Bell, text: 'Allowed', color: 'text-green-500' }
    if (permission === 'denied') return { icon: BellOff, text: 'Blocked', color: 'text-red-500' }
    return { icon: BellRing, text: 'Not requested', color: 'text-yellow-500' }
  }

  const status = getPermissionStatus()
  const StatusIcon = status.icon

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6">Notifications</h2>
      
      <div className="space-y-6">
        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label className="text-base">Browser Permission</Label>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <StatusIcon className={`h-4 w-4 ${status.color}`} />
              <span className={status.color}>{status.text}</span>
            </p>
          </div>
          {isSupported && permission !== 'granted' && (
            <Button
              variant="outline"
              size="sm"
              onClick={requestPermission}
              disabled={permission === 'denied'}
            >
              {permission === 'denied' ? 'Blocked in browser' : 'Enable notifications'}
            </Button>
          )}
        </div>

        {permission === 'denied' && (
          <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
            Notifications are blocked. To enable them, click the lock icon in your browser's address bar and allow notifications for this site.
          </p>
        )}

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="notificationsEnabled" className="text-base">Enable Notifications</Label>
            <p className="text-sm text-muted-foreground">
              Receive push notifications when you're away from the tab
            </p>
          </div>
          <Switch
            id="notificationsEnabled"
            checked={notificationConfig.enabled}
            onCheckedChange={(checked) => handleChange({ enabled: checked })}
            disabled={!isSupported || permission !== 'granted'}
          />
        </div>

        {notificationConfig.enabled && permission === 'granted' && (
          <>
            <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="sessionComplete" className="text-base">Session Complete</Label>
                <p className="text-sm text-muted-foreground">
                  Notify when a session finishes processing
                </p>
              </div>
              <Switch
                id="sessionComplete"
                checked={notificationConfig.sessionComplete}
                onCheckedChange={(checked) => handleChange({ sessionComplete: checked })}
              />
            </div>

            <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="permissionRequests" className="text-base">Permission Requests</Label>
                <p className="text-sm text-muted-foreground">
                  Notify when a tool needs your approval
                </p>
              </div>
              <Switch
                id="permissionRequests"
                checked={notificationConfig.permissionRequests}
                onCheckedChange={(checked) => handleChange({ permissionRequests: checked })}
              />
            </div>

            <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="notificationSound" className="text-base">Sound</Label>
                <p className="text-sm text-muted-foreground">
                  Play a sound when notifications arrive
                </p>
              </div>
              <Switch
                id="notificationSound"
                checked={notificationConfig.sound}
                onCheckedChange={(checked) => handleChange({ sound: checked })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

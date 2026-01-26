import { useState, useEffect, useCallback } from 'react'
import { useNotifications } from '@/hooks/useNotifications'
import { useSettings } from '@/hooks/useSettings'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Bell, BellOff, BellRing, Send, Loader2 } from 'lucide-react'
import { DEFAULT_NOTIFICATION_CONFIG } from '@opencode-manager/shared'
import { 
  subscribePushNotifications, 
  unsubscribePushNotifications, 
  isPushSubscribed,
  testPushNotification,
} from '@/api/push'
import { showToast } from '@/lib/toast'

export function NotificationSettings() {
  const { preferences, updateSettings } = useSettings()
  const { isSupported, permission, requestPermission, testNotification } = useNotifications()
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [isSubscribing, setIsSubscribing] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  
  const notificationConfig = preferences?.notifications ?? DEFAULT_NOTIFICATION_CONFIG

  useEffect(() => {
    isPushSubscribed().then(setPushSubscribed)
  }, [])

  const handleChange = (updates: Partial<typeof notificationConfig>) => {
    updateSettings({
      notifications: {
        ...notificationConfig,
        ...updates,
      },
    })
  }

  const handlePushSubscribe = useCallback(async () => {
    setIsSubscribing(true)
    try {
      if (pushSubscribed) {
        await unsubscribePushNotifications()
        setPushSubscribed(false)
        showToast.success('Push notifications disabled')
      } else {
        const subscription = await subscribePushNotifications()
        if (subscription) {
          setPushSubscribed(true)
          showToast.success('Push notifications enabled')
        } else {
          showToast.error('Failed to enable push notifications')
        }
      }
    } catch (error) {
      console.error('Push subscription error:', error)
      showToast.error('Failed to toggle push notifications')
    } finally {
      setIsSubscribing(false)
    }
  }, [pushSubscribed])

  const handleTestPush = useCallback(async () => {
    setIsTesting(true)
    try {
      const result = await testPushNotification()
      if (result.success) {
        showToast.success('Test notification sent')
      } else {
        showToast.error(result.message || 'Failed to send test notification')
      }
    } catch (error) {
      console.error('Test push error:', error)
      showToast.error('Failed to send test notification')
    } finally {
      setIsTesting(false)
    }
  }, [])

  const getPermissionStatus = () => {
    if (!isSupported) return { icon: BellOff, text: 'Not supported', color: 'text-muted-foreground' }
    if (permission === 'granted') return { icon: Bell, text: 'Allowed', color: 'text-green-500' }
    if (permission === 'denied') return { icon: BellOff, text: 'Blocked', color: 'text-red-500' }
    return { icon: BellRing, text: 'Not requested', color: 'text-yellow-500' }
  }

  const status = getPermissionStatus()
  const StatusIcon = status.icon

  const isPushSupported = 'serviceWorker' in navigator && 'PushManager' in window

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

        {isPushSupported && permission === 'granted' && (
          <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4 bg-primary/5">
            <div className="space-y-0.5">
              <Label className="text-base">Push Notifications (Background)</Label>
              <p className="text-sm text-muted-foreground">
                Receive notifications even when the browser tab is closed
              </p>
              {pushSubscribed && (
                <p className="text-xs text-green-500 mt-1">
                  Subscribed to push notifications
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {pushSubscribed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestPush}
                  disabled={isTesting}
                >
                  {isTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-1" />
                      Test
                    </>
                  )}
                </Button>
              )}
              <Button
                variant={pushSubscribed ? 'destructive' : 'default'}
                size="sm"
                onClick={handlePushSubscribe}
                disabled={isSubscribing}
              >
                {isSubscribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : pushSubscribed ? (
                  'Disable'
                ) : (
                  'Enable Push'
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="notificationsEnabled" className="text-base">Enable Notifications</Label>
            <p className="text-sm text-muted-foreground">
              Receive notifications when you're away from the tab
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

            <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label className="text-base">Test Notification</Label>
                <p className="text-sm text-muted-foreground">
                  Send a test notification to verify everything works
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={testNotification}
              >
                <Bell className="h-4 w-4 mr-1" />
                Test
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef } from 'react'
import { useSettings } from './useSettings'
import { showToast } from '@/lib/toast'

type NotificationPermission = 'default' | 'granted' | 'denied'

interface NotificationOptions {
  title: string
  body: string
  tag?: string
  requireInteraction?: boolean
  onClick?: () => void
}

const NOTIFICATION_SOUND_URL = '/notification.mp3'

export function useNotifications() {
  const { preferences, updateSettings } = useSettings()
  const notificationConfig = preferences?.notifications
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && notificationConfig?.sound) {
      audioRef.current = new Audio(NOTIFICATION_SOUND_URL)
      audioRef.current.volume = 0.5
    }
  }, [notificationConfig?.sound])

  const getPermission = useCallback((): NotificationPermission => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied'
    }
    return Notification.permission as NotificationPermission
  }, [])

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      showToast.error('Notifications are not supported in this browser')
      return false
    }

    try {
      const permission = await Notification.requestPermission()
      const granted = permission === 'granted'
      
      if (granted) {
        await updateSettings({
          notifications: {
            ...notificationConfig,
            enabled: true,
            sessionComplete: true,
            permissionRequests: true,
            sound: false,
          },
        })
        showToast.success('Notifications enabled')
      } else if (permission === 'denied') {
        showToast.error('Notification permission denied. Enable in browser settings.')
      }
      
      return granted
    } catch (error) {
      console.error('Failed to request notification permission:', error)
      showToast.error('Failed to request notification permission')
      return false
    }
  }, [notificationConfig, updateSettings])

  const playSound = useCallback(() => {
    if (audioRef.current && notificationConfig?.sound) {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => {})
    }
  }, [notificationConfig?.sound])

  const sendNotification = useCallback(
    (options: NotificationOptions) => {
      if (!notificationConfig?.enabled) return

      const isPageHidden = typeof document !== 'undefined' && document.hidden
      const isPageBlurred = typeof document !== 'undefined' && !document.hasFocus()

      if (!isPageHidden && !isPageBlurred) {
        showToast.info(options.title, {
          description: options.body,
          action: options.onClick ? { label: 'View', onClick: options.onClick } : undefined,
        })
        return
      }

      if (getPermission() !== 'granted') {
        showToast.info(options.title, {
          description: options.body,
          action: options.onClick ? { label: 'View', onClick: options.onClick } : undefined,
        })
        return
      }

      try {
        const notification = new Notification(options.title, {
          body: options.body,
          tag: options.tag,
          icon: '/favicon.svg',
          requireInteraction: options.requireInteraction ?? false,
        })

        if (options.onClick) {
          notification.onclick = () => {
            window.focus()
            options.onClick?.()
            notification.close()
          }
        }

        playSound()
      } catch (error) {
        console.error('Failed to send notification:', error)
        showToast.info(options.title, {
          description: options.body,
        })
      }
    },
    [notificationConfig?.enabled, getPermission, playSound]
  )

  const notifySessionComplete = useCallback(
    (sessionId: string, repoId?: string, sessionTitle?: string) => {
      if (!notificationConfig?.enabled || !notificationConfig?.sessionComplete) return

      sendNotification({
        title: 'Session Complete',
        body: sessionTitle ? `"${sessionTitle}" has finished` : 'Your session has finished processing',
        tag: `session-complete-${sessionId}`,
        onClick: repoId ? () => {
          window.location.href = `/repos/${encodeURIComponent(repoId)}/sessions/${sessionId}`
        } : undefined,
      })
    },
    [notificationConfig?.enabled, notificationConfig?.sessionComplete, sendNotification]
  )

  const notifyPermissionRequest = useCallback(
    (sessionId: string, repoId?: string, toolName?: string) => {
      if (!notificationConfig?.enabled || !notificationConfig?.permissionRequests) return

      sendNotification({
        title: 'Permission Required',
        body: `${toolName || 'A tool'} requires your approval`,
        tag: `permission-${sessionId}`,
        requireInteraction: true,
        onClick: repoId ? () => {
          window.location.href = `/repos/${encodeURIComponent(repoId)}/sessions/${sessionId}`
        } : undefined,
      })
    },
    [notificationConfig?.enabled, notificationConfig?.permissionRequests, sendNotification]
  )

  return {
    isSupported: typeof window !== 'undefined' && 'Notification' in window,
    permission: getPermission(),
    isEnabled: notificationConfig?.enabled ?? false,
    config: notificationConfig,
    requestPermission,
    sendNotification,
    notifySessionComplete,
    notifyPermissionRequest,
  }
}

import { API_BASE_URL } from '@/config'

export async function getVapidPublicKey(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/push/vapid-public-key`)
  const data = await response.json()
  return data.publicKey
}

export async function subscribeToPush(subscription: PushSubscriptionJSON): Promise<void> {
  await fetch(`${API_BASE_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  })
}

export async function unsubscribeFromPush(endpoint: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
}

export async function testPushNotification(): Promise<{ success: boolean; message?: string }> {
  const response = await fetch(`${API_BASE_URL}/api/push/test`, {
    method: 'POST',
  })
  const data = await response.json()
  return { success: data.sent === true, message: data.message }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const outputArray = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Worker not supported')
    return null
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js')
    console.log('[SW] Service Worker registered:', registration.scope)
    return registration
  } catch (error) {
    console.error('[SW] Service Worker registration failed:', error)
    return null
  }
}

export async function subscribePushNotifications(): Promise<PushSubscription | null> {
  try {
    const registration = await registerServiceWorker()
    if (!registration) return null

    const vapidPublicKey = await getVapidPublicKey()
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)

    let subscription = await registration.pushManager.getSubscription()
    
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
      console.log('[Push] New subscription created')
    }

    await subscribeToPush(subscription.toJSON())
    console.log('[Push] Subscription saved to server')
    
    return subscription
  } catch (error) {
    console.error('[Push] Failed to subscribe:', error)
    return null
  }
}

export async function unsubscribePushNotifications(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    
    if (subscription) {
      await unsubscribeFromPush(subscription.endpoint)
      await subscription.unsubscribe()
      console.log('[Push] Unsubscribed from push notifications')
    }
  } catch (error) {
    console.error('[Push] Failed to unsubscribe:', error)
  }
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription !== null
  } catch {
    return false
  }
}

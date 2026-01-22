self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()
  const title = data.title || 'OpenCode Manager'
  const options = {
    body: data.body || 'Notification from OpenCode',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'opencode-notification',
    data: {
      url: data.url || '/',
      sessionId: data.sessionId,
      repoId: data.repoId,
    },
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data || {}
  let url = data.url || '/'

  if (data.repoId && data.sessionId) {
    url = `/repos/${data.repoId}/sessions/${data.sessionId}`
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url)
      }
    })
  )
})

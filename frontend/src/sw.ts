/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((name) => caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});

interface PushNotificationData {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    eventType: string;
    sessionId?: string;
    directory?: string;
  };
}

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: PushNotificationData;
  try {
    payload = event.data.json() as PushNotificationData;
  } catch {
    payload = {
      title: "OpenCode Manager",
      body: event.data.text(),
      data: { eventType: "unknown" },
    };
  }

  const options: NotificationOptions = {
    body: payload.body,
    icon: payload.icon ?? "/icons/icon-192x192.png",
    badge: payload.badge ?? "/icons/icon-192x192.png",
    tag: payload.tag,
    data: payload.data,
    requireInteraction: isHighPriority(payload.data?.eventType),
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data?.url as string) ?? "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin) {
            (client as WindowClient).focus();
            (client as WindowClient).navigate(url);
            return;
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

function isHighPriority(eventType?: string): boolean {
  return eventType === "permission.asked" || eventType === "question.asked";
}

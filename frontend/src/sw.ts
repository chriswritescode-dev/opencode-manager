/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

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

console.warn("[sw] Service worker loaded");

self.addEventListener("activate", (event) => {
  console.warn("[sw] Service worker activated");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("install", () => {
  console.warn("[sw] Service worker installed");
  self.skipWaiting();
});

self.addEventListener("push", (event: PushEvent) => {
  console.warn("[sw:push] Push event received", { hasData: !!event.data });

  if (!event.data) {
    console.warn("[sw:push] No data in push event, ignoring");
    return;
  }

  let payload: PushNotificationData;
  try {
    payload = event.data.json() as PushNotificationData;
    console.warn("[sw:push] Parsed payload", JSON.stringify(payload));
  } catch (parseError) {
    const rawText = event.data.text();
    console.warn("[sw:push] Failed to parse JSON, using raw text", rawText, parseError);
    payload = {
      title: "OpenCode Manager",
      body: rawText,
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

  console.warn("[sw:push] Showing notification", { title: payload.title, options: JSON.stringify(options) });

  const notificationPromise = self.registration
    .showNotification(payload.title, options)
    .then(() => {
      console.warn("[sw:push] showNotification resolved successfully");
    })
    .catch((err: unknown) => {
      console.error("[sw:push] showNotification FAILED", err);
    });

  event.waitUntil(notificationPromise);
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  console.warn("[sw:click] Notification clicked", event.notification.data);
  event.notification.close();

  const url = (event.notification.data?.url as string) ?? "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin) {
            client.focus();
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

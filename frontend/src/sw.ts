/// <reference lib="webworker" />

import type { PushNotificationPayload } from "@opencode-manager/shared/types";

const worker = self as unknown as ServiceWorkerGlobalScope & typeof globalThis;

interface SwBuildGlobals {
  __SW_BUILD_HASH__?: string;
  __SW_PRECACHE__?: string[];
}

const buildGlobals = worker as unknown as SwBuildGlobals;

const BUILD_HASH = buildGlobals.__SW_BUILD_HASH__ ?? "dev";
const PRECACHE_URLS = buildGlobals.__SW_PRECACHE__ ?? [];

const APP_SHELL_CACHE = `app-shell-${BUILD_HASH}`;
const RUNTIME_CACHE = `runtime-${BUILD_HASH}`;
const APP_SHELL_URL = "/index.html";
const MANAGED_CACHE_PREFIXES = ["app-shell-", "runtime-", "offline-assets-"];

worker.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
  worker.skipWaiting();
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (names) => {
      const stale = names.filter(
        (name) =>
          MANAGED_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
          name !== APP_SHELL_CACHE &&
          name !== RUNTIME_CACHE
      );
      const isUpdate = stale.length > 0;

      await Promise.all(stale.map((name) => caches.delete(name)));
      await worker.clients.claim();

      if (!isUpdate) return;

      const clients = await worker.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.postMessage({ type: "SW_UPDATED" });
      }
    })
  );
});

async function networkFirstShell(request: Request): Promise<Response> {
  const cache = await caches.open(APP_SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(APP_SHELL_URL, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(APP_SHELL_URL);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstAsset(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.status === 200) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }

  event.respondWith(cacheFirstAsset(request));
});

type ShowNotificationOptions = NotificationOptions & {
  renotify?: boolean;
  timestamp?: number;
};

worker.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: PushNotificationPayload;
  try {
    payload = event.data.json() as PushNotificationPayload;
  } catch {
    payload = {
      title: "OpenCode Manager",
      body: event.data.text(),
      data: { eventType: "unknown" },
    };
  }

  const options: ShowNotificationOptions = {
    body: payload.body,
    icon: payload.icon ?? "/icons/icon-512x512.png",
    badge: payload.badge ?? "/icons/badge-96x96.png",
    tag: payload.tag,
    renotify: Boolean(payload.tag && payload.renotify),
    ...(payload.timestamp !== undefined ? { timestamp: payload.timestamp } : {}),
    data: payload.data,
    requireInteraction: isHighPriority(payload.data?.eventType, payload.data?.priority),
  };

  event.waitUntil(worker.registration.showNotification(payload.title, options));
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = typeof event.notification.data?.url === "string" ? event.notification.data.url : "/";

  event.waitUntil(openOrFocusClient(url));
});

async function openOrFocusClient(url: string): Promise<void> {
  const clientList = await worker.clients.matchAll({ type: "window", includeUncontrolled: true });
  const clients = clientList.filter(
    (client) => new URL(client.url).origin === worker.location.origin
  ) as WindowClient[];
  const targetPathname = new URL(url, worker.location.origin).pathname;
  const target =
    clients.find((client) => new URL(client.url).pathname === targetPathname) ??
    clients.find((client) => client.focused) ??
    clients.find((client) => client.visibilityState === "visible") ??
    clients[0];

  if (!target) {
    await worker.clients.openWindow(url);
    return;
  }

  target.postMessage({ type: "NOTIFICATION_CLICK", url });
  await target.focus();
}

function isHighPriority(eventType?: string, priority?: 'normal' | 'high'): boolean {
  return eventType === "permission.asked" || eventType === "question.asked" || priority === 'high';
}

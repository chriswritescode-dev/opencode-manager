import "../sw?worker";

type UpdateCallback = () => void;

let updateCallback: UpdateCallback | null = null;
let updatePending = false;

function notifyUpdate() {
  if (!updateCallback) {
    updatePending = true;
    return;
  }
  updatePending = false;
  updateCallback();
}

export function onServiceWorkerUpdate(callback: UpdateCallback): void {
  updateCallback = callback;
  if (updatePending) {
    updatePending = false;
    callback();
  }
}

export function offServiceWorkerUpdate(): void {
  updateCallback = null;
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SW_UPDATED") {
      notifyUpdate();
    }
  });

  navigator.serviceWorker.ready.then((registration) => {
    if (registration.waiting) {
      notifyUpdate();
    }
  });

  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((registration) => {
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            notifyUpdate();
          }
        });
      });

      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);
    })
    .catch(() => {});
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  let rawData: string;
  try {
    rawData = window.atob(base64);
  } catch {
    throw new Error(`Invalid base64 string: ${base64String.slice(0, 20)}...`);
  }
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

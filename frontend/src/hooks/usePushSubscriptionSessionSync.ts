import { useEffect, useRef } from "react";
import { useSession } from "@/lib/auth-client";
import { sendRegisteredSubscription } from "@/hooks/useNotifications";

function hasNotificationPermission(): boolean {
  return "Notification" in window && Notification.permission === "granted";
}

export function usePushSubscriptionSessionSync(): void {
  const { data: authSession } = useSession();
  const sessionId = authSession?.session?.id ?? null;
  const syncedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || !hasNotificationPermission()) return;
    if (syncedSessionIdRef.current === sessionId) return;

    syncedSessionIdRef.current = sessionId;
    void sendRegisteredSubscription().catch(() => {});
  }, [sessionId]);
}

import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "@/api/notifications";
import { useSettings } from "@/hooks/useSettings";
import {
  getServiceWorkerRegistration,
  urlBase64ToUint8Array,
} from "@/lib/serviceWorker";
import type { NotificationPreferences } from "@/api/types/settings";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@opencode-manager/shared/schemas";

type PermissionState = NotificationPermission | "unsupported";

function getPermissionState(): PermissionState {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function useNotifications() {
  const queryClient = useQueryClient();
  const { preferences, updateSettings } = useSettings();
  const [permission, setPermission] = useState<PermissionState>(getPermissionState);

  const notificationPrefs: NotificationPreferences =
    preferences?.notifications ?? DEFAULT_NOTIFICATION_PREFERENCES;

  useEffect(() => {
    setPermission(getPermissionState());
  }, []);

  const { data: vapidData } = useQuery({
    queryKey: ["notifications", "vapid-public-key"],
    queryFn: notificationsApi.getVapidPublicKey,
    staleTime: Infinity,
    retry: false,
  });

  const { data: subscriptionsData, isLoading: isLoadingSubscriptions } =
    useQuery({
      queryKey: ["notifications", "subscriptions"],
      queryFn: () => notificationsApi.getSubscriptions(),
      enabled: notificationPrefs.enabled && permission === "granted",
    });

  const subscribeMutation = useMutation({
    mutationFn: async (deviceName?: string) => {
      const reg = await getServiceWorkerRegistration();
      if (!reg) throw new Error("Service worker not registered");
      if (!vapidData?.publicKey) throw new Error("VAPID key not available");

      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        const json = existingSub.toJSON();
        return notificationsApi.subscribe(json, deviceName);
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey).buffer as ArrayBuffer,
      });

      const json = subscription.toJSON();
      return notificationsApi.subscribe(json, deviceName);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["notifications", "subscriptions"],
      });
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      const reg = await getServiceWorkerRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await notificationsApi.unsubscribe(sub.endpoint);
          await sub.unsubscribe();
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["notifications", "subscriptions"],
      });
    },
  });

  const removeDeviceMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.removeSubscription(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["notifications", "subscriptions"],
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => notificationsApi.sendTest(),
  });

  const requestPermissionAndSubscribe = useCallback(async (): Promise<boolean> => {
    if (!("Notification" in window)) return false;

    const result = await Notification.requestPermission();
    setPermission(result);

    if (result !== "granted") return false;

    const reg = await getServiceWorkerRegistration();
    if (reg) {
      await subscribeMutation.mutateAsync(undefined);
    }
    return true;
  }, [subscribeMutation]);

  const enable = useCallback(async () => {
    const granted = await requestPermissionAndSubscribe();
    if (!granted) return;
    updateSettings({
      notifications: { ...notificationPrefs, enabled: true },
    });
  }, [requestPermissionAndSubscribe, updateSettings, notificationPrefs]);

  const disable = useCallback(async () => {
    await unsubscribeMutation.mutateAsync();
    updateSettings({
      notifications: { ...notificationPrefs, enabled: false },
    });
  }, [unsubscribeMutation, updateSettings, notificationPrefs]);

  const updateEventPreference = useCallback(
    (key: keyof NotificationPreferences["events"], value: boolean) => {
      updateSettings({
        notifications: {
          ...notificationPrefs,
          events: { ...notificationPrefs.events, [key]: value },
        },
      });
    },
    [updateSettings, notificationPrefs]
  );

  return {
    isSupported: "Notification" in window && "serviceWorker" in navigator,
    isAvailable: !!vapidData?.publicKey,
    permission,
    isEnabled: notificationPrefs.enabled,
    preferences: notificationPrefs,
    subscriptions: subscriptionsData?.subscriptions ?? [],
    isLoadingSubscriptions,
    enable,
    disable,
    updateEventPreference,
    removeDevice: removeDeviceMutation.mutate,
    sendTest: testMutation.mutate,
    isSubscribing: subscribeMutation.isPending,
    isTesting: testMutation.isPending,
  };
}

import type { PushSubscriptionRecord } from "@opencode-manager/shared/types";
import { API_BASE_URL } from "@/config";
import { fetchWrapper } from "./fetchWrapper";

export const notificationsApi = {
  getVapidPublicKey: async (): Promise<{ publicKey: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/notifications/vapid-public-key`);
  },

  subscribe: async (
    subscription: PushSubscriptionJSON,
    deviceName?: string,
    userId = 'default'
  ): Promise<{ subscription: PushSubscriptionRecord }> => {
    return fetchWrapper(`${API_BASE_URL}/api/notifications/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        deviceName,
      }),
      params: { userId },
    });
  },

  unsubscribe: async (endpoint: string, userId = 'default'): Promise<{ success: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/notifications/subscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
      params: { userId },
    });
  },

  getSubscriptions: async (userId = 'default'): Promise<{
    subscriptions: PushSubscriptionRecord[];
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/notifications/subscriptions`, {
      params: { userId },
    });
  },

  removeSubscription: async (
    id: number,
    userId = 'default'
  ): Promise<{ success: boolean }> => {
    return fetchWrapper(
      `${API_BASE_URL}/api/notifications/subscriptions/${id}`,
      { method: "DELETE", params: { userId } }
    );
  },

  sendTest: async (userId = 'default'): Promise<{
    success: boolean;
    devicesNotified: number;
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/notifications/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      params: { userId },
    });
  },
};

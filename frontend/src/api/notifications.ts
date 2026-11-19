import { z } from "zod";
import { API_BASE_URL } from "@/config";
import { PushSubscriptionRecordSchema } from "@opencode-manager/shared/schemas";
import type { PushSubscriptionRecord } from "@opencode-manager/shared/types";
import { fetchWrapper } from "./fetchWrapper";

const vapidPublicKeyResponseSchema = z.object({ publicKey: z.string() });
const subscriptionResponseSchema = z.object({ subscription: PushSubscriptionRecordSchema });
const successResponseSchema = z.object({ success: z.boolean() });
const subscriptionsResponseSchema = z.object({ subscriptions: z.array(PushSubscriptionRecordSchema) });
const testNotificationResponseSchema = z.object({ success: z.boolean(), devicesNotified: z.number() });

export const notificationsApi = {
  getVapidPublicKey: async (): Promise<{ publicKey: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/notifications/vapid-public-key`, vapidPublicKeyResponseSchema);
  },

  subscribe: async (
    subscription: PushSubscriptionJSON,
    deviceName?: string,
    userId = 'default'
  ): Promise<{ subscription: PushSubscriptionRecord }> => {
    return fetchWrapper(`${API_BASE_URL}/api/notifications/subscribe`, subscriptionResponseSchema, {
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
    return fetchWrapper(`${API_BASE_URL}/api/notifications/subscribe`, successResponseSchema, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
      params: { userId },
    });
  },

  getSubscriptions: async (userId = 'default'): Promise<{
    subscriptions: PushSubscriptionRecord[];
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/notifications/subscriptions`, subscriptionsResponseSchema, {
      params: { userId },
    });
  },

  removeSubscription: async (
    id: number,
    userId = 'default'
  ): Promise<{ success: boolean }> => {
    return fetchWrapper(
      `${API_BASE_URL}/api/notifications/subscriptions/${id}`,
      successResponseSchema,
      { method: "DELETE", params: { userId } }
    );
  },

  sendTest: async (userId = 'default'): Promise<{
    success: boolean;
    devicesNotified: number;
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/notifications/test`, testNotificationResponseSchema, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      params: { userId },
    });
  },
};

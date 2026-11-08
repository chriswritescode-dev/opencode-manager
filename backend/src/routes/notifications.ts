import { Hono } from "hono";
import { z } from "zod";
import {
  ExpoPushTokenDeleteRequestSchema,
  ExpoPushTokenRequestSchema,
  PushSubscriptionRequestSchema,
} from "@opencode-manager/shared/schemas";
import type { NotificationService } from "../services/notification";
import type { Session } from "../auth";

interface NotificationRouteVariables {
  session?: Session['session'];
}

export function createNotificationRoutes(
  notificationService: NotificationService
) {
  const app = new Hono<{ Variables: NotificationRouteVariables }>();

  app.get("/vapid-public-key", (c) => {
    const publicKey = notificationService.getVapidPublicKey();
    if (!publicKey) {
      return c.json(
        { error: "Push notifications are not configured" },
        503
      );
    }
    return c.json({ publicKey });
  });

  app.post("/subscribe", async (c) => {
    const userId = c.req.query('userId') || 'default'
    const sessionId = c.get('session')?.id
    const body = await c.req.json();
    const parsed = PushSubscriptionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid subscription data", details: parsed.error.issues }, 400);
    }

    const { endpoint, keys, deviceName } = parsed.data;

    const subscription = notificationService.saveSubscription(
      userId,
      endpoint,
      keys.p256dh,
      keys.auth,
      deviceName,
      sessionId
    );

    if (!subscription) {
      return c.json({ error: "Session is no longer valid" }, 401);
    }

    return c.json({ subscription });
  });

  app.delete("/subscribe", async (c) => {
    const userId = c.req.query('userId') || 'default'
    const body = await c.req.json();
    const parsed = z.object({ endpoint: z.string().url() }).safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Valid endpoint URL is required", details: parsed.error.issues }, 400);
    }

    const removed = notificationService.removeSubscription(parsed.data.endpoint, userId);
    return c.json({ success: removed });
  });

  /**
   * Registers an Expo push token for the mobile app.
   *
   * Body: `{ token: string, deviceName?: string }`.
   * Responds `200 { token: record }` when the token is registered, `400 { error, details }` when the
   * body or token is invalid, and `401 { error }` when the registering session was revoked.
   */
  app.post("/expo-tokens", async (c) => {
    const userId = c.req.query('userId') || 'default'
    const sessionId = c.get('session')?.id
    const parsed = ExpoPushTokenRequestSchema.safeParse(await c.req.json().catch(() => undefined))

    if (!parsed.success) {
      return c.json({ error: "Invalid Expo push token", details: parsed.error.issues }, 400);
    }

    const record = notificationService.saveExpoToken(
      userId,
      parsed.data.token,
      parsed.data.deviceName,
      sessionId
    )

    if (!record) {
      return c.json({ error: "Session is no longer valid" }, 401);
    }

    return c.json({ token: record });
  })

  app.delete("/expo-tokens", async (c) => {
    const userId = c.req.query('userId') || 'default'
    const parsed = ExpoPushTokenDeleteRequestSchema.safeParse(await c.req.json().catch(() => undefined))

    if (!parsed.success) {
      return c.json({ error: "Expo push token is required", details: parsed.error.issues }, 400);
    }

    return c.json({ success: notificationService.removeExpoToken(parsed.data.token, userId) });
  })

  app.get("/subscriptions", (c) => {
    const userId = c.req.query('userId') || 'default'
    const subscriptions = notificationService.getSubscriptions(userId);
    return c.json({ subscriptions });
  });

  app.delete("/subscriptions/:id", (c) => {
    const userId = c.req.query('userId') || 'default'
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "Invalid subscription ID" }, 400);
    }

    const removed = notificationService.removeSubscriptionById(id, userId);
    return c.json({ success: removed });
  });

  app.post("/test", async (c) => {
    const userId = c.req.query('userId') || 'default'
    const devices = notificationService.countReachableDevices(userId);

    if (notificationService.getSubscriptions(userId).length === 0 && devices.expo === 0) {
      return c.json(
        { error: "No push subscriptions registered" },
        404
      );
    }

    if (devices.webPush + devices.expo === 0) {
      return c.json(
        { error: "Push notifications are not configured" },
        503
      );
    }

    const stats = await notificationService.sendTestNotification(userId);

    return c.json({ success: true, devicesNotified: stats.total, delivered: stats.delivered });
  });

  return app;
}

import { Hono } from "hono";
import { z } from "zod";
import { PushSubscriptionRequestSchema } from "@opencode-manager/shared/schemas";
import type { NotificationService } from "../services/notification";

export function createNotificationRoutes(
  notificationService: NotificationService
) {
  const app = new Hono();

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
      deviceName
    );

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

    if (!notificationService.isConfigured()) {
      return c.json(
        { error: "Push notifications are not configured" },
        503
      );
    }

    const subscriptions = notificationService.getSubscriptions(userId);
    if (subscriptions.length === 0) {
      return c.json(
        { error: "No push subscriptions registered" },
        404
      );
    }

    await notificationService.sendTestNotification(userId);

    return c.json({ success: true, devicesNotified: subscriptions.length });
  });

  return app;
}

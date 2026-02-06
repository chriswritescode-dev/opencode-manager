import { Database } from "bun:sqlite";
import webpush from "web-push";
import { logger } from "../utils/logger";
import type { PushSubscriptionRecord } from "../types/settings";
import type { PushNotificationPayload } from "@opencode-manager/shared/types";
import {
  NotificationEventType,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "@opencode-manager/shared/schemas";
import { SettingsService } from "./settings";
import { sseAggregator, type SSEEvent } from "./sse-aggregator";

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const EVENT_CONFIG: Record<
  string,
  { preferencesKey: keyof typeof DEFAULT_NOTIFICATION_PREFERENCES.events; title: string; bodyFn: (props: Record<string, unknown>) => string }
> = {
  [NotificationEventType.PERMISSION_ASKED]: {
    preferencesKey: "permissionAsked",
    title: "Permission Required",
    bodyFn: () => "OpenCode needs your approval to continue",
  },
  [NotificationEventType.QUESTION_ASKED]: {
    preferencesKey: "questionAsked",
    title: "Question from Agent",
    bodyFn: () => "The agent has a question for you",
  },
  [NotificationEventType.SESSION_ERROR]: {
    preferencesKey: "sessionError",
    title: "Session Error",
    bodyFn: (props) => {
      const error = props.error as { message?: string } | undefined;
      return error?.message ?? "A session encountered an error";
    },
  },
  [NotificationEventType.SESSION_IDLE]: {
    preferencesKey: "sessionIdle",
    title: "Session Complete",
    bodyFn: () => "Your session has finished processing",
  },
};

export class NotificationService {
  private vapidConfig: VapidConfig | null = null;
  private settingsService: SettingsService;

  constructor(private db: Database) {
    this.settingsService = new SettingsService(db);
    this.initializePushSubscriptionsTable();
  }

  private initializePushSubscriptionsTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        device_name TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id)"
    );
    this.db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sub_endpoint ON push_subscriptions(endpoint)"
    );
  }

  configureVapid(config: VapidConfig): void {
    this.vapidConfig = config;
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    logger.info("VAPID credentials configured for push notifications");
  }

  getVapidPublicKey(): string | null {
    return this.vapidConfig?.publicKey ?? null;
  }

  isConfigured(): boolean {
    return this.vapidConfig !== null;
  }

  saveSubscription(
    userId: string,
    endpoint: string,
    p256dh: string,
    auth: string,
    deviceName?: string
  ): PushSubscriptionRecord {
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           device_name = excluded.device_name,
           last_used_at = excluded.last_used_at`
      )
      .run(userId, endpoint, p256dh, auth, deviceName ?? null, now, now);

    const row = this.db
      .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .get(endpoint) as {
      id: number;
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      device_name: string | null;
      created_at: number;
      last_used_at: number | null;
    };

    logger.info(`Saved push subscription for user ${userId}`);

    return {
      id: row.id,
      userId: row.user_id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      deviceName: row.device_name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    };
  }

  removeSubscription(endpoint: string, userId?: string): boolean {
    if (userId) {
      const result = this.db
        .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
        .run(endpoint, userId);
      return result.changes > 0;
    }
    const result = this.db
      .prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
      .run(endpoint);
    return result.changes > 0;
  }

  removeSubscriptionById(id: number, userId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?")
      .run(id, userId);
    return result.changes > 0;
  }

  getSubscriptions(userId: string): PushSubscriptionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as Array<{
      id: number;
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      device_name: string | null;
      created_at: number;
      last_used_at: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      deviceName: row.device_name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  getAllUserIds(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT user_id FROM push_subscriptions")
      .all() as Array<{ user_id: string }>;
    return rows.map((r) => r.user_id);
  }

  private hasActiveSSEClients(): boolean {
    return sseAggregator.hasVisibleClients();
  }

  async handleSSEEvent(
    _directory: string,
    event: SSEEvent
  ): Promise<void> {
    const config = EVENT_CONFIG[event.type];
    if (!config) return;

    if (this.hasActiveSSEClients()) return;

    if (!this.isConfigured()) return;

    const userIds = this.getAllUserIds();

    for (const userId of userIds) {
      const settings = this.settingsService.getSettings(userId);
      const notifPrefs =
        settings.preferences.notifications ?? DEFAULT_NOTIFICATION_PREFERENCES;

      if (!notifPrefs.enabled) continue;
      if (!notifPrefs.events[config.preferencesKey]) continue;

      const sessionId = event.properties.sessionID as string | undefined;

      const payload: PushNotificationPayload = {
        title: config.title,
        body: config.bodyFn(event.properties),
        tag: `${event.type}-${sessionId ?? "global"}`,
        data: {
          eventType: event.type,
          sessionId,
          directory: _directory,
          url: sessionId ? `/repos/${encodeURIComponent(_directory)}/sessions/${sessionId}` : "/",
        },
      };

      await this.sendToUser(userId, payload);
    }
  }

  async sendTestNotification(userId: string): Promise<void> {
    await this.sendToUser(userId, {
      title: "Test Notification",
      body: "Push notifications are working correctly",
      tag: "test",
      data: { eventType: "test", url: "/" },
    });
  }

  private async sendToUser(
    userId: string,
    payload: PushNotificationPayload
  ): Promise<void> {
    const subscriptions = this.getSubscriptions(userId);

    const expiredEndpoints: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload)
          );

          this.db
            .prepare(
              "UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?"
            )
            .run(Date.now(), sub.id);
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            expiredEndpoints.push(sub.endpoint);
          } else {
            logger.error(
              `Failed to send push to ${sub.endpoint.slice(0, 50)}...:`,
              error
            );
          }
        }
      })
    );

    for (const endpoint of expiredEndpoints) {
      this.removeSubscription(endpoint);
      logger.info(`Removed expired push subscription: ${endpoint.slice(0, 50)}...`);
    }
  }
}

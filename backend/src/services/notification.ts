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
import { getRepoByLocalPath } from "../db/queries";
import { getReposPath } from "@opencode-manager/shared/config/env";
import path from "path";

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
    logger.info(`VAPID configured — subject="${config.subject}" publicKeyLength=${config.publicKey.length} privateKeyLength=${config.privateKey.length}`);
  }

  getVapidPublicKey(): string | null {
    return this.vapidConfig?.publicKey ?? null;
  }

  getVapidDetails(): { publicKey: string; privateKeyLength: number; subject: string } | null {
    if (!this.vapidConfig) return null;
    return {
      publicKey: this.vapidConfig.publicKey,
      privateKeyLength: this.vapidConfig.privateKey.length,
      subject: this.vapidConfig.subject,
    };
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
    if (!config) {
      logger.debug(`[push] Ignoring SSE event type="${event.type}" (no notification config)`);
      return;
    }

    logger.info(`[push] Processing SSE event type="${event.type}" for directory="${_directory}"`);

    if (this.hasActiveSSEClients()) {
      logger.info(`[push] Skipping push — active visible SSE clients detected`);
      return;
    }

    if (!this.isConfigured()) {
      logger.warn(`[push] Skipping push — VAPID not configured`);
      return;
    }

    const userIds = this.getAllUserIds();
    logger.info(`[push] Found ${userIds.length} user(s) with push subscriptions`);

    for (const userId of userIds) {
      const settings = this.settingsService.getSettings(userId);
      const notifPrefs =
        settings.preferences.notifications ?? DEFAULT_NOTIFICATION_PREFERENCES;

      if (!notifPrefs.enabled) {
        logger.info(`[push] Skipping user="${userId}" — notifications disabled`);
        continue;
      }
      if (!notifPrefs.events[config.preferencesKey]) {
        logger.info(`[push] Skipping user="${userId}" — event "${config.preferencesKey}" disabled`);
        continue;
      }

      const sessionId = event.properties.sessionID as string | undefined;

      let notificationUrl = "/";
      if (sessionId && _directory) {
        const reposBasePath = getReposPath();
        const localPath = path.relative(reposBasePath, _directory);
        const repo = getRepoByLocalPath(this.db, localPath);
        
        if (repo) {
          notificationUrl = `/repos/${repo.id}/sessions/${sessionId}`;
        }
      }

      const payload: PushNotificationPayload = {
        title: config.title,
        body: config.bodyFn(event.properties),
        tag: `${event.type}-${sessionId ?? "global"}`,
        data: {
          eventType: event.type,
          sessionId,
          directory: _directory,
          url: notificationUrl,
        },
      };

      logger.info(`[push] Sending push to user="${userId}" title="${payload.title}"`);
      await this.sendToUser(userId, payload);
    }
  }

  async sendTestNotification(userId: string): Promise<{ sent: number; failed: number; results: Array<{ endpoint: string; status: string; statusCode?: number; error?: string }> }> {
    const subscriptions = this.getSubscriptions(userId);
    logger.info(`[push:test] Sending test notification to user="${userId}" (${subscriptions.length} subscription(s))`);
    for (const sub of subscriptions) {
      logger.info(`[push:test] Subscription endpoint: ${sub.endpoint}`);
    }
    const results = await this.sendToUserWithResults(userId, {
      title: "Test Notification",
      body: "Push notifications are working correctly",
      tag: "test",
      data: { eventType: "test", url: "/" },
    });
    logger.info(`[push:test] Results: ${JSON.stringify(results)}`);
    return results;
  }

  private async sendToUser(
    userId: string,
    payload: PushNotificationPayload
  ): Promise<void> {
    await this.sendToUserWithResults(userId, payload);
  }

  private async sendToUserWithResults(
    userId: string,
    payload: PushNotificationPayload
  ): Promise<{ sent: number; failed: number; results: Array<{ endpoint: string; status: string; statusCode?: number; error?: string }> }> {
    const subscriptions = this.getSubscriptions(userId);
    const expiredEndpoints: string[] = [];
    const results: Array<{ endpoint: string; status: string; statusCode?: number; error?: string }> = [];

    logger.info(`[push] Delivering to ${subscriptions.length} subscription(s) for user="${userId}"`);

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const endpointPreview = sub.endpoint.slice(0, 80);
        try {
          const response = await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload)
          );

          logger.info(`[push] Success for ${endpointPreview}... — statusCode=${response.statusCode} headers=${JSON.stringify(response.headers)}`);
          results.push({ endpoint: endpointPreview, status: "success", statusCode: response.statusCode });

          this.db
            .prepare(
              "UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?"
            )
            .run(Date.now(), sub.id);
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          const body = (error as { body?: string }).body;
          const message = (error as Error).message;

          logger.error(`[push] Failed for ${endpointPreview}... — statusCode=${statusCode} body="${body}" message="${message}"`);
          results.push({ endpoint: endpointPreview, status: "failed", statusCode, error: body ?? message });

          if (statusCode === 404 || statusCode === 410) {
            expiredEndpoints.push(sub.endpoint);
          }
        }
      })
    );

    for (const endpoint of expiredEndpoints) {
      this.removeSubscription(endpoint);
      logger.info(`[push] Removed expired push subscription: ${endpoint.slice(0, 50)}...`);
    }

    const sent = results.filter(r => r.status === "success").length;
    const failed = results.filter(r => r.status === "failed").length;
    return { sent, failed, results };
  }
}

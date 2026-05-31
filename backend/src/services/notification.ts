import { Database } from "bun:sqlite";
import webpush from "web-push";
import { logger } from "../utils/logger";
import type { PushSubscriptionRecord } from "../types/settings";
import type { PushNotificationPayload } from "@opencode-manager/shared/types";
import {
  NotificationEventType,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "@opencode-manager/shared/schemas";
import {
  getPermissionLabel,
  getPermissionDetail,
  getQuestionText,
} from "@opencode-manager/shared/notifications";
import { SettingsService } from "./settings";
import { sseAggregator, type SSEEvent } from "./sse-aggregator";
import { getRepoByLocalPath, getRepoBySourcePath } from "../db/queries";
import { getReposPath } from "@opencode-manager/shared/config/env";
import path from "path";

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const EVENT_CONFIG: Record<
  string,
  {
    preferencesKey: keyof typeof DEFAULT_NOTIFICATION_PREFERENCES.events;
    titleFn: (props: Record<string, unknown>) => string;
    bodyFn: (props: Record<string, unknown>) => string;
  }
> = {
  [NotificationEventType.PERMISSION_ASKED]: {
    preferencesKey: "permissionAsked",
    titleFn: (props) =>
      getPermissionLabel(
        typeof props.permission === "string" ? props.permission : ""
      ),
    bodyFn: (props) => getPermissionDetail(props).primary || "Approval required",
  },
  [NotificationEventType.QUESTION_ASKED]: {
    preferencesKey: "questionAsked",
    titleFn: () => "Question",
    bodyFn: (props) => getQuestionText(props) || "A question needs your answer",
  },
  [NotificationEventType.SESSION_ERROR]: {
    preferencesKey: "sessionError",
    titleFn: () => "Error",
    bodyFn: (props) => {
      const error = props.error as { message?: string } | undefined;
      return error?.message ?? "A session encountered an error";
    },
  },
  [NotificationEventType.SESSION_IDLE]: {
    preferencesKey: "sessionIdle",
    titleFn: () => "Session complete",
    bodyFn: () => "Your session has finished processing",
  },
};

const MAX_BODY_LENGTH = 140;

export function buildEventNotificationPayload(
  event: SSEEvent,
  context: {
    repoName?: string;
    repoId?: number;
    sessionId?: string;
    directory?: string;
    url: string;
  }
): PushNotificationPayload | null {
  const config = EVENT_CONFIG[event.type];
  if (!config) return null;

  const action = config.titleFn(event.properties);
  const title = context.repoName
    ? `${context.repoName}: ${action}`
    : action;

  const rawBody = config.bodyFn(event.properties);
  const body =
    rawBody.length > MAX_BODY_LENGTH
      ? `${rawBody.slice(0, MAX_BODY_LENGTH - 1)}…`
      : rawBody;

  return {
    title,
    body,
    tag: `${event.type}-${context.sessionId ?? "global"}`,
    data: {
      eventType: event.type,
      sessionId: context.sessionId,
      directory: context.directory,
      repoId: context.repoId,
      repoName: context.repoName,
      url: context.url,
    },
  };
}

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

  async handleSSEEvent(
    _directory: string,
    event: SSEEvent
  ): Promise<void> {
    const config = EVENT_CONFIG[event.type];
    if (!config) return;

    const sessionId = event.properties.sessionID as string | undefined;
    if (sessionId && sseAggregator.isSessionBeingViewed(sessionId)) return;
    if (sessionId && sseAggregator.isSubagentSession(sessionId)) return;

    if (!this.isConfigured()) return;

    const userIds = this.getAllUserIds();
    if (userIds.length === 0) return;

    let notificationUrl = "/";
    let repoName = "";
    let repoId: number | undefined;

    if (_directory) {
      const reposBasePath = getReposPath();
      const localPath = path.relative(reposBasePath, _directory);
      const repo = getRepoBySourcePath(this.db, path.resolve(_directory)) ?? getRepoByLocalPath(this.db, localPath);

      if (repo) {
        repoId = repo.id;
        repoName = path.basename(repo.localPath);
        notificationUrl = sessionId
          ? `/repos/${repo.id}/sessions/${sessionId}`
          : `/repos/${repo.id}`;
      }
    }

    const payload = buildEventNotificationPayload(event, {
      repoName: repoName || undefined,
      repoId,
      sessionId,
      directory: _directory,
      url: notificationUrl,
    });
    if (!payload) return;

    for (const userId of userIds) {
      const settings = this.settingsService.getSettings(userId);
      const notifPrefs =
        settings.preferences.notifications ?? DEFAULT_NOTIFICATION_PREFERENCES;

      if (!notifPrefs.enabled) continue;
      if (!notifPrefs.events[config.preferencesKey]) continue;

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

  async sendToUser(
    userId: string,
    payload: PushNotificationPayload
  ): Promise<{ delivered: number; expired: number; failed: number; total: number }> {
    const subscriptions = this.getSubscriptions(userId);
    const expiredEndpoints: string[] = [];
    let delivered = 0
    let failed = 0

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
          
          delivered++
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;

          if (statusCode === 404 || statusCode === 410) {
            expiredEndpoints.push(sub.endpoint);
          } else {
            logger.error(`Push delivery failed for ${sub.endpoint.slice(0, 50)}:`, error);
            failed++
          }
        }
      })
    );

    for (const endpoint of expiredEndpoints) {
      this.removeSubscription(endpoint);
    }

    return {
      delivered,
      expired: expiredEndpoints.length,
      failed,
      total: subscriptions.length,
    }
  }
}

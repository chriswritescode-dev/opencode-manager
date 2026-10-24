import { Database } from "bun:sqlite";
import webpush from "web-push";
import { logger } from "../utils/logger";
import type { PushSubscriptionRecord } from "../types/settings";
import type {
  NotificationPreferences,
  PushNotificationPayload,
} from "@opencode-manager/shared/types";
import {
  NotificationEventType,
  DEFAULT_NOTIFICATION_PREFERENCES,
  LOCAL_OPENCODE_SERVER_ID,
  type OpenCodeServer,
  type SessionGoal,
} from "@opencode-manager/shared/schemas";
import {
  getPermissionLabel,
  getPermissionDetail,
  getFormText,
  getGoalOutcomeTitle,
  getGoalOutcomeReason,
} from "@opencode-manager/shared/notifications";
import { SettingsService } from "./settings";
import { sseAggregator, type SSEEvent } from "./sse-aggregator";
import { getRepoName } from "../db/queries";
import { getScheduleRunBySessionId } from "../db/schedules";
import { ensurePushSubscriptionsTable } from "../db/push-subscriptions";
import type { Repo } from "../types/repo";
import { buildServerSessionPath, buildSessionPath } from "@opencode-manager/shared/utils";
import { sessionIDFromEvent } from "@opencode-manager/shared/opencode";
import { resolveRepoForDirectory } from "./repo";

export interface NotificationServerRegistry {
  get(serverId: string): Pick<OpenCodeServer, "name" | "enabled"> | null;
}

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const EVENT_CONFIG: Record<
  string,
  {
    preferencesKey: keyof typeof DEFAULT_NOTIFICATION_PREFERENCES.events;
    titleFn: (data: Record<string, unknown>) => string;
    bodyFn: (data: Record<string, unknown>) => string;
  }
> = {
  [NotificationEventType.PERMISSION_ASKED]: {
    preferencesKey: "permissionAsked",
    titleFn: (data) =>
      getPermissionLabel(
        typeof data.action === "string" ? data.action : ""
      ),
    bodyFn: (data) => getPermissionDetail(data).primary || "Approval required",
  },
  [NotificationEventType.FORM_CREATED]: {
    preferencesKey: "questionAsked",
    titleFn: () => "Question",
    bodyFn: (data) => getFormText(data.form as { title?: unknown }) || "A question needs your answer",
  },
  [NotificationEventType.SESSION_FAILED]: {
    preferencesKey: "sessionError",
    titleFn: () => "Error",
    bodyFn: (data) => {
      const error = data.error as { message?: string } | undefined;
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

const RUN_OUTCOME_EVENTS = new Set<string>([
  NotificationEventType.SESSION_IDLE,
  NotificationEventType.SESSION_FAILED,
]);

function truncateWithEllipsis(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength === 1) return "…";
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildGoalOutcomeBody(goal: SessionGoal, repoName: string | undefined): string {
  const reason = getGoalOutcomeReason(goal)?.trim() || undefined;
  const prefix = repoName ? `${repoName} · ` : "";
  const separator = " — ";

  const reasonBudget = Math.max(0, MAX_BODY_LENGTH - prefix.length - separator.length);
  const boundedReason = reason ? truncateWithEllipsis(reason, reasonBudget) : "";
  const suffix = boundedReason ? `${separator}${boundedReason}` : "";

  const objectiveBudget = Math.max(0, MAX_BODY_LENGTH - prefix.length - suffix.length);
  const objective = truncateWithEllipsis(goal.objective, objectiveBudget);

  return truncateWithEllipsis(`${prefix}${objective}${suffix}`, MAX_BODY_LENGTH);
}

function resolveEventSessionId(event: SSEEvent): string | undefined {
  if (event.type === NotificationEventType.FORM_CREATED) {
    return event.data.form.sessionID;
  }
  return sessionIDFromEvent(event);
}

export function buildScheduleRunReportUrl(runId: number): string {
  return `/schedules?scheduleTab=runs&runId=${runId}`;
}

export function buildNotificationUrl(
  repo: Pick<Repo, "id"> | null,
  sessionId: string | undefined
): string {
  if (!repo) return "/";
  if (!sessionId) return `/repos/${repo.id}`;
  return buildSessionPath(repo.id, sessionId);
}

export function buildEventNotificationPayload(
  event: Pick<SSEEvent, "type" | "data">,
  context: {
    repoName?: string;
    repoId?: number;
    serverId?: string;
    serverName?: string;
    sessionId?: string;
    directory?: string;
    url: string;
  }
): PushNotificationPayload | null {
  const config = EVENT_CONFIG[event.type];
  if (!config) return null;

  const title = config.titleFn(event.data);

  const detail = config.bodyFn(event.data);
  const displayName = context.repoName ?? context.serverName;
  const rawBody = displayName
    ? `${displayName} · ${detail}`
    : detail;
  const body = truncateWithEllipsis(rawBody, MAX_BODY_LENGTH);

  return {
    title,
    body,
    tag: `${event.type}-${context.sessionId ?? "global"}`,
    timestamp: Date.now(),
    renotify: true,
    data: {
      eventType: event.type,
      sessionId: context.sessionId,
      directory: context.directory,
      repoId: context.repoId,
      repoName: context.repoName,
      serverId: context.serverId,
      serverName: context.serverName,
      url: context.url,
    },
  };
}

type EventSuppressor = (
  event: SSEEvent,
  sessionId: string | undefined,
  serverId: string
) => Promise<boolean>;

export class NotificationService {
  private vapidConfig: VapidConfig | null = null;
  private settingsService: SettingsService;
  private eventSuppressors: EventSuppressor[] = [];

  constructor(
    private db: Database,
    private serverRegistry: NotificationServerRegistry | null = null
  ) {
    this.settingsService = new SettingsService(db);
    ensurePushSubscriptionsTable(db);
  }

  configureVapid(config: VapidConfig): void {
    this.vapidConfig = config;
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  }

  getVapidPublicKey(): string | null {
    return this.vapidConfig?.publicKey ?? null;
  }

  addEventSuppressor(suppressor: EventSuppressor): void {
    this.eventSuppressors.push(suppressor);
  }

  isConfigured(): boolean {
    return this.vapidConfig !== null;
  }

  saveSubscription(
    userId: string,
    endpoint: string,
    p256dh: string,
    auth: string,
    deviceName?: string,
    sessionId?: string | null
  ): PushSubscriptionRecord {
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, session_id, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           device_name = COALESCE(excluded.device_name, push_subscriptions.device_name),
           session_id = excluded.session_id,
           last_used_at = excluded.last_used_at`
      )
      .run(userId, endpoint, p256dh, auth, deviceName ?? null, sessionId ?? null, now, now);

    const row = this.db
      .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .get(endpoint) as {
      id: number;
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      device_name: string | null;
      session_id: string | null;
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

  /** Returns the run report URL when the session was started by a scheduled run. */
  getScheduleRunReportUrl(sessionId: string | undefined): string | null {
    if (!sessionId) return null;
    const run = getScheduleRunBySessionId(this.db, sessionId);
    return run ? buildScheduleRunReportUrl(run.id) : null;
  }

  private async deliverToSubscribers(
    payload: PushNotificationPayload,
    shouldNotify: (preferences: NotificationPreferences) => boolean
  ): Promise<void> {
    if (!this.isConfigured()) return;

    const userIds = this.getAllUserIds();
    if (userIds.length === 0) return;

    for (const userId of userIds) {
      const settings = this.settingsService.getSettings(userId);
      const notifPrefs =
        settings.preferences.notifications ?? DEFAULT_NOTIFICATION_PREFERENCES;

      if (!shouldNotify(notifPrefs)) continue;

      await this.sendToUser(userId, payload);
    }
  }

  async handleSSEEvent(
    directory: string | null,
    event: SSEEvent,
    serverId: string = LOCAL_OPENCODE_SERVER_ID
  ): Promise<void> {
    const config = EVENT_CONFIG[event.type];
    if (!config) return;

    const sessionId = resolveEventSessionId(event);
    if (sessionId && sseAggregator.isSessionBeingViewed(sessionId, serverId)) return;
    if (sessionId && sseAggregator.isSubagentSession(sessionId, serverId)) return;

    for (const suppressor of this.eventSuppressors) {
      if (await suppressor(event, sessionId, serverId)) return;
    }

    if (serverId !== LOCAL_OPENCODE_SERVER_ID) {
      await this.deliverRemoteEvent(
        serverId,
        directory,
        event,
        sessionId,
        config.preferencesKey
      );
      return;
    }

    const repo = directory ? await resolveRepoForDirectory(this.db, directory) : null;
    const repoId = repo?.id;
    const repoName = repo ? getRepoName(repo) : undefined;
    const reportUrl = RUN_OUTCOME_EVENTS.has(event.type) ? this.getScheduleRunReportUrl(sessionId) : null;
    const url = reportUrl ?? buildNotificationUrl(repo, sessionId);

    const payload = buildEventNotificationPayload(event, {
      repoName,
      repoId,
      sessionId,
      directory: directory ?? undefined,
      url,
    });
    if (!payload) return;

    await this.deliverToSubscribers(
      payload,
      (preferences) =>
        preferences.enabled &&
        preferences.events[config.preferencesKey] === true
    );
  }

  private async deliverRemoteEvent(
    serverId: string,
    directory: string | null,
    event: SSEEvent,
    sessionId: string | undefined,
    preferencesKey: keyof typeof DEFAULT_NOTIFICATION_PREFERENCES.events
  ): Promise<void> {
    const server = this.serverRegistry?.get(serverId) ?? null;
    if (!server || !server.enabled) return;

    const url = sessionId
      ? buildServerSessionPath(serverId, sessionId)
      : `/servers/${encodeURIComponent(serverId)}`;

    const payload = buildEventNotificationPayload(event, {
      serverId,
      serverName: server.name,
      sessionId,
      directory: directory ?? undefined,
      url,
    });
    if (!payload) return;

    await this.deliverToSubscribers(
      payload,
      (preferences) =>
        preferences.enabled &&
        preferences.events[preferencesKey] === true
    );
  }

  async notifyGoalOutcome(goal: SessionGoal): Promise<void> {
    if (goal.stopReason === "turn_error") return;
    if (goal.stopReason === "cancelled" || goal.stopReason === "user_paused") return;
    if (sseAggregator.isSessionBeingViewed(goal.sessionId, goal.serverId)) return;

    const isRemote = goal.serverId !== LOCAL_OPENCODE_SERVER_ID;
    const repo = !isRemote && goal.directory
      ? await resolveRepoForDirectory(this.db, goal.directory)
      : null;
    const server = isRemote ? this.serverRegistry?.get(goal.serverId) ?? null : null;
    const repoName = repo ? getRepoName(repo) : undefined;
    const displayName = repoName ?? server?.name;

    const payload: PushNotificationPayload = {
      title: getGoalOutcomeTitle(goal.status),
      body: buildGoalOutcomeBody(goal, displayName),
      tag: `session-goal-${goal.id}`,
      timestamp: Date.now(),
      renotify: true,
      data: {
        eventType: "session.goal.outcome",
        sessionId: goal.sessionId,
        directory: goal.directory,
        repoId: repo?.id,
        repoName,
        serverId: goal.serverId,
        serverName: server?.name,
        url: isRemote
          ? buildServerSessionPath(goal.serverId, goal.sessionId)
          : buildNotificationUrl(repo, goal.sessionId),
      },
    };

    await this.deliverToSubscribers(
      payload,
      (preferences) =>
        preferences.enabled && preferences.events.goalOutcome !== false
    );
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

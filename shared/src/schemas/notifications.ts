import { z } from "zod";

export const NotificationEventType = {
  PERMISSION_ASKED: "permission.asked",
  QUESTION_ASKED: "question.asked",
  SESSION_ERROR: "session.error",
  SESSION_IDLE: "session.idle",
} as const;

export type NotificationEventType =
  (typeof NotificationEventType)[keyof typeof NotificationEventType];

export const NotificationPreferencesSchema = z.object({
  enabled: z.boolean(),
  events: z.object({
    permissionAsked: z.boolean(),
    questionAsked: z.boolean(),
    sessionError: z.boolean(),
    sessionIdle: z.boolean(),
  }),
});

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  enabled: false,
  events: {
    permissionAsked: true,
    questionAsked: true,
    sessionError: true,
    sessionIdle: false,
  },
};

export const PushSubscriptionKeysSchema = z.object({
  p256dh: z.string(),
  auth: z.string(),
});

export const PushSubscriptionRequestSchema = z.object({
  endpoint: z.string().url(),
  keys: PushSubscriptionKeysSchema,
  deviceName: z.string().optional(),
});

export const PushSubscriptionRecordSchema = z.object({
  id: z.number(),
  userId: z.string(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  deviceName: z.string().nullable(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
});

export const PushNotificationPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  icon: z.string().optional(),
  badge: z.string().optional(),
  tag: z.string().optional(),
  data: z
    .object({
      url: z.string().optional(),
      eventType: z.string(),
      sessionId: z.string().optional(),
      directory: z.string().optional(),
    })
    .optional(),
});

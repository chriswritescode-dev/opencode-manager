import { z } from "zod";
import { parseHttpUrl, trimUrlTrailingSlashes } from "../utils/url";

export const REMOTE_ACCESS_HEADER_MAX_COUNT = 8;
export const REMOTE_ACCESS_HEADER_VALUE_MAX_LENGTH = 512;
export const REMOTE_ACCESS_HEADER_NAME_MAX_LENGTH = 128;
export const REMOTE_ACCESS_HEADERS_MAX_ENCODED_LENGTH = 1800;
export const CLOUDFLARE_ACCESS_HEADER_NAMES = ["CF-Access-Client-Id", "CF-Access-Client-Secret"] as const;
export const DEVICE_PAIRING_PATH = "/pair";
export const DEVICE_PAIRING_CODE_TTL_SECONDS = 180;

export const DEVICE_PAIRING_ERROR_CODES = {
  PAIRING_CODE_INVALID: "PAIRING_CODE_INVALID",
  DEVICE_NOT_FOUND: "DEVICE_NOT_FOUND",
  CANNOT_REVOKE_CURRENT_SESSION: "CANNOT_REVOKE_CURRENT_SESSION",
} as const;

export const PAIRING_CODE_INVALID_MESSAGE =
  "This pairing code has expired or was already used. Show a new QR code and scan again.";

const HTTP_HEADER_NAME_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const BLOCKED_REMOTE_ACCESS_HEADER_NAMES = new Set([
  "cookie",
  "set-cookie",
  "host",
  "origin",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "keep-alive",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
]);

/** Reports whether a header name is reserved by the transport or uses the proxy- prefix. */
export function isBlockedRemoteAccessHeaderName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return BLOCKED_REMOTE_ACCESS_HEADER_NAMES.has(normalized) || normalized.startsWith("proxy-");
}

export const RemoteAccessHeaderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(REMOTE_ACCESS_HEADER_NAME_MAX_LENGTH)
  .regex(HTTP_HEADER_NAME_TOKEN, "Header names must be valid HTTP tokens")
  .refine((name) => !isBlockedRemoteAccessHeaderName(name), "This header name is reserved");

const remoteAccessHeaderValueRules = z
  .string()
  .refine((value) => !/[\r\n\0]/.test(value), "Header values must not contain line breaks")
  .trim()
  .max(REMOTE_ACCESS_HEADER_VALUE_MAX_LENGTH);

export const RemoteAccessHeaderValueSchema = remoteAccessHeaderValueRules.min(1);

export const RemoteAccessHeaderDraftValueSchema = remoteAccessHeaderValueRules;

export const RemoteAccessHeaderSchema = z.object({
  name: RemoteAccessHeaderNameSchema,
  value: RemoteAccessHeaderValueSchema,
});

export const RemoteAccessHeaderListSchema = z
  .array(RemoteAccessHeaderSchema)
  .max(REMOTE_ACCESS_HEADER_MAX_COUNT)
  .refine(
    (headers) => new Set(headers.map((header) => header.name.toLowerCase())).size === headers.length,
    "Header names must be unique",
  )
  .refine(
    (headers) => encodedRemoteAccessHeadersLength(headers) <= REMOTE_ACCESS_HEADERS_MAX_ENCODED_LENGTH,
    `Remote access headers are too long to fit in a QR code (limit ${REMOTE_ACCESS_HEADERS_MAX_ENCODED_LENGTH} encoded characters)`,
  );

/** Serializes a remote-access header into the `Name:Value` form carried by the link `h` parameter. */
export function formatRemoteAccessHeaderParam(header: RemoteAccessHeader): string {
  return `${header.name}:${header.value}`;
}

function encodedRemoteAccessHeadersLength(headers: RemoteAccessHeader[]): number {
  const params = new URLSearchParams();
  for (const header of headers) params.append("h", formatRemoteAccessHeaderParam(header));
  return params.toString().length;
}

export const RemoteAccessHeaderSummarySchema = z.object({
  name: z.string(),
  hasValue: z.boolean(),
});

export const RemoteAccessHeadersResponseSchema = z.object({
  headers: z.array(RemoteAccessHeaderSummarySchema),
  unreadable: z.boolean(),
});

export const ReplaceRemoteAccessHeadersRequestSchema = z.object({
  headers: z
    .array(
      z.object({
        name: RemoteAccessHeaderNameSchema,
        value: RemoteAccessHeaderDraftValueSchema.optional(),
      }),
    )
    .max(REMOTE_ACCESS_HEADER_MAX_COUNT),
});

export const DevicePairingCodeSchema = z.string().min(16).max(256);
export const DeviceNameSchema = z.string().trim().min(1).max(80);

export const RedeemDevicePairingCodeRequestSchema = z.object({
  code: DevicePairingCodeSchema,
  deviceName: DeviceNameSchema.optional(),
});

export const RedeemDevicePairingCodeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
});

export const AppLinkBlockedReasonSchema = z.enum(["insecure-origin"]);
export const DevicePairingLinkWarningSchema = z.enum(["plain-http", "loopback", "headers-unreadable"]);
export const DevicePairingUnavailableReasonSchema = z.enum([
  "untrusted-origin",
  "loopback",
  "insecure-origin",
]);

export const DevicePairingAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: DevicePairingUnavailableReasonSchema.nullable(),
  message: z.string().nullable(),
});

export const CreateDevicePairingLinksRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

export const DevicePairingLinksResponseSchema = z.object({
  appLink: z.string().nullable(),
  appLinkBlockedReason: AppLinkBlockedReasonSchema.nullable(),
  browserLink: z.string(),
  expiresAt: z.string(),
  headerNames: z.array(z.string()),
  warnings: z.array(DevicePairingLinkWarningSchema),
});

export const PairedDeviceSchema = z.object({
  id: z.string(),
  deviceName: z.string().nullable(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isCurrent: z.boolean(),
});

export const PairedDevicesResponseSchema = z.object({
  devices: z.array(PairedDeviceSchema),
});

export type RemoteAccessHeader = z.infer<typeof RemoteAccessHeaderSchema>;
export type RemoteAccessHeaderDraftValue = z.infer<typeof RemoteAccessHeaderDraftValueSchema>;
export type RemoteAccessHeaderList = z.infer<typeof RemoteAccessHeaderListSchema>;
export type RemoteAccessHeaderSummary = z.infer<typeof RemoteAccessHeaderSummarySchema>;
export type RemoteAccessHeadersResponse = z.infer<typeof RemoteAccessHeadersResponseSchema>;
export type ReplaceRemoteAccessHeadersRequest = z.infer<typeof ReplaceRemoteAccessHeadersRequestSchema>;
export type DevicePairingCode = z.infer<typeof DevicePairingCodeSchema>;
export type DeviceName = z.infer<typeof DeviceNameSchema>;
export type RedeemDevicePairingCodeRequest = z.infer<typeof RedeemDevicePairingCodeRequestSchema>;
export type RedeemDevicePairingCodeResponse = z.infer<typeof RedeemDevicePairingCodeResponseSchema>;
export type AppLinkBlockedReason = z.infer<typeof AppLinkBlockedReasonSchema>;
export type DevicePairingLinkWarning = z.infer<typeof DevicePairingLinkWarningSchema>;
export type DevicePairingUnavailableReason = z.infer<typeof DevicePairingUnavailableReasonSchema>;
export type DevicePairingAvailability = z.infer<typeof DevicePairingAvailabilitySchema>;
export type CreateDevicePairingLinksRequest = z.infer<typeof CreateDevicePairingLinksRequestSchema>;
export type DevicePairingLinksResponse = z.infer<typeof DevicePairingLinksResponseSchema>;
export type PairedDevice = z.infer<typeof PairedDeviceSchema>;
export type PairedDevicesResponse = z.infer<typeof PairedDevicesResponseSchema>;
export type DevicePairingErrorCode =
  (typeof DEVICE_PAIRING_ERROR_CODES)[keyof typeof DEVICE_PAIRING_ERROR_CODES];

/** Builds the browser pairing link whose code stays in the URL fragment. */
export function buildManagerBrowserPairingLink(origin: string, code: string): string {
  return `${trimUrlTrailingSlashes(origin)}${DEVICE_PAIRING_PATH}#c=${encodeURIComponent(code)}`;
}

/** Reads a pairing code from a URL fragment, or null when the fragment holds no valid code. */
export function readPairingCodeFromHash(hash: string): string | null {
  const code = new URLSearchParams(hash.replace(/^#/, "")).get("c");
  const parsed = DevicePairingCodeSchema.safeParse(code);
  return parsed.success ? parsed.data : null;
}

/** Parses a browser pairing link into its origin and code, or null when the text is not one. */
export function parseManagerBrowserPairingLink(text: string): { origin: string; code: string } | null {
  const url = parseHttpUrl(text.trim());
  if (!url) return null;
  if (url.pathname !== DEVICE_PAIRING_PATH) return null;
  const code = readPairingCodeFromHash(url.hash);
  return code === null ? null : { origin: url.origin, code };
}

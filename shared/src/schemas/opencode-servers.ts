import { z } from "zod";

export const LOCAL_OPENCODE_SERVER_ID = "local";
export const OPENCODE_SERVER_USERNAME = "opencode";
export const OPENCODE_SERVER_LINK_PROTOCOL = "ocm:";
export const OPENCODE_SERVER_LINK_VERSION = "2";

const HttpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "URL must start with http:// or https://");

export const OpenCodeServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  username: z.string(),
  enabled: z.boolean(),
  hasPassword: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const OpenCodeServerPairingSchema = z.object({
  pairUrl: HttpUrlSchema,
  code: z.string().min(16).max(256),
});

export const CreateOpenCodeServerRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseUrl: HttpUrlSchema,
    username: z.string().trim().min(1).max(100).default(OPENCODE_SERVER_USERNAME),
    password: z.string().min(1).max(1024).optional(),
    pairing: OpenCodeServerPairingSchema.optional(),
    enabled: z.boolean().default(true),
  })
  .refine((value) => !(value.password && value.pairing), "Provide either a password or a pairing code, not both");

export const UpdateOpenCodeServerRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    baseUrl: HttpUrlSchema.optional(),
    username: z.string().trim().min(1).max(100).optional(),
    password: z.string().min(1).max(1024).nullable().optional(),
    pairing: OpenCodeServerPairingSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => !(value.password && value.pairing), "Provide either a password or a pairing code, not both");

export const TestOpenCodeServerRequestSchema = z.object({
  baseUrl: HttpUrlSchema,
  username: z.string().trim().min(1).max(100).default(OPENCODE_SERVER_USERNAME),
  password: z.string().max(1024).optional(),
  serverId: z.string().trim().min(1).optional(),
});

export const OpenCodeServerTestResultSchema = z.object({
  ok: z.boolean(),
  version: z.string().nullable(),
  versionSupported: z.boolean(),
  error: z.string().nullable(),
});

export const OpenCodeServerStatusSchema = z.object({
  serverId: z.string(),
  connected: z.boolean(),
  version: z.string().nullable(),
  error: z.string().nullable(),
});

export const OpenCodeServerLinkSchema = z.object({
  kind: z.literal("opencode"),
  name: z.string().trim().min(1).max(100),
  baseUrl: HttpUrlSchema,
  pairing: OpenCodeServerPairingSchema,
});

export type OpenCodeServer = z.infer<typeof OpenCodeServerSchema>;
export type OpenCodeServerPairing = z.infer<typeof OpenCodeServerPairingSchema>;
export type CreateOpenCodeServerRequest = z.input<typeof CreateOpenCodeServerRequestSchema>;
export type UpdateOpenCodeServerRequest = z.input<typeof UpdateOpenCodeServerRequestSchema>;
export type TestOpenCodeServerRequest = z.input<typeof TestOpenCodeServerRequestSchema>;
export type OpenCodeServerTestResult = z.infer<typeof OpenCodeServerTestResultSchema>;
export type OpenCodeServerStatus = z.infer<typeof OpenCodeServerStatusSchema>;
export type OpenCodeServerLink = z.infer<typeof OpenCodeServerLinkSchema>;

/** Builds the `ocm://link` URL encoded into a pairing QR code. */
export function buildOpenCodeServerLink(link: OpenCodeServerLink): string {
  const params = new URLSearchParams({
    v: OPENCODE_SERVER_LINK_VERSION,
    kind: link.kind,
    name: link.name,
    url: link.baseUrl,
    pair: link.pairing.pairUrl,
    code: link.pairing.code,
  });
  return `${OPENCODE_SERVER_LINK_PROTOCOL}//link?${params.toString()}`;
}

/** Parses an `ocm://link` URL from a QR code or pasted text; returns null when it is not a valid link. */
export function parseOpenCodeServerLink(text: string): OpenCodeServerLink | null {
  const url = parseOpenCodeServerLinkUrl(text);
  if (!url) return null;
  if (url.searchParams.get("v") !== OPENCODE_SERVER_LINK_VERSION) return null;

  const parsed = OpenCodeServerLinkSchema.safeParse({
    kind: url.searchParams.get("kind"),
    name: url.searchParams.get("name"),
    baseUrl: url.searchParams.get("url"),
    pairing: { pairUrl: url.searchParams.get("pair"), code: url.searchParams.get("code") },
  });
  return parsed.success ? parsed.data : null;
}

/** Reads the `v` parameter of an `ocm://link` URL, or null when the text is not an `ocm://link` URL. */
export function readOpenCodeServerLinkVersion(text: string): string | null {
  return parseOpenCodeServerLinkUrl(text)?.searchParams.get("v") ?? null;
}

function parseOpenCodeServerLinkUrl(text: string): URL | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== OPENCODE_SERVER_LINK_PROTOCOL || url.hostname !== "link") return null;
  return url;
}

const REMOTE_DIRECTORY_KEY_PATTERN = /^(srv_[A-Za-z0-9_-]+)\|(.+)$/s;

/** Builds the event-stream subscription key for a directory; local directories stay unchanged. */
export function buildServerDirectoryKey(serverId: string, directory: string): string {
  return serverId === LOCAL_OPENCODE_SERVER_ID ? directory : `${serverId}|${directory}`;
}

/** Splits an event-stream subscription key into its server id and directory. */
export function parseServerDirectoryKey(key: string): { serverId: string; directory: string } {
  const match = REMOTE_DIRECTORY_KEY_PATTERN.exec(key);
  return match?.[1] && match[2] ? { serverId: match[1], directory: match[2] } : { serverId: LOCAL_OPENCODE_SERVER_ID, directory: key };
}

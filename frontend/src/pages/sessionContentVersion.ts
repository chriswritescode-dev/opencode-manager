import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-manager/shared/opencode";
import type { JsonObject, JsonValue } from "@opencode-manager/shared/utils";

type SessionMessageAssistantContent = SessionMessageAssistant["content"][number];

const partVersionCache = new WeakMap<SessionMessageAssistantContent, number>();
const messageVersionCache = new WeakMap<SessionMessageInfo, number>();

function mix(hash: number, value: number): number {
  return (((hash << 5) - hash) + value) | 0;
}

function hashString(s: string): number {
  let h = s.length;
  const max = Math.min(s.length, 128);
  for (let i = 0; i < max; i++) {
    h = mix(h, s.charCodeAt(i));
  }
  return h;
}

function getValueSignature(value: JsonValue | undefined): number {
  if (value === null || value === undefined) return 0;
  if (value === true) return 1;
  if (value === false) return 2;
  if (Array.isArray(value)) return value.length;
  const primitiveTag = Object.prototype.toString.call(value);
  if (primitiveTag === "[object String]") return String(value).length;
  if (primitiveTag === "[object Number]") return Number(value) | 0;
  return Object.keys(value).length;
}

function getMetadataSignature(metadata: JsonObject | undefined): number {
  if (!metadata) return 0;
  const keys = Object.keys(metadata);
  let signature = keys.length;
  for (const key of keys) {
    signature = mix(signature, hashString(key));
    signature = mix(signature, getValueSignature(metadata[key]));
  }
  return signature;
}

function computeContentPartVersion(part: SessionMessageAssistantContent): number {
  if (part.type === "text" || part.type === "reasoning") {
    return hashString(part.text);
  }
  if (part.type === "tool") {
    const state = part.state;
    let version = hashString(state.status);
    if (state.status === "streaming") {
      version += hashString(state.input);
    } else {
      if (state.status === "error") {
        version += hashString(state.error.message);
      }
      if (state.status === "completed") {
        version += state.content.reduce(
          (sum, entry) => sum + (entry.type === "text" ? hashString(entry.text) : 0),
          0,
        );
      }
      version += getMetadataSignature(state.metadata);
    }
    return version;
  }
  return 1;
}

function getContentPartVersion(part: SessionMessageAssistantContent): number {
  const cached = partVersionCache.get(part);
  if (cached !== undefined) return cached;
  const version = computeContentPartVersion(part);
  partVersionCache.set(part, version);
  return version;
}

function computeMessageVersion(message: SessionMessageInfo): number {
  if (message.type === "assistant") {
    const partsVersion = message.content.reduce(
      (sum, part) => sum + getContentPartVersion(part),
      0,
    );
    return partsVersion + (message.snapshot?.files?.length ?? 0);
  }
  if (message.type === "user") {
    return hashString(message.text);
  }
  return 1;
}

function getMessageVersion(message: SessionMessageInfo): number {
  const cached = messageVersionCache.get(message);
  if (cached !== undefined) return cached;
  const version = computeMessageVersion(message);
  messageVersionCache.set(message, version);
  return version;
}

export function getMessagesContentVersion(messages?: SessionMessageInfo[]): number {
  if (!messages) return 0;
  return messages.reduce((sum, message) => sum + getMessageVersion(message), messages.length);
}

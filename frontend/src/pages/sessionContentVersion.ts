import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-manager/shared/opencode";

type SessionMessageAssistantContent = SessionMessageAssistant["content"][number];

/**
 * Cheap bounded hash for a string value.
 *
 * Combines length with the character codes of the first 128 chars so that
 * same-length strings ("pending" → "running", "foo" → "bar") produce
 * different hash values.  The iteration is capped at 128 characters so
 * the cost is bounded even for very long tool outputs.
 */
function hashString(s: string): number {
  let h = s.length;
  const max = Math.min(s.length, 128);
  for (let i = 0; i < max; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0; // keep 32-bit
  }
  return h;
}

/**
 * Computes a version number that changes when message content changes.
 *
 * Used to trigger autoscroll on streamed deltas. This function avoids
 * expensive operations like JSON.stringify so it can be called on every
 * render without impacting performance.
 */
function getContentPartVersion(part: SessionMessageAssistantContent): number {
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
      version += hashString(JSON.stringify(state.metadata ?? {}));
    }
    return version;
  }
  return 1;
}

export function getMessagesContentVersion(messages?: SessionMessageInfo[]): number {
  if (!messages) return 0;
  return messages.reduce((sum, message) => {
    if (message.type === "assistant") {
      return sum + message.content.reduce(
        (partSum, part) => partSum + getContentPartVersion(part),
        0,
      );
    }
    if (message.type === "user") {
      return sum + hashString(message.text);
    }
    return sum + 1;
  }, messages.length);
}

# Assistant Internal API

The Assistant Internal API provides capabilities for OpenCode agents to interact with the manager backend via a secure bearer-token API.

> For a user-facing overview of how to use and set up assistant mode, see [Assistant Mode](assistant-mode.md).

## Authentication

All endpoints require a bearer token. The token can be found at:
- `.opencode/internal-token` (relative to the assistant workspace cwd)

Include the token in requests:
```
Authorization: Bearer <token>
```

## Endpoints

### Notifications

**POST `/api/internal/notifications/send`**

Send push notifications to the user's registered devices.

**Request Body:**
```ts
{
  title: string       // 1-120 characters
  body: string        // 1-500 characters
  url?: string        // Optional: deep link (1-500 chars)
  tag?: string        // Optional: notification tag (max 80 chars)
  priority?: 'normal' | 'high'
}
```

**Query Parameters:**
- `userId` (optional): Defaults to `"default"`

**Response:**
```ts
{
  delivered: number
  expired: number
  failed: number
  noSubscriptions: boolean
}
```

**Rate Limiting:** 10 requests per minute per token. Returns `429 Too Many Requests` with `Retry-After` header when exceeded.

**Status Codes:**
- `200`: Notification sent
- `400`: Invalid request body
- `401`: Missing or invalid bearer token
- `429`: Rate limit exceeded
- `503`: Push notifications not configured (missing VAPID)

### Settings

**GET `/api/internal/settings`**

Retrieve the user's full settings and preferences.

**Query Parameters:**
- `userId` (optional): Defaults to `"default"`

**Response:**
```ts
{
  preferences: {
    theme: 'dark' | 'light' | 'system',
    mode: 'plan' | 'build',
    defaultModel?: string,
    defaultAgent?: string,
    autoScroll: boolean,
    expandDiffs: boolean,
    expandToolCalls: boolean,
    showReasoning: boolean,
    simpleChatMode: boolean,
    leaderKey?: string,
    directShortcuts?: string[],
    keyboardShortcuts: Record<string, string>,
    customCommands: Array<{ name: string; description: string; promptTemplate: string }>,
    notifications?: { enabled: boolean; ... },
    repoOrder?: number[],
    repoSortMode: 'recent' | 'manual' | 'name',
    gitCredentials?: [...],  // Read-only
    gitIdentity?: {...},    // Read-only
    tts?: {...},            // Read-only
    stt?: {...},            // Read-only
  },
  updatedAt: number
}
```

**PATCH `/api/internal/settings`**

Update a subset of safe user preferences.

**Allowed Keys:**
The following preference keys can be modified:
- `theme`, `mode`, `defaultModel`, `defaultAgent`
- `autoScroll`, `expandDiffs`, `expandToolCalls`, `showReasoning`
- `simpleChatMode`, `leaderKey`, `directShortcuts`
- `keyboardShortcuts`, `customCommands`, `notifications`
- `repoOrder`, `repoSortMode`
- `tts` — Non-secret TTS preferences (`enabled`, `provider`, `autoPlay`, `voice`, `model`, `speed`). TTS must already be configured in the UI (the endpoint returns 400 otherwise).
- `stt` — Non-secret STT preferences (`enabled`, `provider`, `model`, `language`). STT must already be configured in the UI (the endpoint returns 400 otherwise).

**Restricted Keys:**
The following keys are **NOT** allowed and will be rejected:
- `gitCredentials` - Git credentials must be managed via the full UI
- `gitIdentity` - Git identity must be managed via the full UI
- `tts.apiKey` - TTS credentials must be managed via the full UI
- `tts.endpoint` - TTS endpoint must be managed via the full UI
- `stt.apiKey` - STT credentials must be managed via the full UI
- `stt.endpoint` - STT endpoint must be managed via the full UI
- `lastKnownGoodConfig` - Internal state, do not modify

**Request Body:**
Partial object with any of the allowed keys.

**Response:**
Returns the updated settings object.

**Status Codes:**
- `200`: Settings updated
- `400`: Invalid request body or disallowed key
- `401`: Missing or invalid bearer token

### Assistant

**POST `/api/internal/assistant/reload`**

Reload the assistant workspace by disposing the current OpenCode instance. Use this after editing `.opencode/agents/assistant.md` or `opencode.json` so changes take effect on the next message.

**Rate Limiting:** 5 requests per minute per token. Returns `429 Too Many Requests` with `Retry-After` header when exceeded.

**Example:**
```bash
curl -X POST -H "Authorization: Bearer <token>" \
  "http://localhost:5003/api/internal/assistant/reload"
```

**Response:**
```ts
{ "success": true }
```

**Status Codes:**
- `200`: Assistant workspace reloaded
- `401`: Missing or invalid bearer token
- `429`: Rate limit exceeded
- `502`: Failed to reload (upstream OpenCode error)

### Repos

**GET `/api/internal/repos`**

Retrieve a list of all managed repositories, ordered by the user's repo preference order.

**Response:**
```ts
{
  repos: Array<{
    id: number
    repoUrl?: string              // Git remote URL (absent for local-only repos)
    localPath: string             // Relative path under repos root
    fullPath: string              // Absolute filesystem path
    sourcePath?: string           // Source worktree path (for worktrees)
    branch?: string               // Current branch name (for worktrees)
    defaultBranch: string         // e.g. "main"
    cloneStatus: 'cloning' | 'ready' | 'error'
    clonedAt: number              // Timestamp when repo was cloned
    lastPulled?: number           // Timestamp of last pull
    lastAccessedAt?: number       // Timestamp of last access
    openCodeConfigName?: string   // Associated OpenCode config name
    isWorktree?: boolean          // Whether repo is a worktree
    isLocal?: boolean             // Whether repo is local-only
  }>
}
```

**Status Codes:**
- `200`: Repository list returned
- `401`: Missing or invalid bearer token
- `500`: Server error (database failure)

## Skills

The assistant workspace includes four skills that document these capabilities:

1. **Schedule Management** (`.opencode/skills/schedule-management/SKILL.md`)
2. **Notifications** (`.opencode/skills/notifications/SKILL.md`)
3. **Manager Settings** (`.opencode/skills/manager-settings/SKILL.md`)
4. **Repo Management** (`.opencode/skills/repo-management/SKILL.md`)

These skills are automatically provisioned when assistant mode is initialized and contain detailed examples and usage patterns.

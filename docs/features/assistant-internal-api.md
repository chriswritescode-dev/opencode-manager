# Assistant Internal API

The Assistant Internal API provides capabilities for OpenCode agents to interact with the manager backend. Agents reach it through the `ocm` tool, which authenticates on their behalf; the HTTP surface itself is a secure bearer-token API.

> For a user-facing overview of how to use and set up assistant mode, see [Assistant Mode](assistant-mode.md).

## Authentication

The raw HTTP endpoints require a bearer token:

```
Authorization: Bearer <token>
```

The token has two in-product consumers, neither of which is an agent:

| Consumer | How it obtains the token |
|----------|--------------------------|
| Generated plugins (`ocm-manager.js`, `ocm-sandbox.js`, `ocm-gh-env.js`) | The `OCM_INTERNAL_TOKEN` environment variable, injected into the OpenCode child process |
| External clients such as the `ocm` CLI | Settings -> Manager Token, served by `GET /api/settings/manager-token` |

The generated plugins are OpenCode 2 plugin modules — plain, dependency-free objects that default-export `{ id, setup }` and register their hooks and tools through the `setup` context. The Manager writes them to `<config home>/opencode/plugins/`; the legacy `opencode/plugin/` files are removed on install.

Agents never authenticate against this API themselves. They call the `ocm` tool, which holds the token inside the Manager process.

## The `ocm` Tool

The Manager installs a generated plugin (`ocm-manager.js`) that gives every agent an `ocm` tool. The tool calls this API from inside the Manager's own OpenCode process, so it needs no token, no base URL, and no network access from the agent shell.

That makes it the only path that works everywhere: a scheduled run executes in a throwaway worktree with no token of its own, and a sandboxed `shell` call runs in a microVM where `localhost` is the guest, not the Manager.

OpenCode 2 validates the tool's arguments against a JSON Schema before it calls `execute`, so the `ocm` tool declares its `action` and `params` shape as a JSON Schema derived from the same Zod definitions the tool uses.

The tool has two actions.

### `send_notification`

Send a push notification to every device the user has registered.

```ts
{
  action: 'send_notification',
  params: { title: string, body: string, url?: string, tag?: string, priority?: 'normal' | 'high' }
}
```

### `request`

Call an allow-listed internal API route and return the raw response body text.

```ts
{
  action: 'request',
  params: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: object }
}
```

The `path` is relative to the internal API base (for example `/settings` or `/repos/0/schedules`) and query strings are allowed. The action resolves the path against the internal API base and rejects anything that resolves outside it (absolute URLs and `..` traversal), then rejects any method plus path that is not in the allow-list.

**Allow-listed routes:**

```
GET /settings
PATCH /settings
GET /opencode-config
GET /opencode-config/mcp
PATCH /opencode-config
POST /assistant/reload
GET /repos
GET /repos/*/git-info
GET /opencode-workspaces
GET /schedules/all
GET /schedules/all/runs
GET /repos/*/schedules
POST /repos/*/schedules
GET /repos/*/schedules/*
PATCH /repos/*/schedules/*
DELETE /repos/*/schedules/*
POST /repos/*/schedules/*/run
GET /repos/*/schedules/*/runs
DELETE /repos/*/schedules/*/runs
GET /repos/*/schedules/*/runs/*
DELETE /repos/*/schedules/*/runs/*
POST /repos/*/schedules/*/runs/*/cancel
```

**Deliberately not allow-listed:**

- `POST /notifications/send` — use the `send_notification` action instead.
- `GET /git-credentials/gh-env` — returns the GitHub CLI environment (`GH_TOKEN`, `GITHUB_TOKEN`) for the OpenCode host process; it must not be readable by the agent.
- `POST /sandbox/shell` — the sandbox planner's internal route that resolves and pins the shell for a `shell` call; exposing it would let the agent drive shell planning directly.
- `/repos/*/mirror/*` — the repo mirror protocol that the `ocm` CLI uses to sync entire repositories; it can create, replace, patch, or delete whole repos, so it stays reserved for the CLI.

Agents should use the `ocm` tool rather than the raw bearer-token endpoints below. Those endpoints remain available to the frontend, generated plugins, and other Manager-internal clients.

## Endpoints

### Notifications

**POST `/api/internal/notifications/send`**

Send push notifications to the user's registered devices. Prefer the `ocm` tool with the `send_notification` action.

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
    colorTheme?: string,     // 'manager' or an OpenCode theme id from shared/src/themes; unknown stored ids read as 'manager'
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
- `theme`, `colorTheme`, `mode`, `defaultModel`, `defaultAgent`
- `autoScroll`, `expandDiffs`, `expandToolCalls`, `showReasoning`
- `simpleChatMode`, `leaderKey`, `directShortcuts`
- `keyboardShortcuts`, `customCommands`, `notifications`
- `repoOrder`, `repoSortMode`
- `colorTheme` must be `manager` or a catalog theme id; unknown ids return 400.
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

### OpenCode Configuration

The global OpenCode configuration files in the workspace `.config/opencode/` directory are the source of truth, and these endpoints are the only supported way to change them. The two sources OpenCode 2 reads are merged in order — `opencode.json`, `opencode.jsonc` — with later files overriding earlier ones. A legacy `config.json` is folded into a recognized source and archived; it is never read as a live source. The schema accepts both V1-compatible keys and native OpenCode 2 fields, so a V2-native config passes validation. The endpoints apply the same rules as the Settings UI: any semantic change is written to disk and applied to the running server, and it is flagged as restart required only when that apply fails; comment-only edits do nothing, and `mcp` changes go through the same location reload, which reconnects only the servers whose configuration changed.

The agent-facing surface is redacted: every read and write response replaces secret values with `<redacted>` and omits the raw source text, a write containing `<redacted>` is rejected, and `PATCH` changes only the paths it names, so an agent never has to read or reproduce the whole file. The public surface the Settings UI uses keeps full fidelity and the whole-document `PUT`.

**GET `/api/internal/opencode-config`**

Read the merged persisted configuration and its source files, with secret values redacted and the raw source text omitted. This is not the running instance configuration: project overrides and expanded environment values are not included.

**Response:**
```ts
{
  path: string              // Absolute path of the preferred write target
  content: object           // Merged configuration across all sources, secrets replaced with "<redacted>"
  sources: Array<{          // Recognized source files, in merge order, raw content omitted
    name: 'opencode.json' | 'opencode.jsonc'
    path: string
    content: object
    isValid: boolean
    validationIssues?: Array<{ path: string, message: string }>
    updatedAt: number
  }>
  revision: string          // Hash of the source set; send back as expectedRevision
  isValid: boolean          // Whether every source passes schema validation
  validationIssues?: Array<{ path: string, message: string }>
  updatedAt: number         // Newest source mtime
  redactedPaths: string[]    // Dotted paths whose values were replaced
}
```

**Status Codes:**
- `200`: Configuration state returned
- `401`: Missing or invalid bearer token
- `404`: No config source found
- `500`: Server error

**GET `/api/internal/opencode-config/mcp`**

List the configured MCP servers with their stored shape, enabled state, and live connection status. Header and environment values are never returned.

**Response:**
```ts
{
  revision: string | null
  servers: Array<{
    name: string
    type: 'local' | 'remote'
    command?: string[]      // For local servers
    url?: string            // For remote servers
    enabled: boolean
    shape: 'servers' | 'legacy'  // Native mcp.servers.<name> or flat mcp.<name>
    status?: 'connected' | 'pending' | 'disabled' | 'failed' | 'needs_auth'
    error?: string
  }>
}
```

**Status Codes:**
- `200`: MCP server list returned
- `401`: Missing or invalid bearer token
- `500`: Server error

**GET `/api/internal/opencode-config/effective`**

Read the running server's configuration as `entries`: the configuration documents and discovery directories in precedence order, lowest first, each shaped as `{ type: 'document', path, info }` or `{ type: 'directory', path }`. Its `info` values are expanded for the running server, so never copy this response into a save. Secret values in `info` are replaced with `<redacted>`.

**Status Codes:**
- `200`: Effective configuration returned
- `401`: Missing or invalid bearer token
- `502`: OpenCode returned an error
- `503`: OpenCode server unavailable

**PATCH `/api/internal/opencode-config`**

Change only the paths the request names. Only those paths are patched into the preferred existing source (`opencode.jsonc` > `opencode.json`; a new installation gets `opencode.jsonc`); comments, unknown keys, and untouched inherited values are preserved. A `null` value removes a path. Removing a path defined only in a lower-priority source is rejected (`409`).

The public route keeps the whole-document `PUT` for the Settings UI; the internal route exposes `PATCH` instead.

**Request Body:**
```ts
{
  patch: object              // Nested paths to set; null removes a path
  expectedRevision?: string   // From GET; a stale value is rejected with 409
  source?: 'opencode.json' | 'opencode.jsonc'
}
```

**Response:**
Returns the refreshed redacted configuration. Semantic changes, including `mcp`, are applied with an OpenCode location reload, without a restart; only the MCP servers whose configuration changed reconnect. Adds `restartRequired: true` only when that apply fails.

**Status Codes:**
- `200`: Configuration written
- `400`: Invalid request body, invalid configuration, a source file that is not valid JSON/JSONC (`sources` lists them), or a value equal to `<redacted>` (`paths` lists them)
- `401`: Missing or invalid bearer token
- `409`: Stale `expectedRevision` (`expectedRevision`/`actualRevision` in the body), or the patch would remove a value defined only in a lower-priority source (`paths`/`sources` in the body)
- `500`: Server error

### Assistant

**POST `/api/internal/assistant/reload`**

Reload the OpenCode server configuration, rebuilding every loaded location. Use this after editing `.opencode/agents/assistant.md` or `opencode.json` so changes take effect on the next message.

**Rate Limiting:** 5 requests per minute per token. Returns `429 Too Many Requests` with `Retry-After` header when exceeded.

**Example:**
```json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/assistant/reload"
  }
}
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

1. **Schedule Management** (`.opencode/skills/schedule-management/SKILL.md`) — manage schedule jobs and runs through the `ocm` `request` action.
2. **Notifications** (`.opencode/skills/notifications/SKILL.md`) — send push notifications through the `ocm` `send_notification` action.
3. **Manager Settings** (`.opencode/skills/manager-settings/SKILL.md`) — read and patch user preferences, read and update the OpenCode configuration file, and reload the assistant workspace through the `ocm` `request` action.
4. **Repo Management** (`.opencode/skills/repo-management/SKILL.md`) — list managed repositories through the `ocm` `request` action.

These skills are automatically provisioned when assistant mode is initialized and contain detailed examples and usage patterns.

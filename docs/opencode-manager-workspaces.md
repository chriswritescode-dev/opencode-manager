# OpenCode Workspaces (Repo Targets)

OpenCode Manager can run a dedicated OpenCode target process per repo on the Manager server. The workspace plugin on your laptop discovers those repos and connects to their targets, so you write code against a remote repo's OpenCode server while your local OpenCode session stays on your laptop.

## Architecture Overview

| Component | Where it runs | Role |
|---|---|---|
| **Workspace plugin** | Laptop / local OpenCode | Discovers repos, resolves targets, opens sessions |
| **Manager backend** | Manager server | Hosts repo-scoped OpenCode target processes, proxies API traffic, syncs idle sessions back |
| **Manager web UI** | Manager server | Reads from the main OpenCode server; sees repo sessions after sync-back |

---

## 1. Install the plugin

Add the plugin to your local OpenCode configuration. Point it at your Manager instance.

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": [
    [
      "file:///path/to/oc-manager/opencode-workspace-plugin/src/index.ts",
      {
        "managerUrl": "https://manager.example.com"
      }
    ]
  ]
}
```

You can also pass `managerToken` and `connectionId` in the options object.

### Environment variables

If you prefer environment variables over inline options:

| Variable | Required | Description |
|---|---|---|
| `OPENCODE_MANAGER_URL` | Yes | Base URL of the Manager server (e.g., `https://manager.example.com`) |
| `OPENCODE_MANAGER_INTERNAL_TOKEN` | Yes | Internal auth token for API calls between the plugin and the Manager |

Both values must be set either in the plugin options or as environment variables. The plugin validates them at startup.

---

## 2. How it works

### Lifecycle of a repo target

1. The plugin asks the Manager for a list of workspaces (`GET /api/internal/opencode-workspaces`). The Manager returns all ready repos.
2. When you select a repo workspace, the plugin calls `POST /api/internal/repos/:repoId/opencode-target` to ensure a target is running.
3. The Manager allocates a free port and starts `opencode serve` bound to `127.0.0.1` with:
   - Repo-specific state directory: `<workspace>/opencode-targets/repo-<id>/state`
   - Repo-specific config directory: `<workspace>/opencode-targets/repo-<id>/config`
   - A generated HMAC token for authentication.
4. The Manager performs health checks until the target is healthy, then returns a proxy URL and auth headers.
5. All subsequent requests are proxied through the Manager's reverse proxy (`/api/opencode-targets/repo/:repoId/*`), which rewrites the Authorization header to the target's internal credentials.

### Target states

Targets transition through these states:

```
starting → healthy → stopped
                  → failed → starting (retry)
         → unhealthy → starting (retry)
```

- **starting**: Process spawned, waiting for health check.
- **healthy**: Process responds to health checks.
- **unhealthy**: Health check failed but process still running.
- **failed**: Health check timeout or process exited with error.
- **stopped**: Process terminated intentionally (idle stop, manual stop, shutdown).

### Idle stop

When a target is stopped for `'idle'`, its process is killed but the state directory persists. On next request, the target restarts with the same port and token, picking up where it left off.

### Session sync-back

Completed or idle sessions are synced back to the main OpenCode server so they appear in the Manager web UI:

1. When a repo target session becomes idle or completes, the Manager fetches the full event history from the repo target (`/sync/history`).
2. It replays events into the main OpenCode server (`/sync/replay`).
3. The directory path is rewritten to the repo's full path so the session appears under the correct repo in the UI.

This means remote repo sessions appear in the Manager web UI after they are synced back. Live streaming of sessions from the repo target through the web UI is not yet supported.

---

## 3. Manager web UI behavior

The Manager web UI reads exclusively from the main OpenCode server. It does not connect directly to repo targets.

- **After sync-back**: Remote repo target sessions appear in the session list.
- **Live viewing**: Not supported unless the web UI is routed directly to the repo target. This is future work.
- **Session creation**: New sessions are created through the plugin's `target()` method, which returns the repo target's URL and auth headers.

---

## 4. Limitations

| Limitation | Notes |
|---|---|
| No one-server-per-session design | Each repo gets one shared target; all sessions for that repo share the same target process. |
| No direct exposure of repo OpenCode ports | Repo target ports are only accessible via the Manager reverse proxy, not directly. |
| No local directory-scoping proxy | The plugin cannot scope a local directory to a specific target. Directory scoping is handled by the Manager. |
| Continuous live sync is out of MVP | Only idle/completed sessions are synced. Real-time live sync between targets is not implemented. |
| WebSocket proxy support depends on backend proxy support | The current HTTP reverse proxy returns `501` for WebSocket upgrade requests. WebSocket proxying requires additional work. |

---

## 5. Acceptance criteria checklist

- [x] Plugin runs on laptop/local OpenCode.
- [x] Execution runs on Manager repo target.
- [x] Manager web UI sees sessions after sync-back.

---

## Related endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/internal/opencode-workspaces` | GET | List available repo workspaces |
| `/api/internal/repos/:repoId/opencode-target` | POST | Ensure a target is running for a repo |
| `/api/opencode-targets/repo/:repoId/*` | ALL | Reverse proxy to repo target |
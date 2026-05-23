# OpenCode Workspaces (Attach Launcher)

OpenCode Manager lets you open remote repos from your laptop's OpenCode TUI. The workspace plugin lists Manager repos in a picker, then replaces your local TUI with an `opencode attach` session bound to the Manager's proxy — so prompts execute on the Manager's filesystem while the local laptop TUI exits cleanly.

## Architecture Overview

| Component | Where it runs | Role |
|---|---|---|
| **Workspace plugin** | Laptop / local OpenCode TUI | Lists repos, spawns `opencode attach` against Manager proxy |
| **Manager backend** | Manager server | Exposes repo metadata + token-protected OpenCode proxy (accepts Bearer or Basic with manager token) |
| **Manager web UI** | Manager server | Reads from the main OpenCode server; sessions created via `opencode attach` appear normally |

The old per-repo target process architecture has been removed. All sessions share a single OpenCode server on the Manager, with file-level isolation via `--dir`.

---

## 1. Install the plugin

### TUI plugin registration (`tui.json`)

The plugin is a **TUI-only** plugin — it registers in `tui.json`, not `opencode.jsonc`.

```jsonc
// ~/dotfiles/opencode/tui.json
{
  "plugin": [
    [
      "file:///path/to/oc-manager/opencode-workspace-plugin/dist/tui.js",
      {
        "managerUrl": "https://manager.example.com",
        "managerToken": "your-manager-internal-token"
      }
    ]
  ]
}
```

### Server plugin (remove from `opencode.jsonc`)

If you previously had a server-side plugin entry in `opencode.jsonc`, remove it. The server plugin no longer exists — the plugin is TUI-only.

```jsonc
// ~/dotfiles/opencode/opencode.jsonc
// Remove any "plugin" entries that point to opencode-workspace-plugin.
```

### Environment variables

If you prefer environment variables over inline options:

| Variable | Required | Description |
|---|---|---|
| `OPENCODE_MANAGER_URL` | Yes | Base URL of the Manager server (e.g., `https://manager.example.com`) |
| `OPENCODE_MANAGER_INTERNAL_TOKEN` | Yes | Internal auth token for API calls between the plugin and the Manager |

Both values must be set either in the plugin options or as environment variables. The plugin validates them at startup.

---

## 2. How it works

### Flow

1. User types `/manager` (or presses `<leader>w`) in the local OpenCode TUI.
2. Plugin calls `GET {managerUrl}/api/internal/opencode-workspaces` (Bearer token) to list ready repos.
3. A dialog shows repos with name, branch, and clone status.
4. User picks a repo.
5. Plugin spawns `opencode attach` with:
   - **Proxy URL**: `{managerUrl}/api/opencode-proxy`
   - **Directory**: the repo's filesystem path on the Manager
   - **Auth**: Basic auth with username `opencode` and password = manager token
6. The child `opencode attach` takes over the terminal (`stdio: 'inherit'`).
7. On child close, the parent TUI process exits (`process.exit(0)`).

### Command equivalent

```
opencode attach https://manager.example.com/api/opencode-proxy \
  --dir /path/to/repo/on/manager \
  --password <manager-token> \
  --username opencode
```

### Manager proxy route

All requests from `opencode attach` are routed through `GET|POST|... {managerUrl}/api/opencode-proxy/*` which forwards to the Manager's single OpenCode server. The proxy accepts either Bearer token or Basic auth (password = manager token) for client authentication, then strips hop-by-hop headers and injects Basic auth with the upstream OpenCode server credentials.

---

## 3. Acceptance criteria checklist

- [x] Plugin runs on laptop/local OpenCode TUI.
- [x] `/manager` shows repos from Manager.
- [x] Selecting a repo spawns `opencode attach` bound to Manager proxy.
- [x] Prompts execute on Manager's filesystem (not laptop).
- [x] Closing the laptop TUI does not terminate the Manager's session.
- [x] Backend logs show only `/api/opencode-proxy/*` traffic; no `/api/opencode-targets/*`; no spawned child opencodes.

---

## Related endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/internal/opencode-workspaces` | GET | List ready repos with directory info |
| `/api/opencode-proxy/*` | ALL | Token-protected proxy from Manager to single OpenCode server (accepts Bearer or Basic) |